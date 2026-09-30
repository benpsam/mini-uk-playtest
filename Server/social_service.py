"""Authorized private actions; no Google email or subject is returned to clients."""
import json, time, uuid, re, os
from social_store import Store
class SocialError(Exception):
 def __init__(self,status,message):self.status,self.message=status,message
def uid():return uuid.uuid4().hex
def text(value,limit):
 if not isinstance(value,str) or not value.strip() or len(value)>limit or any(ord(c)<32 and c not in '\n\t' for c in value):
  raise SocialError(400,'Enter valid text within the character limit.')
 return value.strip()
class Social:
 def __init__(self,store=None,clock=time.time):
  self.db=store or Store();self.clock=clock;self.hits={};self.typing={};self.last_cleanup=0;self.control_cache={};self.call_cache={}
  self.categories=[x.strip() for x in os.environ.get('MINIUK_REPORT_CATEGORIES','Harassment,Spam,Inappropriate content,Cheating,Other').split(',') if x.strip()]
 def profile(self,name,avatar,subject=None):
  with self.db.transaction():
   row=self.db.one('SELECT id FROM profiles WHERE auth_id=?',(subject,)) if subject else None
   identity=row['id'] if row else uid()
   self.db.execute('INSERT INTO profiles(id,auth_id,name,avatar,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar',(identity,subject,name,json.dumps(avatar),self.clock()))
   return identity
 def rate(self,who,action,limit=20,period=60):
  now=self.clock();key=(who,action)
  hits=[v for v in self.hits.get(key,[]) if now-v<period]
  if len(hits)>=limit:raise SocialError(429,'Please slow down and try again shortly.')
  self.hits[key]=hits+[now]
 def control(self,owner,target,kind):
  now=self.clock();cached=self.control_cache.get(owner)
  if not cached or cached[0]+2<now:
   rows=self.db.all('SELECT target,kind,expires FROM controls WHERE owner=? AND expires>?',(owner,now))
   cached=(now,{(r['target'],r['kind']):r['expires'] for r in rows});self.control_cache[owner]=cached
  return cached[1].get((target,kind),0)>now
 def blocked(self,a,b):return self.control(a,b,'block') or self.control(b,a,'block')
 def permitted(self,a,b):
  if a==b:raise SocialError(400,'Choose another player.')
  if not self.db.one('SELECT id FROM profiles WHERE id=?',(b,)):raise SocialError(404,'Player unavailable.')
  if self.blocked(a,b):raise SocialError(403,'Communication unavailable.')
 def muted(self,a,b):return self.control(a,b,'mute')
 def active_call(self,call,a,b=None):
  cached=self.call_cache.get(call);now=self.clock()
  if not cached or cached[0]+2<now:
   cached=(now,self.db.one("SELECT * FROM invitations WHERE id=? AND kind='voice' AND state='accepted' AND expires>?",(call,now)));self.call_cache[call]=cached
  row=cached[1]
  return bool(row and row['expires']>self.clock() and a in (row['sender'],row['recipient']) and (b is None or b in (row['sender'],row['recipient']) and b!=a) and not self.blocked(row['sender'],row['recipient']))
 def cleanup(self):
  now=self.clock()
  if now-self.last_cleanup<60:return
  self.db.execute('DELETE FROM media WHERE expires<=? OR consumed=1',(now,))
  self.db.execute('DELETE FROM statuses WHERE expires<=?',(now,))
  self.db.execute('DELETE FROM controls WHERE expires<=?',(now,))
  self.db.execute('DELETE FROM messages WHERE created<?',(now-int(os.environ.get('MINIUK_MESSAGE_DAYS','7'))*86400,))
  self.db.execute('DELETE FROM invitations WHERE created<?',(now-7*86400,))
  self.db.execute('DELETE FROM moderation_events WHERE created<?',(now-30*86400,))
  self.db.execute('DELETE FROM reports WHERE created<?',(now-90*86400,))
  self.db.execute("UPDATE matches SET state='expired' WHERE state='playing' AND expires<=?",(now,))
  self.typing={k:v for k,v in self.typing.items() if v>now};self.hits={k:[v for v in a if now-v<60] for k,a in self.hits.items() if a and now-a[-1]<60};self.last_cleanup=now;self.control_cache={k:v for k,v in self.control_cache.items() if now-v[0]<10};self.call_cache={k:v for k,v in self.call_cache.items() if now-v[0]<10}
 def handle(self,action,data,player,online):
  me=player['profile'];now=self.clock()
  with self.db.transaction():
   self.rate(me,'poll' if action in ('poll','thread') else action,90 if action in ('poll','thread') else 20)
   self.cleanup()
   if action=='poll':
    people=[dict(id=p['profile'],name=p['name'],avatar=p['look'],online=True) for p in online if p['profile']!=me and not self.blocked(me,p['profile'])]
    invites=self.db.all("SELECT id,sender,recipient,kind,state,expires FROM invitations WHERE (sender=? OR recipient=?) AND expires>? ORDER BY created DESC LIMIT 40",(me,me,now))
    invites=[i for i in invites if not self.blocked(i['sender'],i['recipient']) and not (i['recipient']==me and self.muted(me,i['sender']))]
    statuses=self.db.all('SELECT sender,body,expires FROM statuses WHERE recipient=? AND expires>?',(me,now))
    statuses=[s for s in statuses if not self.blocked(me,s['sender']) and not self.muted(me,s['sender'])]
    unread=self.db.all('SELECT sender,COUNT(*) AS count FROM messages WHERE recipient=? AND seen=0 GROUP BY sender',(me,))
    unread=[u for u in unread if not self.blocked(me,u['sender']) and not self.muted(me,u['sender'])]
    controls=self.db.all('SELECT target,kind,expires FROM controls WHERE owner=? AND expires>?',(me,now))
    contacts=self.db.all('SELECT p.id,p.name,p.avatar FROM contacts c JOIN profiles p ON p.id=c.target WHERE c.owner=?',(me,))
    return dict(me=me,people=people,invitations=invites,statuses=statuses,unread=unread,controls=controls,contacts=contacts,categories=self.categories,pictures=os.environ.get('MINIUK_IMAGES_ENABLED')=='1' and bool(os.environ.get('OPENAI_API_KEY')),authenticated=player.get('authenticated',False))
   if action=='leaderboard':
    if not player.get('authenticated'):raise SocialError(403,'Sign in with Google to view the leaderboard.')
    offset=data.get('offset',0)
    if type(offset)!=int or not 0<=offset<=10000:raise SocialError(400,'Invalid page.')
    rows=self.db.all('SELECT p.id,p.name,p.avatar,s.wins,s.losses,s.draws,s.score,s.best FROM scores s JOIN profiles p ON p.id=s.profile WHERE p.auth_id LIKE ? ORDER BY s.score DESC,p.id LIMIT 20 OFFSET ?',('google:%',offset))
    for i,r in enumerate(rows):r['rank']=offset+i+1;r['avatar']=json.loads(r['avatar'])
    return dict(entries=rows,offset=offset)
   if action in ('move','match'):
    return self.game(action,data,me)
   if action in ('respond','end','control'):self.call_cache.clear()
   if action=='respond':
    row=self.db.one('SELECT * FROM invitations WHERE id=?',(data.get('id'),))
    if not row or row['recipient']!=me:raise SocialError(404,'Request unavailable.')
    self.permitted(me,row['sender'])
    if row['state']!='pending' or row['expires']<=now:raise SocialError(409,'Request has ended.')
    if type(data.get('accept')) is not bool:raise SocialError(400,'Choose accept or decline.')
    state='accepted' if data['accept'] else 'declined'
    if state=='accepted' and row['kind']=='voice':
     occupied=self.db.one("SELECT id FROM invitations WHERE kind='voice' AND state='accepted' AND expires>? AND (sender IN (?,?) OR recipient IN (?,?))",(now,me,row['sender'],me,row['sender']))
     if occupied:raise SocialError(409,'One player is already in a private call.')
    self.db.execute('UPDATE invitations SET state=?,expires=? WHERE id=?',(state,now+(1800 if row['kind']=='voice' else 600),row['id']))
    if state=='accepted' and row['kind']=='game':
     self.db.execute('INSERT INTO matches VALUES(?,?,?,?,?,?,?,?,?)',(row['id'],row['sender'],me,'.........',row['sender'],'playing','',now,now+600))
    return dict(ok=True,state=state,id=row['id'])
   if action=='end':
    row=self.db.one('SELECT * FROM invitations WHERE id=?',(data.get('id'),))
    if not row or me not in (row['sender'],row['recipient']):raise SocialError(404,'Request unavailable.')
    self.db.execute("UPDATE invitations SET state='ended' WHERE id=?",(row['id'],));return dict(ok=True)
   target=data.get('target')
   if not isinstance(target,str):raise SocialError(400,'Select a player.')
   # Safety controls and reporting remain available even after a block.
   if action=='control':
    if target==me or not self.db.one('SELECT id FROM profiles WHERE id=?',(target,)):raise SocialError(404,'Player unavailable.')
    self.control_cache.pop(me,None)
    kind=data.get('kind');duration=data.get('duration')
    if kind not in ('mute','block') or type(duration)!=int or duration not in (0,18000,86400,-1):raise SocialError(400,'Invalid duration.')
    if duration==0:self.db.execute('DELETE FROM controls WHERE owner=? AND target=? AND kind=?',(me,target,kind))
    else:
     self.db.execute('INSERT INTO controls VALUES(?,?,?,?) ON CONFLICT(owner,target,kind) DO UPDATE SET expires=excluded.expires',(me,target,kind,now+duration if duration>0 else 253402300799))
     self.db.execute("UPDATE invitations SET state='ended' WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)",(me,target,target,me))
    return dict(ok=True)
   if action=='report':
    if data.get('category') not in self.categories:raise SocialError(400,'Choose a report category.')
    self.db.execute('INSERT INTO reports VALUES(?,?,?,?,?,?,?)',(uid(),me,target,data['category'],text(data.get('notes') or 'No notes',1000),now,'open'))
    return dict(ok=True)
   self.permitted(me,target)
   if action=='contact':
    self.db.execute('INSERT INTO contacts VALUES(?,?) ON CONFLICT(owner,target) DO NOTHING',(me,target));return dict(ok=True)
   if action=='thread':
    rows=self.db.all('SELECT * FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY created DESC,id DESC LIMIT 50',(me,target,target,me))
    self.db.execute('UPDATE messages SET delivered=? WHERE sender=? AND recipient=? AND delivered=0',(now,target,me))
    return dict(messages=list(reversed(rows)),typing=self.typing.get((target,me),0)>now,online=any(p['profile']==target for p in online),media=self.db.all('SELECT id,once_only,consumed,expires FROM media WHERE sender=? AND recipient=? AND expires>?',(target,me,now)))
   if action=='seen':
    ids=data.get('ids',[])
    if not isinstance(ids,list) or len(ids)>50 or any(not isinstance(x,str) for x in ids):raise SocialError(400,'Invalid acknowledgements.')
    for identity in ids:self.db.execute('UPDATE messages SET seen=?,delivered=? WHERE id=? AND sender=? AND recipient=?',(now,now,identity,target,me))
    return dict(ok=True)
   if action=='typing':
    self.typing[(me,target)]=now+5;return dict(ok=True)
   if self.muted(target,me):raise SocialError(403,'Player is unavailable for new communication.')
   if action=='send':
    body=text(data.get('body'),1000);identity=data.get('id')
    if not isinstance(identity,str) or not re.fullmatch('[a-f0-9-]{32,36}',identity):raise SocialError(400,'Invalid message ID.')
    old=self.db.one('SELECT sender,recipient FROM messages WHERE id=?',(identity,))
    if old and (old['sender']!=me or old['recipient']!=target):raise SocialError(409,'Message ID already used.')
    self.db.execute('INSERT INTO messages(id,sender,recipient,body,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',(identity,me,target,body,now))
    return dict(id=identity,state='sent')
   if action=='status':
    duration=data.get('duration',900)
    if duration not in (300,900,3600):raise SocialError(400,'Invalid status duration.')
    self.db.execute('INSERT INTO statuses VALUES(?,?,?,?) ON CONFLICT(sender,recipient) DO UPDATE SET body=excluded.body,expires=excluded.expires',(me,target,text(data.get('body'),100),now+duration))
    return dict(ok=True)
   if action=='invite':
    kind=data.get('kind')
    if kind not in ('voice','picture','game'):raise SocialError(400,'Unknown invitation.')
    if kind=='picture' and not (os.environ.get('MINIUK_IMAGES_ENABLED')=='1' and os.environ.get('OPENAI_API_KEY')):raise SocialError(503,'Picture sharing is not configured yet.')
    if not any(p['profile']==target for p in online):raise SocialError(409,'Player is offline or in another session.')
    old=self.db.one('SELECT state,created FROM invitations WHERE sender=? AND recipient=? AND kind=? ORDER BY created DESC LIMIT 1',(me,target,kind))
    if old and now-old['created']<(86400 if old['state']=='declined' else 60):raise SocialError(429,'This player was already asked. Please wait before sending another request.')
    identity=uid();self.db.execute('INSERT INTO invitations VALUES(?,?,?,?,?,?,?)',(identity,me,target,kind,'pending',now,now+120))
    return dict(id=identity,state='pending')
   raise SocialError(404,'Unknown social action.')
 def game(self,action,data,me):
  row=self.db.one('SELECT * FROM matches WHERE id=?',(data.get('id'),))
  if not row or me not in (row['a'],row['b']):raise SocialError(404,'Game unavailable.')
  self.permitted(row['a'],row['b'])
  if action=='match':return row
  cell=data.get('cell')
  if row['state']!='playing' or row['expires']<=self.clock() or row['turn']!=me:raise SocialError(409,'Wait for your turn or start a new game.')
  if type(cell)!=int or not 0<=cell<9 or row['board'][cell]!='.':raise SocialError(400,'Invalid move.')
  board=list(row['board']);mark='X' if me==row['a'] else 'O';board[cell]=mark;board=''.join(board)
  won=any(all(board[k]==mark for k in line) for line in ((0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)))
  ended=won or '.' not in board;state='finished' if ended else 'playing';winner=me if won else ''
  self.db.execute('UPDATE matches SET board=?,turn=?,state=?,winner=? WHERE id=?',(board,row['b'] if me==row['a'] else row['a'],state,winner,row['id']))
  if ended:
   for player in (row['a'],row['b']):
    points=100 if winner==player else 25 if not winner else 0
    self.db.execute('INSERT INTO scores(profile,wins,losses,draws,score,best) VALUES(?,?,?,?,?,?) ON CONFLICT(profile) DO UPDATE SET wins=scores.wins+excluded.wins,losses=scores.losses+excluded.losses,draws=scores.draws+excluded.draws,score=scores.score+excluded.score,best=CASE WHEN scores.best>excluded.best THEN scores.best ELSE excluded.best END',(player,int(winner==player),int(bool(winner) and winner!=player),int(not winner),points,points))
  return self.db.one('SELECT * FROM matches WHERE id=?',(row['id'],))
