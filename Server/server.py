"""Mini UK private London playtest. Python 3.10+, no third-party packages."""
import argparse
import json
import math
import re
import secrets
import threading
import time
import sqlite3
from feedback import Feedback, FeedbackError
from voice import Voice, VoiceError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIMITS = (2, 4, 6, 5, 6, 6, 6, 3, 4, 3, 3, 4, 2, 6)
TTL = 20
COINS = [(12, 0.2, -30-i*8) for i in range(24)]


class Rejected(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Rooms:
    def __init__(self, clock=time.monotonic):
        self.clock, self.lock = clock, threading.Lock()
        self.rooms, self.sessions, self.joins = {}, {}, {}
        self.voice = Voice()

    def prune(self):
        now = self.clock()
        for token, player in list(self.sessions.items()):
            if now - player['seen'] > TTL:
                self.remove(token)
        self.joins = {ip: hits for ip, hits in self.joins.items() if hits[-1] > now - 60}

    def remove(self, token):
        player = self.sessions.pop(token, None)
        if player:
            room = self.rooms[player['room']]
            room.pop(token, None)
            if not room:
                del self.rooms[player['room']]

    @staticmethod
    def state(data):
        result = {}
        for key, low, high in [('x', -1000, 1000), ('y', -10, 300), ('z', -1000, 1000), ('yaw', -360, 360), ('speed', 0, 13.412)]:
            value = data.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise Rejected(400, 'Invalid player position.')
            result[key] = value
        look = data.get('look')
        if not isinstance(look, list) or len(look) != len(LIMITS) or any(type(v) is not int or not 0 <= v < cap for v, cap in zip(look, LIMITS)):
            raise Rejected(400, 'Invalid appearance.')
        result['look'] = look
        return result

    def handle(self, path, data, ip):
        with self.lock:
            self.prune()
            now = self.clock()
            if path == '/join':
                hits = [t for t in self.joins.get(ip, []) if t > now - 60]
                if len(hits) >= 20:
                    raise Rejected(429, 'Too many join attempts. Wait a minute.')
                self.joins[ip] = hits + [now]
                name = data.get('name', '')
                if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9 _-]{1,24}', name) or not name.strip():
                    raise Rejected(400, 'Use 1–24 letters, numbers, spaces, hyphens or underscores for your name.')
                code = data.get('room', '')
                if not isinstance(code, str):
                    raise Rejected(400, 'Invalid room code.')
                code = code.strip().upper()
                create = data.get('create') is True
                state = self.state(data)
                if create:
                    if len(self.rooms) >= 100:
                        raise Rejected(503, 'Server is full. Try again later.')
                    code = secrets.token_hex(4).upper()
                    while code in self.rooms:
                        code = secrets.token_hex(4).upper()
                elif not re.fullmatch(r'[A-F0-9]{8}', code) or code not in self.rooms:
                    raise Rejected(404, 'Room not found. Check the code and server address.')
                if len(self.rooms.get(code, {})) >= 12:
                    raise Rejected(409, 'This room is full (12 players).')
                token = secrets.token_urlsafe(32)
                player = dict(state, id=secrets.token_hex(8), name=name.strip(), room=code, seen=now, last=0, credits=0, coins=[])
                self.rooms.setdefault(code, {})[token] = player
                self.sessions[token] = player
                return dict(token=token, id=player['id'], room=code, players=self.snapshot(code))
            token = data.get('token')
            if not isinstance(token, str) or token not in self.sessions:
                raise Rejected(401, 'Session ended. Please join again.')
            player = self.sessions[token]
            if path.startswith('/voice/'):
                return self.voice.handle(self, path, data, token)
            if path == '/leave':
                self.remove(token)
                return {'ok': True}
            if path != '/sync':
                raise Rejected(404, 'Unknown request.')
            if now - player['last'] < .025:
                raise Rejected(429, 'Updates are too frequent.')
            state = self.state(data)
            coin = data.get('coin', -1)
            if type(coin) is not int or not -1 <= coin < len(COINS):
                raise Rejected(400, 'Invalid coin.')
            if coin >= 0 and coin not in player['coins']:
                target = COINS[coin]
                if sum((state[k]-target[i])**2 for i,k in enumerate(('x','y','z'))) > 9:
                    raise Rejected(400, 'Move closer to the coin.')
                player['coins'].append(coin)
                player['credits'] += 10
            player.update(state, seen=now, last=now)
            return dict(room=player['room'], players=self.snapshot(player['room']))

    def snapshot(self, code):
        return [{k: v for k, v in p.items() if k not in ('room', 'seen', 'last')} for p in self.rooms[code].values()]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Avoid logging room codes and session credentials.

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def reply(self, status, value):
        body = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', self.server.origin)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(200, {})

    def do_GET(self):
        if self.path == '/leaderboard':
            with self.server.rooms.lock:
                self.server.rooms.prune()
                ranked = sorted(self.server.rooms.sessions.values(), key=lambda p: (-p['credits'], p['name'], p['id']))[:5]
                entries = [dict(name=p['name'], credits=p['credits']) for p in ranked]
            self.reply(200, {'entries': entries})
            return
        if self.path == '/presence':
            with self.server.rooms.lock:
                self.server.rooms.prune()
                count = len(self.server.rooms.sessions)
            self.reply(200, {'total': count, 'london': count, 'protocol': 1})
            return
        self.reply(200 if self.path == '/health' else 404, {'service': 'Mini UK London playtest', 'protocol': 1})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= (32768 if self.path.startswith('/voice/') else 8192 if self.path == '/feedback' else 4096):
                raise Rejected(413, 'Request too large or empty.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise Rejected(400, 'Expected an object.')
            if self.path == '/feedback':
                self.reply(200, self.server.feedback.submit(data, self.client_address[0]))
                return
            if self.path not in ('/join', '/sync', '/leave', '/voice/join', '/voice/poll', '/voice/signal', '/voice/leave'):
                raise Rejected(404, 'Unknown request.')
            self.reply(200, self.server.rooms.handle(self.path, data, self.client_address[0]))
        except (Rejected, FeedbackError, VoiceError) as error:
            self.reply(error.status, {'error': error.message})
        except (ValueError, TypeError, UnicodeError):
            self.reply(400, {'error': 'Invalid request.'})
        except (TimeoutError, ConnectionError):
            pass
        except (sqlite3.Error, OSError):
            self.reply(503, {'error': 'Suggestions could not be saved. Please try again later.'})


def make_server(host='127.0.0.1', port=8787, origin='*'):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.rooms = Rooms()
    server.feedback = Feedback()
    server.origin = origin
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--origin', default='*', help='Allowed browser origin; set to your game URL when hosting.')
    args = parser.parse_args()
    with make_server(args.host, args.port, args.origin) as server:
        print(f'Mini UK London server listening at http://{args.host}:{args.port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
