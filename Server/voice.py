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
        self.links=set()
        self.max_distance=float(os.environ.get('MINIUK_VOICE_MAX_DISTANCE','3'))
        self.fade_start=float(os.environ.get('MINIUK_VOICE_FADE_START','2'))
        self.exit_distance=float(os.environ.get('MINIUK_VOICE_EXIT_DISTANCE','3.2'))
        self.interval=int(os.environ.get('MINIUK_VOICE_POLL_MS','350'))
        if not (0<=self.fade_start<self.max_distance<=self.exit_distance<=10 and 200<=self.interval<=2000):
            raise ValueError('Invalid voice distance or polling settings')

    def allowed(self,rooms,token,target):
        a,b=rooms.sessions[token],rooms.sessions[target]
        pair=tuple(sorted((token,target)))
        if hasattr(rooms,'social'):
            with rooms.social.db.lock:
                if rooms.social.blocked(a['profile'],b['profile']):return False
                ca,cb=self.members[token].get('call',''),self.members[target].get('call','')
                if ca or cb:return bool(a.get('authenticated') and b.get('authenticated') and ca and ca==cb and rooms.social.active_call(ca,a['profile'],b['profile']))
                # An accepted private invitation reserves both participants, even before their next social poll.
                if rooms.social.call_for(a['profile']) or rooms.social.call_for(b['profile']):return False
        if a['room']!=b['room']:return False
        d=distance(a,b)
        ok=d<(self.exit_distance if pair in self.links else self.max_distance)
        if ok:self.links.add(pair)
        else:self.links.discard(pair)
        return ok
    def handle(self, rooms, path, data, token):
        # Called while the parent room lock is held. Voice cannot extend a game session.
        now = rooms.clock()
        expired=[v.get('call') for k,v in self.members.items() if v.get('call') and (k not in rooms.sessions or now-v['seen']>=20)]
        if expired:
            with rooms.social.db.transaction():
                for call in expired:rooms.social.db.execute("UPDATE invitations SET state='ended' WHERE id=?",(call,))
                rooms.social.call_cache.clear()
        self.members = {k:v for k,v in self.members.items() if k in rooms.sessions and now-v['seen'] < 20}
        self.links={pair for pair in self.links if all(t in self.members for t in pair)}
        player = rooms.sessions[token]
        if path == '/voice/leave':
            if self.members.get(token, {}).get('epoch') == data.get('epoch'):
                previous=self.members.pop(token,None)
                if previous.get('call') and data.get('reconnect') is not True:
                    with rooms.social.db.transaction():
                        rooms.social.db.execute("UPDATE invitations SET state='ended' WHERE id=?",(previous['call'],))
                        rooms.social.call_cache.clear()
            return {'ok': True}
        if path == '/voice/join':
            call=data.get('call','')
            if call:
                with rooms.social.db.lock:
                    if not player.get('authenticated'):raise VoiceError(403,'Sign in with Google for private calls.')
                    if not rooms.social.active_call(call,player['profile']):raise VoiceError(403,'Private call was not accepted or has ended.')
            if call and any(t!=token and v.get('call')==call and rooms.sessions[t]['profile']==player['profile'] for t,v in self.members.items()):raise VoiceError(409,'This account is already in this call on another device.')
            self.members[token] = dict(epoch=secrets.token_hex(8), seen=now, queue=[], hits=[],call=call,muted=True,speaking=False,connected=[])
            return dict(epoch=self.members[token]['epoch'], settings=dict(maxDistance=self.max_distance,fadeStart=self.fade_start,exitDistance=self.exit_distance,pollMs=self.interval), debug=os.environ.get('MINIUK_VOICE_DEBUG')=='1', **ice_config(player['id']))
        member = self.members.get(token)
        if member is None or data.get('epoch') != member['epoch']:
            raise VoiceError(409, 'Voice session ended. Turn voice off and on to reconnect.')
        member['seen'] = now
        if path == '/voice/poll':
            ack = data.get('ack', 0)
            if type(ack) is not int or ack < 0:
                raise VoiceError(400, 'Invalid voice acknowledgement.')
            member['queue'] = [m for m in member['queue'] if m['seq'] > ack and now-m['time'] < 30]
            member['muted']=data.get('muted',True) is not False
            member['speaking']=data.get('speaking') is True and not member['muted']
            connected=data.get('connected',[])
            member['connected']=[v for v in connected[:12] if isinstance(v,str)] if isinstance(connected,list) else []
            call=member.get('call','')
            with rooms.social.db.lock:
                ended=bool(call and not rooms.social.active_call(call,player['profile']))
            candidates=rooms.sessions if call else rooms.rooms[player['room']]
            peers = [dict(id=p['id'],profile=p['profile'],name=p['name'],epoch=self.members[t]['epoch'],distance=distance(player,p),private=bool(call),canSend=not rooms.social.muted(p['profile'],player['profile'],'voice'),canHear=not rooms.social.muted(player['profile'],p['profile'],'voice'),x=p['x'],y=p['y']+1.8,z=p['z'])
                     for t,p in candidates.items() if t!=token and t in self.members and self.allowed(rooms,token,t)]
            nearby = {p['id'] for p in peers}
            both=bool(call and peers and all(p['id'] in member['connected'] and player['id'] in self.members[next(t for t,v in rooms.sessions.items() if v['id']==p['id'])]['connected'] for p in peers))
            if both:
                with rooms.social.db.transaction():rooms.social.db.execute("UPDATE voice_calls SET phase='Connected' WHERE id=?",(call,))
            states=[dict(id=p['id'],profile=p['profile'],private=bool(self.members[t].get('call')),distance=distance(player,p),muted=self.members[t].get('muted',True),speaking=self.members[t].get('speaking',False) if not self.members[t].get('call') else False) for t,p in rooms.rooms[player['room']].items() if t!=token and t in self.members]
            return dict(peers=peers,states=states,callEnded=ended,callState='Ended' if ended else 'Connected' if both else 'Connecting' if call else 'Idle',local=dict(x=player['x'],y=player['y']+1.8,z=player['z'],yaw=player['yaw']),messages=[{k:v for k,v in m.items() if k != 'time'} for m in member['queue'] if m['sender'] in nearby])
        if path != '/voice/signal':
            raise VoiceError(404, 'Unknown voice request.')
        hits = [t for t in member['hits'] if now-t < 30]
        if len(hits) >= 300:
            raise VoiceError(429, 'Voice updates too frequent.')
        member['hits'] = hits + [now]
        kind, sdp = data.get('type'), data.get('sdp')
        if kind not in ('offer', 'answer','candidate') or not isinstance(sdp, str) or (kind!='candidate' and not sdp.startswith('v=0')) or len(sdp) > 20000:
            raise VoiceError(400, 'Invalid voice signal.')
        negotiation=data.get('negotiation','')
        if not isinstance(negotiation,str) or len(negotiation)>80:raise VoiceError(400,'Invalid negotiation ID.')
        if kind=='candidate':
            import json
            try:
                candidate=json.loads(sdp)
                if not isinstance(candidate,dict) or not isinstance(candidate.get('candidate'),str) or len(sdp)>4096:raise ValueError()
            except (ValueError,TypeError):raise VoiceError(400,'Invalid ICE candidate.')
        target = next((t for t,p in rooms.sessions.items() if p['id'] == data.get('to') and t != token), None)
        dest = self.members.get(target)
        if dest is None or data.get('toEpoch') != dest['epoch'] or not self.allowed(rooms,token,target):
            raise VoiceError(404, 'Player is no longer in this voice room.')
        dest['queue'] = [m for m in dest['queue'] if now-m['time'] < 30]
        if len(dest['queue']) >= 256:
            raise VoiceError(429, 'Voice inbox busy. Try reconnecting.')
        self.sequence += 1
        dest['queue'].append(dict(seq=self.sequence, time=now, sender=player['id'], epoch=member['epoch'], type=kind, sdp=sdp,negotiation=negotiation))
        return {'ok': True}
