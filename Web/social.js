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
const launch=button(document.getElementById('stage'),'Chat','chat',()=>open());launch.id='social-launch';launch.hidden=true;
const panel=node('section',undefined,document.getElementById('stage'));panel.id='social-panel';panel.hidden=true;panel.setAttribute('aria-label','Public and private chat');
const header=node('header',undefined,panel),title=node('strong','Chat',header);button(header,'Settings',null,settings);button(header,'Minimize','close',()=>close());
const tabs=node('nav',undefined,panel);tabs.className='chat-tabs';tabs.setAttribute('aria-label','Chat type');const publicTab=button(tabs,'Public',null,()=>conversation(false));const privateTab=button(tabs,'Private',null,list);
const requestsBox=node('div',undefined,panel);requestsBox.className='chat-requests';
const notice=node('p','',panel);notice.setAttribute('role','status');const body=node('div',undefined,panel);body.className='chat-body';
const css=node('link',undefined,document.head);css.rel='stylesheet';css.href='social.css';
for(const event of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','keydown','keyup'])panel.addEventListener(event,e=>e.stopPropagation());
panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
function showError(e){notice.textContent=e.message||String(e);}
function busyState(){window.MiniUKSocialOpen=!panel.hidden;if(!panel.hidden){const voice=document.getElementById('voice-panel');if(voice)voice.open=false;}}
let stopTyping=()=>{};
function close(){stopTyping();saveDraft();panel.hidden=true;busyState();clearTimeout(threadTimer);document.getElementById('game')?.focus();}
function clear(){stopTyping();stopTyping=()=>{};saveDraft();body.className='chat-body';body.replaceChildren();notice.textContent='';clearTimeout(threadTimer);}
async function api(action,data={}){
 if(!session)throw Error('Connect to the game first.');
 const s=session;const r=await fetch(s.endpoint+'/social/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:s.token,...data}),signal:AbortSignal.timeout(25000),cache:'no-store'});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed.');return result;
}
function person(id){return snapshot?.people.find(p=>p.id===id)||snapshot?.conversations?.find(p=>p.id===id)||snapshot?.publicMessages?.find(p=>p.sender===id)||snapshot?.controls.find(p=>p.target===id)||{name:'Player'};}
function name(id){return person(id).name;}
async function open(id){
 panel.hidden=false;preview.hidden=true;busyState();
 try{await refresh();if(id){selected=id;actions();}else conversation(false);}catch(e){showError(e);}
}
function selectTab(privateMode){publicTab.setAttribute('aria-pressed',String(!privateMode));privateTab.setAttribute('aria-pressed',String(privateMode));}
function list(){
 clear();view='list';selected=null;title.textContent='Chat';selectTab(true);
 const rows=new Map();for(const p of snapshot?.conversations||[])rows.set(p.id,p);for(const p of snapshot?.people||[])rows.set(p.id,{...rows.get(p.id),...p});
 if(!snapshot?.conversations?.length)node('p','No private conversations yet.',body);
 for(const p of rows.values()){
  const row=node('div',undefined,body);row.className='conversation-entry';const b=button(row,'',null,()=>{selected=p.id;chat();});b.className='conversation-row';button(row,'Block','block',()=>{selected=p.id;control('block');}).className='chat-block';
  const avatar=node('span',p.name.slice(0,1).toUpperCase(),b);avatar.className='chat-avatar';
  const content=node('span',undefined,b);node('strong',p.name,content);node('small',p.body||'Start a private conversation',content);
  if(p.online){const dot=node('span','●',b);dot.className='online-dot';dot.title='Online';}
  const n=snapshot.unread.find(u=>u.sender===p.id)?.count;if(n)node('b',String(n),b).className='chat-badge';
 }
}
function renderRequests(){
 const pending=(snapshot?.invitations||[]).filter(i=>i.recipient===snapshot.me&&i.state==='pending');
 const signature=JSON.stringify(pending);if(requestsBox.dataset.signature===signature)return;requestsBox.dataset.signature=signature;requestsBox.replaceChildren();
 for(const i of pending){
  const card=node('div',undefined,requestsBox);card.className='social-card';node('span',name(i.sender)+(i.kind==='voice'?' wants a private voice chat.':' requests '+i.kind+'.'),card);
  button(card,'Accept',null,async()=>{await api('respond',{id:i.id,accept:true});if(i.kind==='voice'){activeCall=i.id;window.MiniUKVoice.setPrivate(i.id);}await refresh();if(i.kind==='chat'){selected=i.sender;chat();}if(i.kind==='game'){selected=i.sender;matchId=i.id;game();}});
  button(card,'Decline',null,async()=>{await api('respond',{id:i.id,accept:false});await refresh();});
 }
}
function actions(){
 clear();view='actions';selectTab(true);title.textContent=name(selected);
 node('p',person(selected).online?'● Online':'Offline',body).className=person(selected).online?'online-dot':'';
 const row=node('div',undefined,body);row.className='player-actions';button(row,'Chat','chat',chat);button(row,'Voice','voice',()=>quick(selected,'voice'));button(row,'More',null,more);
}
function more(){
 clear();view='more';title.textContent=name(selected);button(body,'Back',null,chat);
 button(body,'View profile','people',async()=>{const p=await api('profile',{target:selected});clear();view='profile';title.textContent=p.name;button(body,'Back',null,more);drawAvatar(body,p.avatar);node('p',p.online?'● Online':'Offline',body);node('p',person(selected).place||'',body);});
 const muted=snapshot?.controls.some(c=>c.target===selected&&c.kind.startsWith('mute'));
 button(body,muted?'Unmute':'Mute','mute',()=>muted?unmute(selected):control('mute'));
 const blocked=snapshot?.controls.some(c=>c.target===selected&&c.kind==='block');
 button(body,blocked?'Unblock':'Block','block',async()=>{if(blocked){await setControl(selected,'block',0);more();}else control('block');}).className='danger';
 button(body,'Report','report',()=>reportForm()).className='danger';
}
function drawAvatar(parent,look){
 const a=node('canvas',undefined,parent);a.width=40;a.height=48;a.className='profile-avatar';a.setAttribute('aria-label','Player character');const c=a.getContext('2d');let v=look;try{if(typeof v==='string')v=JSON.parse(v);}catch{}v=v||[];
 c.fillStyle=['#f2c29c','#c98c61','#87543b','#4a2e24'][v[1]]||'#c98c61';c.fillRect(7,6,26,28);c.fillStyle=['#263a48','#ad261f','#ead4a6','#2e3b54','#cc7d1f','#5c3d73'][v[4]]||'#2e3b54';c.fillRect(2,34,36,14);c.fillStyle='#252a30';c.fillRect(12,16,4,5);c.fillRect(24,16,4,5);c.fillRect(15,26,12,2);return a;
}
async function invite(kind){const r=await api('invite',{target:selected,kind});notice.textContent='Request sent. Waiting for accept or decline.';await refresh();return r;}
function input(parent,label,max=1000){node('label',label,parent);const el=node('textarea',undefined,parent);el.maxLength=max;el.style.fontSize='16px';el.setAttribute('autocapitalize','sentences');el.setAttribute('aria-label',label);return el;}
function chat(){conversation(true);}
const drafts=new Map();let currentDraft=null,currentDraftKey='',renderOpen=null,publicSeen=new Set(),notificationSeen=new Set(),firstPoll=true,previewTimer,autoTimer;
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let prefs=readStored('miniuk-chat-preferences',{preview:true,sounds:false,timestamps:false,autoHide:false,size:'normal',previewSeconds:5});
function persist(){try{localStorage.setItem('miniuk-chat-preferences',JSON.stringify(prefs));}catch{}}
function saveDraft(){if(currentDraft?.isConnected)drafts.set(currentDraftKey,currentDraft.value);currentDraft=null;}
function messageId(){return crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}
function hiddenMessages(){return new Set(readStored('miniuk-hidden-messages-'+snapshot?.me,[]));}
function conversation(privateMode){
 if(!session||!snapshot)return;clear();view=privateMode?'chat':'public';selectTab(privateMode);title.textContent='Chat';body.classList.add('conversation');panel.dataset.textSize=prefs.size;
 const target=privateMode?selected:null;const top=node('div',undefined,body);top.className='conversation-top';
 if(privateMode){button(top,'Back',null,list);drawAvatar(top,person(target).avatar);node('strong',name(target),top);button(top,'Voice','voice',()=>quick(target,'voice')).className='icon-only';button(top,'More',null,more);}
 else node('small','Public · everyone on this server',top);
 const log=node('div',undefined,body);log.className='chat-log';log.setAttribute('role','log');log.setAttribute('aria-label',privateMode?'Private messages':'Public messages');
 const presence=node('small','',body);presence.className='chat-presence';const extras=node('div',undefined,body);extras.className='chat-extras';extras.hidden=true;
 const composer=node('form',undefined,body);composer.className='chat-composer';composer.setAttribute('aria-label','Send message');
 if(privateMode)button(composer,'More actions',null,()=>{extras.hidden=!extras.hidden;extras.replaceChildren();if(extras.hidden)return;if(snapshot.pictures){button(extras,'Send image','picture',()=>pictureForm(false));button(extras,'View once image','once',()=>pictureForm(true));}button(extras,'Invite to game','game',()=>invite('game'));const match=snapshot.invitations.find(i=>i.kind==='game'&&i.state==='accepted'&&(i.sender===target||i.recipient===target));if(match)button(extras,'Open game','game',()=>{matchId=match.id;game();});}).textContent='+';
 const draft=node('textarea',undefined,composer);draft.rows=1;draft.maxLength=1000;draft.placeholder='Type a message…';draft.setAttribute('aria-label','Message');draft.setAttribute('enterkeyhint','send');draft.setAttribute('autocapitalize','sentences');currentDraftKey=target||'public';currentDraft=draft;draft.value=drafts.get(currentDraftKey)||'';
 button(composer,'Emoji',null,()=>{extras.hidden=!extras.hidden;extras.replaceChildren();if(!extras.hidden)for(const emoji of ['😀','👋','❤️','👍','😂','🎉','😊','☕'])button(extras,emoji,null,()=>{draft.setRangeText(emoji,draft.selectionStart,draft.selectionEnd,'end');draft.focus();draft.dispatchEvent(new Event('input'));});}).textContent='☺';
 const send=button(composer,'Send',null,submit);send.textContent='➤';let sending=false;
 async function submit(){if(sending||!draft.value.trim())return;const value=draft.value;sending=true;send.disabled=true;try{await api(privateMode?'send':'public-send',{...(privateMode?{target}:{}),body:value,id:messageId()});if(draft.value===value)draft.value='';stopTyping();drafts.set(target||'public',draft.value);await update();notice.textContent='';}finally{sending=false;send.disabled=false;}}
 composer.onsubmit=e=>{e.preventDefault();submit().catch(showError);};
 draft.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit().catch(showError);}};
 let typingAt=0,typingTimer;const typingAction=privateMode?'typing':'public-typing';
 stopTyping=()=>{clearTimeout(typingTimer);if(typingAt){typingAt=0;api(typingAction,{target,active:false}).catch(()=>{});}};
 draft.oninput=()=>{if(!draft.value.trim())stopTyping();else{if(!typingAt||Date.now()-typingAt>3000){typingAt=Date.now();api(typingAction,{target,active:true}).catch(()=>{});}clearTimeout(typingTimer);typingTimer=setTimeout(stopTyping,4000);}activity();};draft.onblur=()=>stopTyping();
 let signature='',latest=[],acknowledged=new Set(),ackPending=false;
 async function markVisible(){if(document.hidden||panel.hidden||!log.isConnected||ackPending)return;const bounds=log.getBoundingClientRect();const ids=latest.filter(m=>m.sender!==snapshot.me&&!(privateMode?m.seen:m.viewed)&&!acknowledged.has(m.id)).filter(m=>{const row=Array.from(log.children).find(r=>r.dataset.message===m.id);if(!row)return false;const r=row.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom;}).map(m=>m.id);if(!ids.length)return;ackPending=true;try{await api(privateMode?'seen':'public-seen',{target,ids});ids.forEach(id=>acknowledged.add(id));}catch{}finally{ackPending=false;}}
 log.addEventListener('scroll',()=>void markVisible());
 function render(data){if(!log.isConnected||panel.hidden)return;latest=data.messages;const filtered=data.messages.filter(m=>!hiddenMessages().has(m.id));const next=JSON.stringify([filtered,prefs.timestamps,prefs.size]);
  if(next!==signature){const bottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;signature=next;log.replaceChildren();
   if(!filtered.length)node('p',privateMode?'Say hello 👋':'No messages yet. Say hello 👋',log).className='chat-empty';
   for(const m of filtered){const row=node('div',undefined,log);row.dataset.message=m.id;row.className='chat-message'+(m.sender===snapshot.me?' own':'');if(prefs.timestamps)node('time',new Date(m.created*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),row);node('strong',m.sender===snapshot.me?'You':privateMode?name(target):m.name,row);node('span',m.body,row);if(privateMode&&m.sender===snapshot.me)node('small',m.seen?'Seen':m.delivered?'Delivered':'Sent',row);if(!privateMode&&m.sender===snapshot.me&&m.seen_count)node('small','Seen by '+m.seen_count,row);if(m.sender!==snapshot.me)button(row,'Block','block',()=>{selected=m.sender;control('block');}).className='chat-block';messageMenu(row,m,!privateMode);}
   if(bottom)log.scrollTop=log.scrollHeight;
  }
  if(!privateMode){for(const m of data.messages)publicSeen.add(m.id);presence.textContent=(data.typing||[]).map(p=>p.name).join(', ')+((data.typing||[]).length?' is typing…':'');}
  else{presence.textContent=data.typing?'Typing…':data.online?'● Online':'Offline';presence.classList.toggle('is-online',!!data.online&&!data.typing);
   for(const m of data.media||[])if(!m.consumed&&!log.querySelector('[data-media="'+m.id+'"]')){const b=button(log,m.once_only?'Open view once image':'Open image','picture',()=>viewImage(m.id));b.dataset.media=m.id;}
  }
 }
 async function update(){const data=await api(privateMode?'thread':'public-thread',privateMode?{target}:{});if(log.isConnected){render(data);void markVisible();}}
 renderOpen=()=>{if(!privateMode)render({messages:snapshot.publicMessages||[],typing:snapshot.publicTyping||[]});};
 async function tick(){try{await update();}catch(e){if(log.isConnected)showError(e);}if(log.isConnected&&!panel.hidden)threadTimer=setTimeout(tick,3000);}
 void tick();activity();
}
function activity(){clearTimeout(autoTimer);if(prefs.autoHide)autoTimer=setTimeout(()=>{if(!panel.contains(document.activeElement)&&!currentDraft?.value)close();else activity();},45000);}
panel.addEventListener('pointerdown',activity);panel.addEventListener('focusin',activity);
async function setControl(target,kind,duration){await api('control',{target,kind,duration});await refresh();notice.textContent=duration?'Preference saved.':'Restriction removed.';}
async function unmute(target){for(const kind of ['mute','mute_text','mute_voice'])await api('control',{target,kind,duration:0});await refresh();more();}
function control(kind){
 clear();view='control';title.textContent=kind==='block'?'Block '+name(selected)+'?':'Mute '+name(selected);button(body,'Cancel',null,more);
 if(kind==='block'){node('p','This prevents communication with this player through the game’s block system.',body);button(body,'Block','block',async()=>{await setControl(selected,'block',-1);more();}).className='danger';return;}
 const type=node('select',undefined,body);type.setAttribute('aria-label','Mute type');for(const [v,l] of [['mute_text','Mute text'],['mute_voice','Mute voice'],['mute','Mute both']])node('option',l,type).value=v;
 const duration=node('select',undefined,body);duration.setAttribute('aria-label','Mute duration');for(const [v,l] of [[18000,'5 hours'],[86400,'24 hours'],[-1,'Until unmuted']])node('option',l,duration).value=v;
 button(body,'Save mute','mute',async()=>{await setControl(selected,type.value,Number(duration.value));more();});
}
function reportForm(message=null,isPublic=false){
 clear();view='report';title.textContent='Report '+name(selected);button(body,'Cancel',null,more);
 const category=node('select',undefined,body);category.setAttribute('aria-label','Report category');for(const c of snapshot.categories)node('option',c,category);
 const notes=input(body,'Optional notes',1000);button(body,'Submit report','report',async()=>{await api('report',{target:selected,category:category.value,notes:notes.value,...(message?{message:message.id,public:isPublic}:{})});notice.textContent='Report submitted.';}).className='danger';
}
function settings(){
 clear();view='settings';title.textContent='Chat settings';button(body,'Back',null,()=>conversation(false));
 for(const [key,label] of [['preview','Message preview'],['sounds','Chat sounds'],['timestamps','Timestamps'],['autoHide','Auto hide after 45 seconds']]){const l=node('label',label,body);l.className='chat-setting';const c=node('input',undefined,l);c.type='checkbox';c.checked=!!prefs[key];c.onchange=()=>{prefs[key]=c.checked;persist();};}
 for(const [key,label,choices] of [['size','Text size',['small','normal','large']],['previewSeconds','Preview seconds',[3,5,8]]]){const l=node('label',label,body);const c=node('select',undefined,l);for(const v of choices)node('option',String(v),c).value=v;c.value=prefs[key];c.onchange=()=>{prefs[key]=key==='previewSeconds'?Number(c.value):c.value;persist();panel.dataset.textSize=prefs.size;};}
 for(const group of ['Muted','Blocked']){node('h4',group+' players',body);const entries=snapshot.controls.filter(c=>group==='Muted'?c.kind.startsWith('mute'):c.kind==='block');if(!entries.length)node('small','None',body);for(const c of entries)button(body,(c.name||name(c.target))+' · '+(group==='Muted'?'Unmute '+c.kind.replace('mute_',''):'Unblock'),null,async()=>{await setControl(c.target,c.kind,0);settings();});}
}
function messageMenu(row,m,isPublic){
 let timer,startPoint;const show=()=>{row.querySelector('.message-options')?.remove();document.querySelectorAll('.message-options').forEach(n=>n.remove());const menu=node('div',undefined,row);menu.className='message-options';
 button(menu,'Copy',null,async()=>{await navigator.clipboard.writeText(m.body);menu.remove();});
 if(m.sender===snapshot.me)button(menu,'Delete for me',null,()=>{const ids=hiddenMessages();ids.add(m.id);try{localStorage.setItem('miniuk-hidden-messages-'+snapshot.me,JSON.stringify([...ids].slice(-1000)));}catch{}row.remove();});
 else{button(menu,'Report message','report',()=>{selected=m.sender;reportForm(m,isPublic);}).className='danger';button(menu,'Mute player','mute',()=>{selected=m.sender;control('mute');});button(menu,'Block player','block',()=>{selected=m.sender;control('block');}).className='danger';}button(menu,'Close',null,()=>menu.remove());};
 row.oncontextmenu=e=>{e.preventDefault();show();};row.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){startPoint=[e.clientX,e.clientY];timer=setTimeout(show,550);}});for(const event of ['pointerup','pointercancel'])row.addEventListener(event,()=>clearTimeout(timer));row.addEventListener('pointermove',e=>{if(startPoint&&Math.hypot(e.clientX-startPoint[0],e.clientY-startPoint[1])>8)clearTimeout(timer);});
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
const preview=node('button','',document.getElementById('stage'));preview.id='chat-preview';preview.hidden=true;preview.type='button';preview.onclick=()=>open();
const callBar=node('div',undefined,document.getElementById('stage'));callBar.id='chat-call-bar';callBar.hidden=true;const callLabel=node('span','',callBar);button(callBar,'Mute',null,()=>window.MiniUKVoice?.toggleMic());button(callBar,'End',null,()=>window.MiniUKVoice?.endCall());let connectedAt=0,lastCall='';
for(const ev of ['pointerdown','pointerup','keydown','keyup','touchstart','touchend'])callBar.addEventListener(ev,e=>e.stopPropagation());
setInterval(()=>{const v=window.MiniUKVoice?.state?.();callBar.hidden=!session||!v?.id;if(callBar.hidden){connectedAt=0;lastCall='';return;}if(lastCall!==v.id){connectedAt=0;lastCall=v.id;}if(v.phase==='Connected'&&!connectedAt)connectedAt=Date.now();const seconds=connectedAt?Math.floor((Date.now()-connectedAt)/1000):0;const i=snapshot?.invitations.find(i=>i.id===v.id);const peer=i?(i.sender===snapshot.me?i.recipient:i.sender):'';callLabel.textContent='Private · '+name(peer)+' · '+(v.phase==='Connected'?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):v.phase);const mic=callBar.querySelector('button');mic.textContent=!v.hasMic?'Turn on mic':v.muted?'Unmute':'Mute';mic.setAttribute('aria-label',mic.textContent);mic.title=mic.textContent;},1000);
let audio;
document.addEventListener('pointerdown',()=>{if(!prefs.sounds)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();void audio.resume();}catch{}},{passive:true});
function ping(){if(!prefs.sounds||audio?.state!=='running')return;const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=660;g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.15);o.start();o.stop(audio.currentTime+.16);}
async function refresh(){
 const generation=requestGeneration;const next=await api('poll');if(generation!==requestGeneration)return;snapshot=next;
 const messages=[...(next.publicMessages||[]),...(next.conversations||[]).filter(c=>c.sender!==next.me).map(c=>({...c,id:'private-'+c.id+'-'+c.created}))];
 const fresh=messages.filter(m=>!notificationSeen.has(m.id)&&m.sender!==next.me);for(const m of messages)notificationSeen.add(m.id);
 if(firstPoll){for(const m of next.publicMessages||[])publicSeen.add(m.id);firstPoll=false;}else if(fresh.length&&panel.hidden){const m=fresh.at(-1);if(prefs.preview){preview.textContent=(m.name||name(m.sender))+': '+m.body;preview.hidden=false;clearTimeout(previewTimer);previewTimer=setTimeout(()=>preview.hidden=true,prefs.previewSeconds*1000);}ping();}
 if(!panel.hidden&&view==='public')renderOpen?.();
 const publicUnread=(next.publicMessages||[]).filter(m=>m.sender!==next.me&&!publicSeen.has(m.id)).length;next.publicUnread=publicUnread;window.MiniUKHud?.social(next);
 const accepted=next.invitations.find(i=>i.kind==='voice'&&i.state==='accepted');if(!activeCall&&accepted){activeCall=accepted.id;window.MiniUKVoice.setPrivate(accepted.id);}if(activeCall&&!next.invitations.some(i=>i.id===activeCall&&i.state==='accepted')){window.MiniUKVoice.endPrivate();activeCall='';}
 const privateCount=next.unread.reduce((a,u)=>a+u.count,0),pending=next.invitations.filter(i=>i.recipient===next.me&&i.state==='pending').length,count=privateCount+pending+publicUnread;
 launch.setAttribute('aria-label','Chat'+(count?' · '+count+' unread':''));launch.lastChild.textContent=count?'Chat '+count:'Chat';privateTab.textContent='Private'+(privateCount?' · '+privateCount:'');publicTab.textContent='Public'+(publicUnread?' · '+publicUnread:'');renderRequests();
}
async function poll(){if(!session)return;try{await refresh();if(!panel.hidden&&view==='list')list();if(!panel.hidden&&view==='quick'&&quickRequest){const r=snapshot.invitations.find(i=>i.id===quickRequest);notice.textContent=!r?'Request expired.':r.state==='accepted'?'Accepted. Use Turn on mic in the call bar.':r.state==='pending'?'Waiting for a reply…':'Call '+r.state+'.';}}catch(e){if(!panel.hidden)showError(e);}if(session)pollTimer=setTimeout(poll,document.hidden?10000:3000);}
// Head controls
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
   const bubble=node('div',undefined,el);bubble.className='head-bubble';bubble.hidden=true;
   const chatButton=button(bubble,'Request chat','chat',()=>quick(p.id,'chat'));
   const voiceButton=button(bubble,'Request voice call','voice',()=>quick(p.id,'voice'));button(bubble,'More options',null,()=>open(p.id)).textContent='•••';
   for(const [b,kind] of [[chatButton,'chat'],[voiceButton,'voice']]){b.lastChild.remove();b.className='head-'+kind;}
   const row=node('div',undefined,el);row.className='head-name-row';
   const label=node('span','',row);label.className='head-name';
   const dot=node('button','',row);dot.type='button';dot.className='head-toggle';dot.setAttribute('aria-label','Show chat and voice options');dot.setAttribute('aria-expanded','false');
   dot.addEventListener('click',event=>{event.stopPropagation();bubble.hidden=!bubble.hidden;dot.setAttribute('aria-expanded',String(!bubble.hidden));dot.setAttribute('aria-label',bubble.hidden?'Show chat and voice options':'Hide chat and voice options');});
   const debug=node('small','',el);debug.className='voice-debug';debug.hidden=true;
   if(p.id==='self'){dot.hidden=true;bubble.hidden=true;}
   entry={el,label,chatButton,voiceButton,debug};headNodes.set(p.id,entry);
  }
  entry.label.textContent=p.name+(p.place?' ('+p.place+')':'');
  entry.el.style.left=(r.left+p.x*r.width)+'px';entry.el.style.top=(r.top+p.y*r.height)+'px';
  const blocked=snapshot?.controls.some(c=>c.target===p.id&&c.kind==='block');
  entry.chatButton.disabled=!!blocked;entry.voiceButton.disabled=!!blocked||snapshot?.authenticated===false;
  const voice=window.MiniUKVoice?.info(p.id,p.networkId)||{};
  entry.voiceButton.setAttribute('aria-label',voice.private?'In a private call':voice.muted?'Microphone muted':voice.speaking?'Speaking':'Request private voice call');
  entry.voiceButton.classList.toggle('is-speaking',!!voice.speaking);entry.voiceButton.classList.toggle('is-muted',!!voice.muted);entry.voiceButton.classList.toggle('is-private',!!voice.private);
  entry.debug.hidden=!voice.debug||p.id==='self';
  if(!entry.debug.hidden)entry.debug.textContent=`Network/voice: ${voice.networkId||'unavailable'} · ${Number.isFinite(voice.distance)?voice.distance.toFixed(2)+'m':'distance unavailable'} · Public: ${voice.private?'paused':voice.gain>0?'audible':'out of range'} · Private: ${voice.private?'active':'off'} · Muted: ${!!voice.muted} · Blocked: ${!!blocked} · Connected: ${!!voice.connected} · Speaking: ${!!voice.speaking} · Browser source: ${voice.source?'assigned':'none'} · Gain: ${voice.gain.toFixed(2)}`;
  const pending=snapshot?.invitations.some(i=>i.sender===p.id&&i.recipient===snapshot.me&&i.state==='pending');
  entry.el.classList.toggle('has-request',!!pending);
  entry.el.hidden=!panel.hidden||document.hidden||p.y*r.height<90;
 }
 for(const [id,entry] of headNodes)if(!keep.has(id)){entry.el.remove();headNodes.delete(id);}
}
async function quick(id,kind){
 if(id==='self')return choose('chat');panel.hidden=false;busyState();selected=id;await refresh();if(kind==='chat')return chat();clear();view='quick';quickKind=kind;quickRequest='';selectTab(true);title.textContent=name(id);
 const accepted=snapshot.invitations.find(i=>(i.sender===id||i.recipient===id)&&i.kind==='voice'&&i.state==='accepted');if(accepted){notice.textContent='Private call accepted. Use the call bar to turn on your mic.';return;}
 const incoming=snapshot.invitations.find(i=>i.sender===id&&i.recipient===snapshot.me&&i.kind==='voice'&&i.state==='pending');if(incoming){notice.textContent='Accept or decline the request above.';return;}
 const outgoing=snapshot.invitations.find(i=>i.sender===snapshot.me&&i.recipient===id&&i.kind==='voice'&&i.state==='pending');quickRequest=outgoing?outgoing.id:(await invite('voice')).id;notice.textContent='Voice request sent. Waiting for '+name(id)+'.';button(body,'Back to chat',null,chat);
}
setInterval(()=>{if(performance.now()-headTime>500)clearHeads();},500);
async function choose(kind='people'){
 panel.hidden=false;preview.hidden=true;busyState();try{await refresh();if(kind==='chat')return conversation(false);if(kind==='game'){clear();view='games';title.textContent='Choose a player';for(const p of snapshot.people)button(body,p.name,'game',()=>{selected=p.id;actions();return invite('game');});button(body,'Game leaderboard','board',()=>leaderboard(0));return;}list();}catch(e){showError(e);}
}
document.addEventListener('keydown',e=>{if(!session||e.defaultPrevented||e.isComposing)return;if(e.key==='Enter'&&panel.hidden&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)&&!document.body.classList.contains('world-menu-open')){e.preventDefault();e.stopImmediatePropagation();open().then(()=>body.querySelector('textarea')?.focus());}},true);
function viewport(){const v=window.visualViewport;panel.style.setProperty('--chat-keyboard',Math.max(0,innerHeight-(v?.height||innerHeight)-(v?.offsetTop||0))+'px');panel.style.setProperty('--chat-viewport',(v?.height||innerHeight)+'px');}window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);viewport();

window.addEventListener('pagehide',()=>{if(session){const payload=JSON.stringify({token:session.token});navigator.sendBeacon?.(session.endpoint+'/leave',new Blob([payload],{type:'application/json'}));window.MiniUKSocial.leave();}});
window.MiniUKSocial={choose,heads,close,session(endpoint,token,id){requestGeneration++;clearTimeout(pollTimer);session={endpoint,token,id};firstPoll=true;publicSeen.clear();notificationSeen.clear();drafts.clear();launch.hidden=false;void poll();},leave(){stopTyping();stopTyping=()=>{};clearHeads();requestGeneration++;clearTimeout(pollTimer);session=null;snapshot=null;selected=null;activeCall='';launch.hidden=true;preview.hidden=true;callBar.hidden=true;close();body.replaceChildren();requestsBox.replaceChildren();requestsBox.dataset.signature='';preview.textContent='';notice.textContent='';renderOpen=null;drafts.clear();},select(id){open(id).catch(showError);}};
})();
