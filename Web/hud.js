/* Responsive browser HUD: every action delegates to an existing game feature. */
(()=>{'use strict';
const stage=document.getElementById('stage');if(!stage)return;
let state=null,social=null,expanded=false;
const svgPaths={places:'M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13z M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',people:'M8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M1 22v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M18 16a5 5 0 0 1 5 5',chat:'M3 3h18v14H9l-6 5z M7 9h.1 M12 9h.1 M17 9h.1',voice:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',game:'M5 5h14l3 14-6-4H8l-6 4z M6 10h6 M9 7v6 M17 9h.1 M19 12h.1',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 2h6l1 4 4 1 2 5-3 3 1 4-5 3-3-3-4 1-4-4 1-4-3-3 3-5 4-1z',menu:'M3 5h18 M3 12h18 M3 19h18',day:'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M12 1v2 M12 21v2 M1 12h2 M21 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',night:'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',live:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M5 3a12 12 0 0 0 0 18 M19 3a12 12 0 0 1 0 18',full:'M2 8V2h6 M16 2h6v6 M22 16v6h-6 M8 22H2v-6'};
function el(tag,cls,text,parent){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;if(parent)parent.append(e);return e;}
function icon(kind){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',svgPaths[kind]||svgPaths.people);svg.append(p);return svg;}
function btn(parent,label,kind,action){const b=el('button','world-button',undefined,parent);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.append(icon(kind),el('span','',label));b.onclick=action;return b;}
function game(action){if(state&&window.MiniUKGame){document.getElementById('social-panel')?.querySelector('header button')?.click();requestAnimationFrame(()=>requestAnimationFrame(()=>window.MiniUKGame.SendMessage(state.receiver,'BrowserAction',action)));}}
function choose(kind){window.MiniUKSocial?.choose(kind);}
function voice(){const panel=document.getElementById('voice-panel');if(panel){panel.open=!panel.open;panel.querySelector('.voice-controls button:not([hidden])')?.focus();}}
const root=el('div','world-hud',undefined,stage);root.id='world-hud';root.hidden=true;
const side=el('aside','world-sidebar world-glass',undefined,root);
const profile=btn(side,'Change character','people',()=>game('character'));profile.classList.add('world-profile');
const profileText=profile.querySelector('span');profileText.replaceChildren();const playerName=el('strong','','Explorer',profileText),connection=el('small','','Connecting…',profileText);
const nav=el('nav','world-nav',undefined,side);nav.setAttribute('aria-label','Game actions');
btn(nav,'Places & travel','places',()=>game('places'));
btn(nav,'Social','people',()=>choose('people'));
const chat=btn(nav,'Chat','chat',()=>choose('chat'));const unread=el('b','world-unread','',chat);unread.hidden=true;
btn(nav,'Voice','voice',voice);btn(nav,'Games','game',()=>choose('game'));btn(nav,'Settings','settings',()=>game('settings'));
const right=el('aside','world-right',undefined,root);
const stats=el('div','world-stats world-glass',undefined,right);const clock=el('span','','',stats),credits=el('span','','0 credits',stats);
const location=btn(right,'Places & travel','places',()=>game('places'));location.classList.add('world-location','world-glass');const locationText=location.querySelector('span');locationText.replaceChildren();const city=el('strong','','',locationText),area=el('small','','',locationText);
const nearby=el('section','world-nearby world-glass',undefined,right);const nearToggle=btn(nearby,'Nearby players','people',()=>{expanded=!expanded;root.classList.toggle('near-expanded',expanded);nearToggle.setAttribute('aria-expanded',String(expanded));});nearToggle.setAttribute('aria-expanded','false');const nearList=el('div','world-near-list',undefined,nearby);
const bottom=el('nav','world-dock world-glass',undefined,root);bottom.setAttribute('aria-label','Quick actions');
btn(bottom,'Chat','chat',()=>choose('chat'));btn(bottom,'Voice','voice',voice);btn(bottom,'Players','people',()=>choose('people'));btn(bottom,'Menu','menu',()=>game('menu'));
const lights=el('div','world-lighting world-glass',undefined,root);const lightingButtons=[];
for(const [label,action] of [['Live lighting','live'],['Day','day'],['Night','night']])lightingButtons.push([btn(lights,label,action,()=>game(action)),action]);
const full=btn(lights,'Fullscreen','full',()=>document.getElementById('full')?.click());full.hidden=!document.fullscreenEnabled&&!document.webkitFullscreenEnabled;
for(const ev of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','keydown','keyup'])root.addEventListener(ev,e=>e.stopPropagation());
const css=el('link','',undefined,document.head);css.rel='stylesheet';css.href='hud.css';
let nearSignature='';
function renderNearby(){if(!state)return;const people=state.people.filter(p=>!social?.controls?.some(c=>c.target===p.id&&c.kind==='block')).slice(0,8);const signature=JSON.stringify(people.map(p=>[p.id,p.name,Math.round(p.distance)]));if(signature===nearSignature)return;nearSignature=signature;nearList.replaceChildren();
 if(!people.length){el('p','world-empty','You’re the first here. Invite a friend to this city.',nearList);return;}
 for(const p of people){const row=btn(nearList,p.name,'people',()=>window.MiniUKSocial?.select(p.id));row.append(el('small','',Math.round(p.distance)+' m'));}
}
window.MiniUKHud={social(value){social=value;const n=value.unread.reduce((n,m)=>n+m.count,0)+value.invitations.filter(i=>i.recipient===value.me&&i.state==='pending').length;unread.textContent=n>99?'99+':String(n);unread.hidden=!n;renderNearby();},update(value){
 state=value;root.hidden=!value.visible||value.menu;document.body.classList.toggle('has-world-hud',value.visible);document.body.classList.toggle('world-menu-open',value.menu);
 playerName.textContent=value.name;connection.textContent=value.connection;city.textContent=value.city;area.textContent=value.location;credits.textContent=value.credits+' credits';clock.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});clock.title='Your local time';
 for(const [b,mode] of lightingButtons)b.setAttribute('aria-pressed',String(mode===value.lighting.toLowerCase()));renderNearby();
}};
})();
