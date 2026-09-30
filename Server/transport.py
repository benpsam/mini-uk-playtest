"""Single-process authoritative bus schedule and atomic capacity allocation."""
import math,time,json
from pathlib import Path
from social_service import SocialError
class Transport:
 def __init__(self,clock=time.time):
  self.clock=clock;self.seats={};self.config=json.loads(Path(__file__).with_name('transport.json').read_text())
 def pose(self):
  # Two 12-second stops plus 36-second runs each direction.
  phase=self.clock()%96
  if phase<12:return dict(x=-3.6,z=-48,stop='square',departing=12-phase,direction=0)
  if phase<48:return dict(x=3.6,z=-48-(phase-12)/36*172,stop='',departing=0,direction=180)
  if phase<60:return dict(x=3.6,z=-220,stop='station',departing=60-phase,direction=180)
  return dict(x=-3.6,z=-220+(phase-60)/36*172,stop='',departing=0,direction=0)
 def snapshot(self,rooms,player):
  self.seats={k:v for k,v in self.seats.items() if k in rooms.sessions}
  bus=self.pose();capacity=self.config['bus']['capacity']
  occupied=sum(1 for k in self.seats if rooms.sessions[k]['room']==player['room'])
  return dict(**bus,capacity=capacity,occupied=occupied,seat=self.seats.get(next((t for t,p in rooms.sessions.items() if p is player),''),-1),route=self.config['bus']['name'],stops=self.config['bus']['stops'])
 def handle(self,rooms,player,token,action):
  info=self.snapshot(rooms,player)
  if action=='state':return info
  if player.get('city','london')!='london':raise SocialError(400,'Bus service is in London.')
  if action=='exit':
   self.seats.pop(token,None);return dict(**self.snapshot(rooms,player),exitX=9,exitZ=info['z'])
  if action!='board':raise SocialError(404,'Unknown bus action.')
  if token in self.seats:return info
  if not info['stop'] or (player['x']-info['x'])**2+(player['z']-info['z'])**2>144:raise SocialError(409,'Wait beside a bus stop for the bus to arrive.')
  used={seat for t,seat in self.seats.items() if rooms.sessions[t]['room']==player['room']}
  seat=next((i for i in range(info['capacity']) if i not in used),None)
  if seat is None:raise SocialError(409,'This bus is currently full. Please wait for the next bus.')
  self.seats[token]=seat;return self.snapshot(rooms,player)
