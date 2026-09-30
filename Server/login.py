"""Optional Google authentication; no email/profile data is stored or returned."""
import json, os, secrets, threading, time
from http.cookies import SimpleCookie

class Login:
    def __init__(self):
        self.pending = {}; self.sessions = {}; self.grants = {}; self.lock = threading.Lock()
    def prune(self):
        now = time.time()
        for store in (self.pending, self.sessions, self.grants):
            for key in list(store):
                if store[key]['expires'] < now: del store[key]
    def wardrobe_allowed(self, ticket):
        if not isinstance(ticket,str): return False
        with self.lock:
            grant=self.grants.get(ticket)
            return bool(grant and grant['expires']>time.time())
    def cookie(self, handler, name):
        try:
            cookies = SimpleCookie(); cookies.load(handler.headers.get('Cookie', ''))
            return cookies[name].value if name in cookies else ''
        except Exception: return ''
    def reply(self, h, code, body, cookie=None):
        data = json.dumps(body).encode(); h.send_response(code)
        h.send_header('Content-Type', 'application/json'); h.send_header('Cache-Control', 'no-store')
        h.send_header('Content-Length', str(len(data)))
        if cookie: h.send_header('Set-Cookie', cookie)
        h.end_headers(); h.wfile.write(data)
    @staticmethod
    def header(name, value, age):
        return f'{name}={value}; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age={age}'
    def handle(self, h, path):
        client = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
        if h.command == 'GET' and path == '/auth/config':
            nonce = secrets.token_urlsafe(32)
            with self.lock:
                self.prune()
                if len(self.pending) >= 2048: return self.reply(h, 429, {'error':'Please try again shortly.'})
                self.pending[nonce] = {'expires':time.time()+600}
            return self.reply(h, 200, {'clientId':client, 'nonce':nonce}, self.header('miniuk_nonce',nonce,600))
        if h.command == 'GET' and path == '/auth/session':
            with self.lock:
                self.prune(); session = self.sessions.get(self.cookie(h,'miniuk_login'))
            return self.reply(h,200,{'signedIn':bool(session),'wardrobeTicket':session['ticket'] if session else '', 'expires':session['expires'] if session else 0})
        origins = {'https://www.miniukworld.com','https://miniukworld.com','https://mini-uk-playtest.onrender.com'}
        origins.update(x.strip() for x in os.environ.get('AUTH_ORIGINS','').split(',') if x.strip())
        if h.command != 'POST' or h.headers.get('Origin') not in origins or h.headers.get('X-MiniUK-Login') != '1':
            return self.reply(h,403,{'error':'Open sign-in from the Mini UK website.'})
        if path == '/auth/logout':
            with self.lock:
                previous=self.sessions.pop(self.cookie(h,'miniuk_login'),None)
                if previous:self.grants.pop(previous['ticket'],None)
            return self.reply(h,200,{'signedIn':False},self.header('miniuk_login','',0))
        if path != '/auth/google': return self.reply(h,404,{'error':'Unknown login request.'})
        if not client: return self.reply(h,503,{'error':'Google sign-in is not configured yet. Continue as guest.'})
        try:
            length=int(h.headers.get('Content-Length','0'))
            if not 0<length<=8192: raise ValueError()
            body=json.loads(h.rfile.read(length)); credential=body.get('credential')
            if not isinstance(credential,str): raise ValueError()
            nonce=self.cookie(h,'miniuk_nonce')
            with self.lock:
                self.prune()
                if not nonce or nonce not in self.pending: raise ValueError()
                del self.pending[nonce]  # Single-use login challenge.
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request
            claims=id_token.verify_oauth2_token(credential,Request(),client)
            if not claims.get('sub') or not secrets.compare_digest(str(claims.get('nonce','')),nonce): raise ValueError()
            session=secrets.token_urlsafe(32)
            with self.lock:
                self.prune()
                if len(self.sessions)>=2048: return self.reply(h,429,{'error':'Please try again shortly.'})
                ticket=secrets.token_urlsafe(32);expires=time.time()+3600
                self.sessions[session]={'sub':claims['sub'],'expires':expires,'ticket':ticket}
                self.grants[ticket]={'expires':expires}
            return self.reply(h,200,{'signedIn':True,'wardrobeTicket':ticket,'expires':expires},self.header('miniuk_login',session,3600))
        except (ValueError,TypeError,AttributeError):
            return self.reply(h,401,{'error':'Sign-in could not be verified. Refresh and try again, or continue as guest.'})
        except Exception:
            return self.reply(h,503,{'error':'Google sign-in is temporarily unavailable. Continue as guest.'})
