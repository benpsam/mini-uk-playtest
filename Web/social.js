/* Private social panel. Credentials remain in memory; text is rendered with textContent. */
(()=>{
'use strict';
let view='list',quickKind='',quickRequest='';
let session=null,selected=null,snapshot=null,activeCall='',matchId='',pollTimer,threadTimer,lastTyping=0,requestGeneration=0;
const paths={
 chat:'M6 3h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-5l-5 4v-4H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4 M7 11h.1 M12 11h.1 M17 11h.1',voice:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
 status:'M2 12h5l3-8 4 16 3-8h5',picture:'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M16 8h.1',
 once:'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12 M12 9v6 M10 10l2-1',
 game:'M5 6h14l3 12-5-3H7l-5 3z M6 10h6 M9 7v6 M16 10h.1 M19 12h.1',
 mute:'M3 9h4l5-5v16l-5-5H3z M16 9l6 6 M22 9l-6 6',
 block:'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20 M5 5l14 14',
 report:'M5 22V3h14l-3 5 3 5H5',people:'M8 4a3 3 0 1 0 0 6 3 3 0 1 0 0-6 M2 21v-4a6 6 0 0 1 12 0v4 M17 5a3 3 0 0 1 0 6 M17 15a5 5 0 0 1 5 5',
 board:'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',close:'M5 5l14 14 M19 5L5 19'
};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.chat);svg.append(p);return svg;}
function node(tag,text,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n;}
function button(parent,label,kind,fn){const b=node('button',undefined,parent);b.type='button';b.title=label;b.setAttribute('aria-label',label);if(kind)b.append(icon(kind));b.append(document.createTextNode(label));b.onclick=()=>Promise.resolve().then(fn).catch(showError);return b;}
const launch=button(document.getElementById('stage'),'Players','people',()=>open());launch.id='social-launch';launch.hidden=true;
const panel=node('section',undefined,document.getElementById('stage'));panel.id='social-panel';panel.hidden=true;panel.setAttribute('aria-label','Private player interactions');
const header=node('header',undefined,panel),title=node('strong','Players',header);button(header,'Close','close',()=>close());
const notice=node('p','',panel);notice.setAttribute('role','status');const body=node('div',undefined,panel);
const css=node('link',undefined,document.head);css.rel='stylesheet';css.href='social.css';
for(const event of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','keydown','keyup'])panel.addEventListener(event,e=>e.stopPropagation());
panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
function showError(e){notice.textContent=e.message||String(e);}
function busyState(){window.MiniUKSocialOpen=!panel.hidden;}
function close(){panel.hidden=true;busyState();clearTimeout(threadTimer);}
function clear(){body.replaceChildren();notice.textContent='';clearTimeout(threadTimer);}
async function api(action,data={}){
 if(!session)throw Error('Connect to the game first.');
 const s=session;const r=await fetch(s.endpoint+'/social/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:s.token,...data}),signal:AbortSignal.timeout(25000),cache:'no-store'});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed.');return result;
}
function name(id){return snapshot?.people.find(p=>p.id===id)?.name||snapshot?.contacts.find(p=>p.id===id)?.name||'Player';}
async function open(id){
 panel.hidden=false;busyState();launch.focus();clear();
 if(id){selected=id;return actions();}
 await refresh();list();
}
function list(){
 view='list';
 clear();selected=null;title.textContent='Players in this session';
 button(body,'Global leaderboard','board',()=>leaderboard(0));
 for(const p of snapshot?.people||[])button(body,p.name+' · online','people',()=>{selected=p.id;actions();});
 if(!snapshot?.people.length)node('p','No other players are in this session yet.',body);
 if(snapshot?.contacts.length){node('h3','Saved contacts',body);for(const c of snapshot.contacts)button(body,c.name,'people',()=>{selected=c.id;actions();});}
 if(snapshot?.controls.length){
  node('h3','Muted / blocked',body);
  for(const c of snapshot.controls)button(body,name(c.target)+' · undo '+c.kind,c.kind,async()=>{await api('control',{target:c.target,kind:c.kind,duration:0});await refresh();list();});
 }
 renderRequests();
}
function renderRequests(){
 const requests=(snapshot?.invitations||[]).filter(i=>i.recipient===snapshot.me&&i.state==='pending');
 for(const i of requests){
  const card=node('div',undefined,body);card.className='social-card';node('p',name(i.sender)+' requests '+i.kind,card);
  button(card,'Accept',i.kind==='voice'?'voice':i.kind==='game'?'game':i.kind==='chat'?'chat':'picture',async()=>{await api('respond',{id:i.id,accept:true});if(i.kind==='voice'){activeCall=i.id;window.MiniUKVoice.setPrivate(i.id);}if(i.kind==='chat'){selected=i.sender;await refresh();return chat();}if(i.kind==='game'){selected=i.sender;matchId=i.id;return game();}await refresh();list();});
  button(card,'Decline','block',async()=>{await api('respond',{id:i.id,accept:false});await refresh();list();});
 }
 for(const s of snapshot?.statuses||[])node('p',name(s.sender)+': '+s.body+' · temporary status',body);
 for(const u of snapshot?.unread||[])button(body,name(u.sender)+' · '+u.count+' unread','chat',()=>{selected=u.sender;chat();});
}
function actions(){
 view='actions';
 clear();title.textContent=name(selected);
 button(body,'Back to players','people',()=>list());
 const grid=node('div',undefined,body);grid.className='social-grid';
 button(grid,'Private Chat','chat',chat);
 button(grid,'Voice Call','voice',()=>invite('voice'));
 button(grid,'Live Status','status',statusForm);
 const picture=button(grid,'Send Picture','picture',()=>pictureForm(false));picture.disabled=!snapshot?.pictures;picture.title=picture.disabled?'Picture sharing awaits moderation setup':'Request picture permission';
 const once=button(grid,'View Once','once',()=>pictureForm(true));once.disabled=!snapshot?.pictures;
 button(grid,'Play Game','game',()=>invite('game'));
 button(grid,'Mute','mute',()=>control('mute'));
 button(grid,'Block','block',()=>control('block'));
 button(grid,'Report','report',reportForm);
 button(body,'Save contact','people',async()=>{await api('contact',{target:selected});notice.textContent='Contact saved.';});
 if(!snapshot?.pictures)node('p','Picture sharing is disabled until safety checking is configured.',body);
 const call=snapshot?.invitations.find(i=>i.kind==='voice'&&i.state==='accepted'&&(i.sender===selected||i.recipient===selected));
 if(call)button(body,'Join accepted private call','voice',()=>{activeCall=call.id;window.MiniUKVoice.setPrivate(call.id);notice.textContent='Tap Turn on mic in the voice controls. Public voice is disconnected.';});
 if(activeCall)button(body,'End private call','voice',async()=>{await api('end',{id:activeCall});window.MiniUKVoice.endPrivate();activeCall='';actions();});
 const match=snapshot?.invitations.find(i=>i.kind==='game'&&i.state==='accepted'&&(i.sender===selected||i.recipient===selected));
 if(match)button(body,'Open noughts and crosses','game',()=>{matchId=match.id;game();});
}
async function invite(kind){const r=await api('invite',{target:selected,kind});notice.textContent='Request sent. Waiting for accept or decline.';await refresh();return r;}
function input(parent,label,max=1000){node('label',label,parent);const el=node('textarea',undefined,parent);el.maxLength=max;el.setAttribute('aria-label',label);return el;}
async function chat(){
 view='chat';
 clear();title.textContent='Private · '+name(selected);button(body,'Back','people',actions);
 const log=node('div',undefined,body);log.className='social-messages';log.setAttribute('aria-live','polite');
 const presence=node('p','',body),draft=input(body,'Message (only you and this player)',1000);
 draft.oninput=()=>{if(Date.now()-lastTyping>3000){lastTyping=Date.now();api('typing',{target:selected}).catch(()=>{});}};
 button(body,'Send','chat',async()=>{if(!draft.value.trim())return;await api('send',{target:selected,body:draft.value,id:crypto.randomUUID()});draft.value='';notice.textContent='Message sent';await update();});
 const images=node('div',undefined,body);let target=selected;
 async function update(){
  if(panel.hidden||selected!==target||!log.isConnected)return;
  const data=await api('thread',{target});log.replaceChildren();images.replaceChildren();
  const seen=[];
  for(const m of data.messages){node('p',(m.sender===snapshot.me?'You: ':'Them: ')+m.body+' · '+(m.seen?'Seen':m.delivered?'Delivered':'Sent'),log);if(m.recipient===snapshot.me&&!m.seen)seen.push(m.id);}
  if(seen.length&&!document.hidden)await api('seen',{target,ids:seen});
  presence.textContent=data.typing?'Typing…':data.online?'Online in this session':'Offline / unavailable';
  for(const m of data.media)if(!m.consumed)button(images,m.once_only?'View Once · open picture':'Open picture',m.once_only?'once':'picture',()=>viewImage(m.id));
 }
 async function tick(){try{await update();}catch(e){showError(e);}if(!panel.hidden&&log.isConnected)threadTimer=setTimeout(tick,2000);}
 await tick();
}
function statusForm(){
 view='status';
 clear();button(body,'Back','people',actions);const value=input(body,'Temporary status for '+name(selected),100);
 const duration=node('select',undefined,body);for(const [v,l] of [[300,'5 minutes'],[900,'15 minutes'],[3600,'1 hour']]){const o=node('option',l,duration);o.value=v;}
 button(body,'Share status','status',async()=>{await api('status',{target:selected,body:value.value,duration:Number(duration.value)});notice.textContent='Status shared only with this player.';});
}
function control(kind){
 view='control';
 clear();button(body,'Back','people',actions);
 for(const [duration,label] of [[18000,'5 Hours'],[86400,'24 Hours'],[-1,'Until manually reversed'],[0,'Remove '+kind]])button(body,label,kind,async()=>{await api('control',{target:selected,kind,duration});if(activeCall){window.MiniUKVoice.endPrivate();activeCall='';}await refresh();notice.textContent=kind+' updated.';});
}
function reportForm(){
 view='report';
 clear();button(body,'Back','people',actions);const category=node('select',undefined,body);for(const c of snapshot.categories)node('option',c,category);
 const notes=input(body,'Optional notes',1000);button(body,'Submit report','report',async()=>{await api('report',{target:selected,category:category.value,notes:notes.value});notice.textContent='Report submitted for review.';});
}
function pictureForm(once){
 view='picture';
 clear();button(body,'Back','people',actions);
 const permission=snapshot.invitations.find(i=>i.kind==='picture'&&i.sender===snapshot.me&&i.recipient===selected&&i.state==='accepted');
 if(!permission){button(body,'Request permission to send a picture','picture',()=>invite('picture'));node('p','The recipient must accept before you can upload. One approval allows one picture.',body);return;}
 node('p','Please do not upload sexual/explicit content, gore, graphic violence, illegal content, or other prohibited material. Images may be automatically checked for safety. Violations may result in restrictions or account action.',body);
 node('p','Safety checking sends the image to OpenAI before delivery. View Once cannot prevent screenshots.',body);
 button(body,'CANCEL','close',actions);
 button(body,'I UNDERSTAND','picture',()=>{
  const file=node('input',undefined,body);file.type='file';file.accept='image/jpeg,image/png,image/webp';
  file.onchange=async()=>{try{
   const f=file.files[0];if(!f)return;if(f.size>2000000)throw Error('Maximum file size is 2 MB.');
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});
   file.disabled=true;notice.textContent='Checking picture safety…';
   await api('upload',{target:selected,invitation:permission.id,once,understood:true,data});
   notice.textContent='Picture delivered.';await refresh();
  }catch(e){showError(e);}finally{file.remove();}};file.click();
 });
}
async function viewImage(id){
 view='image';
 const data=await api('open-image',{id});clear();node('p',data.viewOnce?'View Once · this picture cannot be reopened. Screenshots are possible.':'Private picture',body);
 const image=node('img',undefined,body);image.alt='Private shared picture';image.src='data:image/jpeg;base64,'+data.data;image.className='social-image';
 button(body,'Close picture','close',chat);
}
async function game(){
 view='game';
 clear();title.textContent='Noughts and crosses';button(body,'Back','people',actions);const board=node('div',undefined,body);board.className='social-board';const result=node('p','',body);
 async function tick(){
  if(panel.hidden||!board.isConnected)return;
  try{const m=await api('match',{id:matchId});board.replaceChildren();
   for(let i=0;i<9;i++){const b=button(board,m.board[i]==='.'?'—':m.board[i],null,async()=>{await api('move',{id:matchId,cell:i});await tick();});b.setAttribute('aria-label','Row '+(Math.floor(i/3)+1)+', column '+(i%3+1)+', '+(m.board[i]==='.'?'empty':m.board[i]));b.disabled=m.state!=='playing'||m.turn!==snapshot.me||m.board[i]!=='.';}
   result.textContent=m.state==='finished'?(m.winner?(m.winner===snapshot.me?'You won!':'Other player won.'):'Draw.') : m.state!=='playing'?'Game expired.':m.turn===snapshot.me?'Your turn':'Waiting for the other player';
  }catch(e){showError(e);}
 }
 await tick();const loop=async()=>{await tick();if(board.isConnected&&!panel.hidden)threadTimer=setTimeout(loop,2000);};threadTimer=setTimeout(loop,2000);
}
async function leaderboard(offset){
 view='leaderboard';
 clear();title.textContent='Global game leaderboard';button(body,'Back','people',list);
 const result=await api('leaderboard',{offset});
 for(const p of result.entries){
  const row=node('div',undefined,body);row.className='social-score';
  const avatar=node('canvas',undefined,row);avatar.width=40;avatar.height=48;avatar.setAttribute('aria-label','Player avatar');const c=avatar.getContext('2d');
  c.fillStyle=['#f2c29c','#c98c61','#87543b','#4a2e24'][p.avatar[1]]||'#c98c61';c.fillRect(7,6,26,28);
  c.fillStyle=['#263a48','#ad261f','#ead4a6','#2e3b54','#cc7d1f','#5c3d73'][p.avatar[4]]||'#2e3b54';c.fillRect(2,34,36,14);
  c.fillStyle='#252a30';c.fillRect(12,16,4,5);c.fillRect(24,16,4,5);c.fillRect(15,26,12,2);
  node('p',p.rank+'. '+p.name+' · '+p.score+' points · '+p.wins+' wins / '+p.losses+' losses · best '+p.best,row);
 }
 if(!result.entries.length)node('p','No scores yet. Finish a game to enter the leaderboard.',body);
 if(offset)button(body,'Previous page','board',()=>leaderboard(Math.max(0,offset-20)));
 if(result.entries.length===20)button(body,'Next page','board',()=>leaderboard(offset+20));
}
async function refresh(){
 const generation=requestGeneration;const next=await api('poll');if(generation!==requestGeneration)return;
 snapshot=next;window.MiniUKHud?.social(next);
 const accepted=snapshot.invitations.find(i=>i.kind==='voice'&&i.state==='accepted');
 if(!activeCall&&accepted){activeCall=accepted.id;window.MiniUKVoice.setPrivate(accepted.id);}
 if(activeCall&&!snapshot.invitations.some(i=>i.id===activeCall&&i.state==='accepted')){window.MiniUKVoice.endPrivate();activeCall='';}
 const count=snapshot.invitations.filter(i=>i.recipient===snapshot.me&&i.state==='pending').length+snapshot.unread.reduce((a,u)=>a+u.count,0);
 launch.setAttribute('aria-label','Players'+(count?' · '+count+' new interactions':''));launch.lastChild.textContent=count?'Players ('+count+')':'Players';
}
async function poll(){
 if(!session)return;
 try{await refresh();if(!panel.hidden&&view==='quick'){const ready=snapshot.invitations.find(i=>i.kind==='chat'&&i.state==='accepted'&&(i.sender===selected||i.recipient===selected));if(ready&&quickKind==='chat')await chat();else if(quickRequest){const request=snapshot.invitations.find(i=>i.id===quickRequest);if(!request)notice.textContent='Request expired. Close and try again.';else if(request.state==='declined')notice.textContent='Request declined.';else if(request.state==='accepted')notice.textContent='Voice request accepted. Turn on your mic using the voice controls.';}}if(!panel.hidden&&view==='list')list();else if(!panel.hidden&&view==='actions'){const statusText=notice.textContent;actions();notice.textContent=statusText;}}catch(e){if(!panel.hidden)showError(e);}
 if(session)pollTimer=setTimeout(poll,document.hidden?10000:3000);
}
// Head controls follow Unity's projected avatar positions, never world coordinates from the network.
const headLayer=node('div',undefined,document.getElementById('stage'));headLayer.id='social-heads';
const headNodes=new Map();let headTime=0;
for(const event of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','keydown','keyup'])headLayer.addEventListener(event,e=>e.stopPropagation());
function clearHeads(){headLayer.replaceChildren();headNodes.clear();}
function heads(players){
 headTime=performance.now();
 const canvas=document.getElementById('game');if(!session||!canvas){clearHeads();return;}
 const r=canvas.getBoundingClientRect(),keep=new Set();
 for(const p of players){
  if(!p.id||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
  keep.add(p.id);let entry=headNodes.get(p.id);
  if(!entry){
   const el=node('div',undefined,headLayer);el.className='social-head'+(p.id==='self'?' is-self':'');
   const bubble=node('div',undefined,el);bubble.className='head-bubble';
   const chatButton=button(bubble,'Request chat','chat',()=>quick(p.id,'chat'));
   const voiceButton=button(bubble,'Request voice call','voice',()=>quick(p.id,'voice'));
   for(const [b,kind] of [[chatButton,'chat'],[voiceButton,'voice']]){b.lastChild.remove();b.className='head-'+kind;}
   const label=node('span','',el);label.className='head-name';
   entry={el,label,chatButton,voiceButton};headNodes.set(p.id,entry);
  }
  entry.label.textContent=p.name;
  entry.el.style.left=(r.left+p.x*r.width)+'px';entry.el.style.top=(r.top+p.y*r.height)+'px';
  const blocked=snapshot?.controls.some(c=>c.target===p.id&&c.kind==='block');
  entry.chatButton.disabled=entry.voiceButton.disabled=!!blocked;
  const pending=snapshot?.invitations.some(i=>i.sender===p.id&&i.recipient===snapshot.me&&i.state==='pending');
  entry.el.classList.toggle('has-request',!!pending);
  entry.el.hidden=!panel.hidden||document.hidden||p.y*r.height<90;
 }
 for(const [id,entry] of headNodes)if(!keep.has(id)){entry.el.remove();headNodes.delete(id);}
}
async function quick(id,kind){
 if(id==='self'){if(kind==='voice'){const v=document.getElementById('voice-panel');v.open=true;return;}return choose('chat');}
 panel.hidden=false;busyState();clear();view='quick';selected=id;quickKind=kind;quickRequest='';
 try{
  await refresh();title.textContent=name(id);
  const incoming=snapshot.invitations.find(i=>i.sender===id&&i.recipient===snapshot.me&&i.kind===kind&&i.state==='pending');
  if(incoming){renderRequests();return;}
  const accepted=snapshot.invitations.find(i=>(i.sender===id||i.recipient===id)&&i.kind===kind&&i.state==='accepted');
  if(accepted&&kind==='chat')return chat();
  if(accepted){notice.textContent='Private call accepted. Enable your microphone using the voice button.';return;}
  const outgoing=snapshot.invitations.find(i=>i.sender===snapshot.me&&i.recipient===id&&i.kind===kind&&i.state==='pending');
  quickRequest=outgoing?outgoing.id:(await invite(kind)).id;
  notice.textContent=(kind==='chat'?'Chat':'Voice')+' request sent. Waiting for '+name(id)+'.';
  button(body,'More options','people',actions);
 }catch(e){showError(e);}
}
setInterval(()=>{if(performance.now()-headTime>500)clearHeads();},500);
async function choose(kind='people'){
 panel.hidden=false;busyState();clear();view='chooser';selected=null;
 try{await refresh();title.textContent=kind==='game'?'Challenge a player':kind==='chat'?'Choose someone to chat with':'Players';
 for(const p of snapshot.people)button(body,p.name,kind==='game'?'game':kind==='chat'?'chat':'people',()=>{selected=p.id;if(kind==='game'){actions();return invite('game');}if(kind==='chat')return quick(p.id,'chat');actions();});
 if(!snapshot.people.length)node('p','No other players in this session yet. Invite a friend to the same city.',body);
 button(body,'Contacts & requests','people',list);
 }catch(e){showError(e);}
}
window.MiniUKSocial={choose,heads,session(endpoint,token,id){requestGeneration++;clearTimeout(pollTimer);session={endpoint,token,id};launch.hidden=false;void poll();},leave(){clearHeads();requestGeneration++;clearTimeout(pollTimer);session=null;snapshot=null;selected=null;activeCall='';launch.hidden=true;close();},select(id){open(id).catch(showError);}};
})();
