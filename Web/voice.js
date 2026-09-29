/* Private playtest audio. Room credentials stay in memory, never URL/storage/logs. */
(() => {
'use strict';
let session=null, generation=0, stream=null, timer=null, epoch='', ack=0, muted=true, pending=false;
let config=null, peers=new Map(), errors=0;
const panel=document.createElement('details');panel.id='voice-panel';panel.hidden=true;
panel.innerHTML='<summary>Room voice <span id="voice-badge">Off</span></summary><div class="voice-controls"><p id="voice-status" role="status" aria-live="polite">Enable voice to talk with people in this room.</p><button id="voice-enable" type="button">Enable voice</button><button id="voice-mute" type="button" hidden>Unmute mic</button><button id="voice-stop" type="button" hidden>Turn voice off</button><button id="voice-hear" type="button" hidden>Play incoming audio</button><label>Listening volume <input id="voice-volume" type="range" min="0" max="1" step="0.05" value="1"></label><p class="voice-note">Room audio · use headphones. No audio is recorded by Mini UK. Direct calls share network addresses with room participants.</p></div>';
document.getElementById('stage').appendChild(panel);
const get=id=>document.getElementById(id), status=text=>get('voice-status').textContent=text;
function controls(){get('voice-enable').hidden=!!stream;get('voice-enable').disabled=pending;get('voice-mute').hidden=!stream;get('voice-stop').hidden=!stream&&!pending;get('voice-mute').textContent=muted?'Unmute mic':'Mute mic';get('voice-mute').setAttribute('aria-pressed',String(!muted));get('voice-badge').textContent=stream?(muted?'Muted':'Mic on'):'Off';}
async function request(path,data={},s=session){
 if(!s)throw Error('Join a room first.');
 const response=await fetch(s.endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:s.token,epoch,...data}),signal:AbortSignal.timeout(8000),cache:'no-store'});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Voice server unavailable.');return value;
}
function drop(id){const peer=peers.get(id);if(!peer)return;peers.delete(id);peer.pc.close();peer.audio.srcObject=null;peer.audio.remove();}
function stop(message='Voice is off. Your microphone has been released.'){
 const old=session, oldEpoch=epoch;generation++;pending=false;clearTimeout(timer);timer=null;
 if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;
 for(const id of [...peers.keys()])drop(id);
 epoch='';ack=0;config=null;muted=true;errors=0;get('voice-hear').hidden=true;
 if(old&&oldEpoch)request('/voice/leave',{epoch:oldEpoch},old).catch(()=>{});
 controls();status(message);
}
function alive(g){return g===generation&&!!stream&&!!session;}
function report(){
 const connected=[...peers.values()].filter(p=>p.pc.connectionState==='connected').length;
 const failed=[...peers.values()].some(p=>p.pc.connectionState==='failed'||p.pc.connectionState==='disconnected');
 status(failed?'A voice connection dropped. Turn voice off and on to retry.':`${connected} voice connection${connected===1?'':'s'} · ${muted?'microphone muted':'microphone on'}`+(config&&!config.relayAvailable?' · limited-network test (no relay)':''));
}
function makePeer(person,g){
 drop(person.id);
 const pc=new RTCPeerConnection({iceServers:config.iceServers});
 const audio=document.createElement('audio');audio.autoplay=true;audio.setAttribute('playsinline','');audio.volume=Number(get('voice-volume').value);panel.appendChild(audio);
 const peer={pc,audio,epoch:person.epoch};peers.set(person.id,peer);
 stream.getTracks().forEach(track=>pc.addTrack(track,stream));
 pc.ontrack=event=>{if(!alive(g))return;audio.srcObject=event.streams[0]||new MediaStream([event.track]);audio.play().catch(()=>{if(alive(g))get('voice-hear').hidden=false;});};
 pc.onconnectionstatechange=()=>{if(alive(g))report();};return peer;
}
async function description(peer,kind,g){
 const pc=peer.pc;await pc.setLocalDescription(kind==='offer'?await pc.createOffer():await pc.createAnswer());
 if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{
   let timeout;const done=()=>{clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',check);resolve();};
   const check=()=>{if(pc.iceGatheringState==='complete'||pc.signalingState==='closed')done();};
   pc.addEventListener('icegatheringstatechange',check);timeout=setTimeout(done,5000);check();
 });
 if(!alive(g)||pc.signalingState==='closed')return null;
 return pc.localDescription.sdp;
}
async function offer(person,g){
 const peer=makePeer(person,g);
 try {const sdp=await description(peer,'offer',g);if(sdp&&alive(g))await request('/voice/signal',{to:person.id,toEpoch:person.epoch,type:'offer',sdp});}
 catch(error){if(alive(g)&&peers.get(person.id)===peer){drop(person.id);status(error.message);}}
}
async function poll(g){
 if(!alive(g))return;
 try{
  const data=await request('/voice/poll',{ack});if(!alive(g))return;errors=0;
  const present=new Map(data.peers.map(p=>[p.id,p]));
  for(const [id,peer] of peers)if(!present.has(id)||present.get(id).epoch!==peer.epoch)drop(id);
  for(const message of data.messages){
   if(!alive(g))return;
   const person=present.get(message.sender);
   if(!person||person.epoch!==message.epoch){ack=Math.max(ack,message.seq);continue;}
   let peer=peers.get(person.id);
   if(message.type==='offer'&&person.id<session.id){
    // A new offer replaces any failed connection, but only the smaller ID initiates.
    peer=makePeer(person,g);
    void (async()=>{await peer.pc.setRemoteDescription({type:'offer',sdp:message.sdp});
      const sdp=await description(peer,'answer',g);if(sdp&&alive(g))await request('/voice/signal',{to:person.id,toEpoch:person.epoch,type:'answer',sdp});
    })().catch(error=>{if(alive(g))status(error.message);});
   }else if(message.type==='answer'&&peer&&peer.pc.signalingState==='have-local-offer'){
    await peer.pc.setRemoteDescription({type:'answer',sdp:message.sdp});
   }
   ack=Math.max(ack,message.seq);
  }
  if(!alive(g))return;
  // Parallel ICE gathering avoids making larger rooms miss their heartbeat.
  for(const person of data.peers)if(session.id<person.id&&!peers.has(person.id))void offer(person,g);
  report();
 }catch(error){if(!alive(g))return;errors++;status(error.message);if(errors>=3){stop('Voice disconnected. Enable voice to reconnect.');return;}}
 if(alive(g))timer=setTimeout(()=>poll(g),1000);
}
async function enable(){
 if(pending||stream||!session)return;
 pending=true;controls();const g=++generation, joining=session;status('Allow microphone access in your browser. You will start muted.');
 let captured;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw Error('Voice needs an HTTPS page and a browser with microphone support.');
  captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  captured.getTracks().forEach(track=>track.enabled=false);
  if(g!==generation){captured.getTracks().forEach(track=>track.stop());return;}
  stream=captured;const joined=await request('/voice/join',{},joining);
  if(!alive(g)){request('/voice/leave',{epoch:joined.epoch},joining).catch(()=>{});return;}config=joined;epoch=config.epoch;muted=true;pending=false;
  stream.getAudioTracks().forEach(track=>track.onended=()=>{if(alive(g))stop('Microphone disconnected. Enable voice to retry.');});
  controls();void poll(g);
 }catch(error){if(captured)captured.getTracks().forEach(track=>track.stop());if(g===generation)stop(error.name==='NotAllowedError'?'Microphone permission was denied. Allow it in browser site settings, then enable voice again.':error.message);}
}
get('voice-enable').onclick=enable;
get('voice-stop').onclick=()=>stop();
get('voice-mute').onclick=()=>{muted=!muted;stream?.getAudioTracks().forEach(track=>track.enabled=!muted);controls();report();};
get('voice-volume').oninput=()=>peers.forEach(peer=>peer.audio.volume=Number(get('voice-volume').value));
get('voice-hear').onclick=async()=>{try{await Promise.all([...peers.values()].map(peer=>peer.audio.play()));get('voice-hear').hidden=true;}catch{status('Incoming audio is blocked by the browser. Tap Play incoming audio again.');}};
// Losing the tab always stops capture; returning never silently re-enables it.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||pending))stop('Voice paused while away. Enable voice when you return.');});
window.addEventListener('pagehide',()=>{stop();session=null;});
window.MiniUKVoice={session(endpoint,token,id){stop();session={endpoint:endpoint.replace(/\/$/,''),token,id};panel.hidden=false;status('Enable voice to talk with people in this room.');},leave(){stop();session=null;panel.hidden=true;}};
})();
