"""Room-scoped Highland rides. Called under Rooms.lock for atomic boarding."""
import math,time
from social_service import SocialError
ROAD=[(0,.2,146),(0,.2,165),(-50,9.2,210),(-50,18.2,250)]
A=(-58,18.3,260);B=(-235,52.3,260)
def mix(a,b,t):return tuple(x+(y-x)*t for x,y in zip(a,b))
def path(points,t):
 lengths=[math.dist(a,b) for a,b in zip(points,points[1:])];distance=max(0,min(1,t))*sum(lengths)
 for a,b,length in zip(points,points[1:],lengths):
  if distance<=length:return mix(a,b,distance/length),math.degrees(math.atan2(b[0]-a[0],b[2]-a[2]))
  distance-=length
 return points[-1],0
class Highlands:
 def __init__(self,clock=time.monotonic):self.clock=clock;self.rides={};self.seats={}
 def route(self,i):return [(-25+i*5,.2,137),*ROAD]
 def pose(self,room,i):
  now=self.clock();record=self.rides.get((room,i));elapsed=now-record['start'] if record else 0
  if i<6:
   reverse=bool(record and record['back']);duration=32
   if not record:p,yaw=self.route(i)[0],0;stop='Car stand'
   else:
    p,yaw=path(list(reversed(self.route(i))) if reverse else self.route(i),elapsed/duration)
    stop=('Car stand' if reverse else 'Summit') if elapsed>=duration else ''
   kind='car';capacity=4
  elif i==6:
   phase=now%100
   if phase<15:p=A;stop='Summit'
   elif phase<50:
    t=(phase-15)/35;p=mix(A,B,t);p=(p[0],p[1]-6*math.sin(math.pi*t),p[2]);stop=''
   elif phase<65:p=B;stop='Sea ridge'
   else:
    t=(phase-65)/35;p=mix(B,A,t);p=(p[0],p[1]-6*math.sin(math.pi*t),p[2]);stop=''
   yaw=270 if phase<65 else 90;kind='cable';capacity=4
  else:
   start=(-42+(i-7)*5,18.3,250)
   points=[start,(-85,45,225),(-150,38,185),(-145,24,120),(-70,14,105),(-24,1,130)]
   p,yaw=path(points,elapsed/50) if record else (start,270)
   stop='Landed' if record and elapsed>=50 else 'Launch' if not record else '';kind='glider';capacity=1
  return dict(id=i,kind=kind,x=p[0],y=p[1],z=p[2],yaw=yaw,stop=stop,capacity=capacity)
 def prune(self,rooms):
  self.seats={t:v for t,v in self.seats.items() if t in rooms.sessions}
  active={p['room'] for p in rooms.sessions.values()}
  self.rides={k:v for k,v in self.rides.items() if k[0] in active}
  for (room,i),r in list(self.rides.items()):
   occupied=any(v[0]==room and v[1]==i for v in self.seats.values())
   elapsed=self.clock()-r['start']
   if i>=7 and elapsed>=50:
    for token,v in list(self.seats.items()):
     if v[:2]==(room,i):self.seats.pop(token,None)
    del self.rides[(room,i)]
   elif i<6 and not occupied and elapsed>62:
    if r['back']:del self.rides[(room,i)]
    else:self.rides[(room,i)]={'start':self.clock(),'back':True}
 def snapshot(self,rooms,player,token):
  self.prune(rooms);room=player['room'];vehicles=[]
  for i in range(9):
   p=self.pose(room,i);p['occupied']=sum(v[:2]==(room,i) for v in self.seats.values());vehicles.append(p)
  seat=self.seats.get(token)
  return dict(vehicles=vehicles,ride=seat[1] if seat else -1,seat=seat[2] if seat else -1)
 def handle(self,rooms,player,token,action,data):
  if player.get('city')!='scotland':raise SocialError(400,'These rides are in Scotland.')
  info=self.snapshot(rooms,player,token)
  if action=='state':return info
  current=self.seats.get(token)
  if action=='exit':
   if current and not self.pose(player['room'],current[1])['stop']:raise SocialError(409,'Wait until the ride reaches its stop.')
   self.seats.pop(token,None);return self.snapshot(rooms,player,token)
  if action=='depart':
   if not current or current[1]>=6:raise SocialError(409,'Board a shuttle car first.')
   pose=self.pose(player['room'],current[1])
   if not pose['stop']:raise SocialError(409,'The car is already travelling.')
   self.rides[current[:2]]={'start':self.clock(),'back':pose['stop']=='Summit'}
   return self.snapshot(rooms,player,token)
  if action!='board':raise SocialError(404,'Unknown Highland ride action.')
  i=data.get('ride')
  if type(i)!=int or not 0<=i<9:raise SocialError(400,'Choose a ride.')
  if current:raise SocialError(409,'Leave your current ride first.')
  p=info['vehicles'][i]
  if not p['stop'] or math.dist((player['x'],player['y'],player['z']),(p['x'],p['y'],p['z']))>8:raise SocialError(409,'Move beside the ride at its stop.')
  used={v[2] for v in self.seats.values() if v[:2]==(player['room'],i)}
  slot=next((n for n in range(p['capacity']) if n not in used),None)
  if slot is None:raise SocialError(409,'This ride is full. Please wait.')
  self.seats[token]=(player['room'],i,slot)
  if i>=7:self.rides[(player['room'],i)]={'start':self.clock(),'back':False}
  return self.snapshot(rooms,player,token)
