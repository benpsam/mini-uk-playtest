"""Authenticated, room-scoped WebRTC signalling. No audio is stored here."""
import math
import os
import time
import secrets
import hmac
import hashlib
import base64

class VoiceError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def ice_config(player_id):
    servers = [{'urls': ['stun:stun.l.google.com:19302']}]
    urls = [v.strip() for v in os.environ.get('MINIUK_TURN_URLS', '').split(',') if v.strip()]
    secret = os.environ.get('MINIUK_TURN_SECRET', '')
    if urls and secret and all(v.startswith(('turn:', 'turns:')) for v in urls):
        username = str(int(time.time()) + 3600) + ':' + player_id
        credential = base64.b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
        servers.append(dict(urls=urls, username=username, credential=credential))
    elif urls and all(v.startswith(('turn:', 'turns:')) for v in urls):
        # Provider-issued TURN credentials, not the provider's management API key.
        username = os.environ.get('MINIUK_TURN_USERNAME', '').strip()
        credential = os.environ.get('MINIUK_TURN_PASSWORD', '')
        if username and credential:
            servers.append(dict(urls=urls, username=username, credential=credential))
    return dict(iceServers=servers, relayAvailable=len(servers) > 1)

def distance(a,b):
    return math.sqrt(sum((a[k]-b[k])**2 for k in ('x','y','z')))

class Voice:
    def __init__(self):
        self.members = {}
        self.sequence = 0

    def handle(self, rooms, path, data, token):
        # Called while the parent room lock is held. Voice cannot extend a game session.
        now = rooms.clock()
        self.members = {k:v for k,v in self.members.items() if k in rooms.sessions and now-v['seen'] < 20}
        player = rooms.sessions[token]
        if path == '/voice/leave':
            if self.members.get(token, {}).get('epoch') == data.get('epoch'):
                self.members.pop(token, None)
            return {'ok': True}
        if path == '/voice/join':
            self.members[token] = dict(epoch=secrets.token_hex(8), seen=now, queue=[], hits=[])
            return dict(epoch=self.members[token]['epoch'], **ice_config(player['id']))
        member = self.members.get(token)
        if member is None or data.get('epoch') != member['epoch']:
            raise VoiceError(409, 'Voice session ended. Turn voice off and on to reconnect.')
        member['seen'] = now
        if path == '/voice/poll':
            ack = data.get('ack', 0)
            if type(ack) is not int or ack < 0:
                raise VoiceError(400, 'Invalid voice acknowledgement.')
            member['queue'] = [m for m in member['queue'] if m['seq'] > ack and now-m['time'] < 30]
            peers = [dict(id=p['id'], name=p['name'], epoch=self.members[t]['epoch'], distance=distance(player,p))
                     for t,p in rooms.rooms[player['room']].items() if t != token and t in self.members and distance(player,p) < 25]
            nearby = {p['id'] for p in peers}
            return dict(peers=peers, messages=[{k:v for k,v in m.items() if k != 'time'} for m in member['queue'] if m['sender'] in nearby])
        if path != '/voice/signal':
            raise VoiceError(404, 'Unknown voice request.')
        hits = [t for t in member['hits'] if now-t < 30]
        if len(hits) >= 60:
            raise VoiceError(429, 'Voice updates too frequent.')
        member['hits'] = hits + [now]
        kind, sdp = data.get('type'), data.get('sdp')
        if kind not in ('offer', 'answer') or not isinstance(sdp, str) or not sdp.startswith('v=0') or len(sdp) > 20000:
            raise VoiceError(400, 'Invalid voice signal.')
        target = next((t for t,p in rooms.rooms[player['room']].items() if p['id'] == data.get('to') and t != token), None)
        dest = self.members.get(target)
        if dest is None or data.get('toEpoch') != dest['epoch'] or distance(player,rooms.sessions[target]) >= 25:
            raise VoiceError(404, 'Player is no longer in this voice room.')
        dest['queue'] = [m for m in dest['queue'] if now-m['time'] < 30]
        if len(dest['queue']) >= 48:
            raise VoiceError(429, 'Voice inbox busy. Try reconnecting.')
        self.sequence += 1
        dest['queue'].append(dict(seq=self.sequence, time=now, sender=player['id'], epoch=member['epoch'], type=kind, sdp=sdp))
        return {'ok': True}
