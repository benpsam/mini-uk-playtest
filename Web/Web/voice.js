/* Private playtest audio. Room credentials stay in memory, never URL/storage/logs. */
(() => {
'use strict';
let session=null, generation=0, stream=null, timer=null, epoch='', ack=0, muted=true, pending=false;
let config=null, peers=new Map(), errors=0, audioContext=null;
let previousAudioSession=null;
let testTone=null, micSource=null, micAnalyser=null, micSink=null, micTimer=null;
function unlockAudio(){
 const Audio=window.AudioContext||window.webkitAudioContext;
 if(!audioContext&&Audio){
  audioContext=new Audio();
  audioContext.onstatechange=()=>{
   if(stream&&audioContext&&audioContext.state!=="running")get('voice-hear').hidden=false;
  };
 }
 if(audioContext&&audioContext.state!=="running")return audioContext.resume();
 return Promise.resolve();
}
function volume(peer){const value=peer.gain*Number(get("voice-volume").value);if(peer.gainNode)peer.gainNode.gain.value=value;else peer.audio.volume=value;}
const panel=document.createElement('details');panel.id='voice-panel';panel.hidden=true;
panel.innerHTML=`<summary aria-label="Nearby voice controls"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="12" y="3" width="8" height="16" rx="4"/><path d="M8 14v2a8 8 0 0 0 16 0v-2M16 24v5M11 29h10"/></svg><span id="voice-badge">Off</span></summary><div class="voice-controls"><strong>Nearby voice</strong><p id="voice-status" role="status" aria-live="polite">Turn on your mic to speak to nearby players.</p><button id="voice-enable" type="button">Turn on mic</button><button id="voice-mute" type="button" hidden>Mute mic</button><div id="voice-mic-check" hidden><label for="voice-mic-level">Your microphone</label><meter id="voice-mic-level" min="0" max="1" value="0"></meter><small id="voice-mic-status" role="status">Speak to check your mic.</small></div><button id="voice-hear" type="button" hidden>Resume sound</button><details class="voice-settings"><summary>Sound settings</summary><label>Listening volume <output id="voice-level">100%</output><input id="voice-volume" type="range" min="0" max="1" step="0.05" value="1"></label><button id="voice-restart" type="button" hidden>Reconnect microphone</button><button id="voice-test" type="button">Test speaker</button><p id="voice-output-status" role="status"></p><button id="voice-stop" type="button" hidden>Disconnect voice</button><p class="voice-note">Turning on your mic shares your voice with players within 25 metres. No recording by Mini UK. Direct connections share network addresses. Use headphones.</p></details></div>`;
document.getElementById('stage').appendChild(panel);
// Keep mobile gestures on the audio controls away from the game canvas.
for(const event of ['pointerdown','pointermove','pointerup','touchstart','touchmove','touchend','keydown','keyup'])
 panel.addEventListener(event,e=>e.stopPropagation());
const voiceStyle=document.createElement('style');
voiceStyle.textContent=`
#voice-panel{top:auto;left:auto;right:max(16px,env(safe-area-inset-right));bottom:calc(128px + env(safe-area-inset-bottom));width:64px;max-width:none;max-height:none;overflow:visible;border:0;background:transparent;box-shadow:none;font-size:14px}
#voice-panel>summary{box-sizing:border-box;width:64px;height:64px;min-height:0;padding:8px 4px;border:2px solid #b7e5f6;border-radius:50%;background:#176e95;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;box-shadow:0 3px 14px #0006;list-style:none;touch-action:manipulation}
#voice-panel>summary::-webkit-details-marker{display:none}#voice-panel svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round}#voice-badge{margin:0;color:white;font-size:10px;line-height:12px}
#voice-panel[data-mic="on"]>summary{background:#177a53}#voice-panel[data-mic="paused"]>summary{background:#92430f}
#voice-panel>.voice-controls{box-sizing:border-box;position:absolute;right:0;bottom:76px;width:min(300px,calc(100vw - 32px));max-height:calc(100dvh - 230px);overflow-y:auto;padding:16px;background:#14202ef5;border:1px solid #62778c;border-radius:20px;box-shadow:0 8px 30px #0007;display:flex;gap:10px;flex-direction:column}
#voice-panel:not([open])>.voice-controls{display:none}#voice-panel .voice-controls>*{order:initial}#voice-panel .voice-controls button{min-height:44px;margin:0;width:100%;touch-action:manipulation}#voice-panel .voice-settings>summary{padding:8px 0;min-height:0;cursor:pointer;font-size:13px}#voice-panel .voice-settings>*:not(summary){margin-top:10px}
#voice-volume{min-height:44px;touch-action:pan-x}#voice-level{float:right}#voice-mic-level{display:block;width:100%;height:14px;accent-color:#70e0b1}#voice-mic-status{display:block;font-size:12px;color:#bed0df;margin-top:4px}#voice-output-status{font-size:12px}#voice-restart,#voice-test{background:#30475c;color:white}
/* Transparent dock icons; Unity supplies the shared row coordinates. */
#voice-panel{right:72px;bottom:16px;width:48px;height:48px}
#voice-panel>summary{width:100%;height:100%;padding:10px;border:0;border-radius:10px;background:transparent!important;box-shadow:none;filter:drop-shadow(0 2px 2px #000b)}
#voice-panel svg{width:26px;height:26px}
#voice-badge{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
#voice-panel>summary:after{content:"";position:absolute;right:7px;bottom:7px;width:6px;height:6px;border-radius:50%;background:#8e9baa}
#voice-panel[data-mic="on"]>summary:after{background:#89efbb}
#voice-panel[data-mic="paused"]>summary:after{background:#ffb45e}
#voice-panel>.voice-controls{bottom:60px;right:-56px;max-height:calc(100dvh - 100px)}
#voice-panel>summary:hover,#voice-panel>summary:focus-visible{outline:2px solid #fff8}
`;
panel.appendChild(voiceStyle);
const get=id=>document.getElementById(id), status=text=>get('voice-status').textContent=text;
function micUnavailable(){return !!stream&&stream.getAudioTracks().some(t=>t.muted||t.readyState==='ended');}
function controls(){
 get('voice-enable').hidden=!!stream;get('voice-enable').disabled=pending||!session;
 get('voice-mute').hidden=!stream;get('voice-stop').hidden=!stream&&!pending;
 get('voice-restart').hidden=!stream;get('voice-mic-check').hidden=!stream;
 get('voice-mute').textContent=muted?'Turn on mic':'Mute mic';get('voice-mute').setAttribute('aria-pressed',String(!muted));
 const state=stream?(micUnavailable()?'paused':muted?'muted':'on'):'off';
 panel.setAttribute('data-mic',state);
 get('voice-badge').textContent=({paused:'Mic paused',muted:'Muted',on:'Mic on',off:'Off'})[state];
}
function clearMicMeter(){clearTimeout(micTimer);micTimer=null;micSource?.disconnect();micAnalyser?.disconnect();micSink?.disconnect();micSource=micAnalyser=micSink=null;get('voice-mic-level').value=0;}
function monitorMic(g){
 clearMicMeter();
 try{
  if(!audioContext||!stream)throw Error('unavailable');
  micSource=audioContext.createMediaStreamSource(stream);micAnalyser=audioContext.createAnalyser();micAnalyser.fftSize=256;
  micSink=audioContext.createGain();micSink.gain.value=0;
  micSource.connect(micAnalyser);micAnalyser.connect(micSink);micSink.connect(audioContext.destination);
 }catch{clearMicMeter();}
 const samples=micAnalyser?new Uint8Array(micAnalyser.fftSize):null;
 function tick(){
  if(!alive(g))return;
  let level=0;
  if(samples&&!muted&&!micUnavailable()&&audioContext?.state==='running'){
   micAnalyser.getByteTimeDomainData(samples);let energy=0;for(const v of samples)energy+=((v-128)/128)**2;level=Math.min(1,Math.sqrt(energy/samples.length)*5);
  }
  get('voice-mic-level').value=level;
  get('voice-mic-status').textContent=micUnavailable()?'Microphone paused by your device. Check browser mic permission or reconnect.':muted?'Your mic is muted.':!samples?'Mic level unavailable in this browser.':audioContext?.state!=='running'?'Tap Resume sound to enable the mic level check.':level>.025?'Microphone is picking up sound.':'Speak now — the bar should move.';
  micTimer=setTimeout(tick,120);
 }
 tick();
}
async function request(path,data={},s=session){
 if(!s)throw Error('Join a room first.');
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(s.endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:s.token,epoch,...data}),signal:controller.signal,cache:'no-store'});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Voice server unavailable.');return value;}finally{clearTimeout(timeout);}
}
function drop(id){const peer=peers.get(id);if(!peer)return;peers.delete(id);peer.pc.close();peer.source?.disconnect();peer.gainNode?.disconnect();peer.audio.srcObject=null;peer.audio.remove();}
function stop(message='Voice is off. Your microphone has been released.'){
 const old=session, oldEpoch=epoch;generation++;pending=false;clearTimeout(timer);timer=null;
 clearMicMeter();
 if(previousAudioSession!==null){try{navigator.audioSession.type=previousAudioSession;}catch{}previousAudioSession=null;}
 if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;
 for(const id of [...peers.keys()])drop(id);
 if(testTone){testTone.stop();testTone=null;}
 if(audioContext){audioContext.onstatechange=null;audioContext.close().catch(()=>{});audioContext=null;}
 epoch='';ack=0;config=null;muted=true;errors=0;get('voice-hear').hidden=true;
 if(old&&oldEpoch)request('/voice/leave',{epoch:oldEpoch},old).catch(()=>{});
 controls();status(message);
}
function alive(g){return g===generation&&!!stream&&!!session;}
function report(){
 if(micUnavailable()){status('Your microphone is paused by the device. Open Sound settings → Reconnect microphone.');return;}
 const connected=[...peers.values()].filter(p=>p.pc.connectionState==='connected').length;
 const failed=[...peers.values()].some(p=>p.pc.connectionState==='failed'||p.pc.connectionState==='disconnected');
 status(failed?(config?.relayAvailable?'Voice connection failed. Turn voice off and on to retry.':'This network may need a voice relay. The game owner must configure TURN; changing microphone permission will not fix that.'):`${connected} nearby voice connection${connected===1?'':'s'} · ${muted?'microphone muted':'microphone on'}`+(config&&!config.relayAvailable?' · limited-network test (no relay)':''));
}
function playIncoming(peer,g){
 peer.audio.play().then(()=>{peer.blocked=false;}).catch(()=>{
  if(alive(g)){peer.blocked=true;get('voice-hear').hidden=false;}
 });
}
function attachIncoming(peer,incoming,g){
 peer.source?.disconnect();peer.gainNode?.disconnect();peer.source=null;peer.gainNode=null;
 peer.audio.srcObject=incoming;
 try{
  if(audioContext){
   peer.source=audioContext.createMediaStreamSource(incoming);
   peer.gainNode=audioContext.createGain();
   peer.source.connect(peer.gainNode).connect(audioContext.destination);
  }
 }catch{
  peer.source?.disconnect();peer.gainNode?.disconnect();peer.source=null;peer.gainNode=null;
 }
 // Keep the remote media element playing for mobile WebRTC, but mute its
 // output when Web Audio provides the audible path (avoids doubled sound).
 peer.audio.muted=!!peer.gainNode;
 volume(peer);playIncoming(peer,g);
 if(peer.gainNode&&audioContext.state!=='running')get('voice-hear').hidden=false;
}
function makePeer(person,g){
 drop(person.id);
 const pc=new RTCPeerConnection({iceServers:config.iceServers});
 const audio=document.createElement('audio');audio.autoplay=true;audio.setAttribute('playsinline','');audio.volume=0;panel.appendChild(audio);
 const peer={pc,audio,epoch:person.epoch,gain:Math.max(0,Math.min(1,(25-person.distance)/20))};volume(peer);peers.set(person.id,peer);
 stream.getTracks().forEach(track=>pc.addTrack(track,stream));
 pc.ontrack=event=>{if(!alive(g)||peers.get(person.id)!==peer)return;attachIncoming(peer,event.streams[0]||new MediaStream([event.track]),g);};
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
  for(const [id,peer] of peers){if(!present.has(id)||present.get(id).epoch!==peer.epoch){drop(id);continue;}peer.gain=Math.max(0,Math.min(1,(25-present.get(id).distance)/20));volume(peer);}
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
 pending=true;controls();const g=++generation, joining=session;status('Allow microphone access to start speaking to nearby players.');
 let captured;
 try{
  // Resume audio synchronously from the tap before microphone permission yields.
  void unlockAudio().catch(()=>{get('voice-hear').hidden=false;});
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw Error('Voice needs an HTTPS page and a browser with microphone support.');
  if(navigator.audioSession){try{previousAudioSession=navigator.audioSession.type;navigator.audioSession.type='play-and-record';}catch{previousAudioSession=null;}}
  captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  captured.getAudioTracks().forEach(track=>track.enabled=true);
  if(!captured.getAudioTracks().length)throw Error('No microphone found. Check the browser microphone permission.');
  if(document.hidden)throw Error('Return to the game and tap Enable voice again.');
  if(g!==generation){captured.getTracks().forEach(track=>track.stop());return;}
  stream=captured;const joined=await request('/voice/join',{},joining);
  if(!alive(g)){request('/voice/leave',{epoch:joined.epoch},joining).catch(()=>{});return;}config=joined;epoch=config.epoch;muted=false;pending=false;
  stream.getAudioTracks().forEach(track=>{
   track.onended=()=>{if(alive(g))stop('Microphone disconnected. Tap Turn on mic to retry.');};
   track.onmute=track.onunmute=()=>{if(alive(g)){controls();report();}};
  });
  void unlockAudio().catch(()=>{get('voice-hear').hidden=false;});
  controls();monitorMic(g);void poll(g);
 }catch(error){if(captured)captured.getTracks().forEach(track=>track.stop());if(g===generation)stop(error.name==='NotAllowedError'?'Microphone blocked. Allow microphone access for this website in your browser and device settings, then tap Turn on mic.':error.message);}
}
get('voice-enable').onclick=enable;
get('voice-stop').onclick=()=>stop();
get('voice-restart').onclick=()=>{stop();return enable();};
get('voice-mute').onclick=()=>{void unlockAudio().catch(()=>{get('voice-hear').hidden=false;});muted=!muted;stream?.getAudioTracks().forEach(track=>track.enabled=!muted);controls();report();};
function updateVolume(){
 get('voice-level').textContent=Math.round(Number(get('voice-volume').value)*100)+'%';
 peers.forEach(volume);
 void unlockAudio().catch(()=>{get('voice-hear').hidden=false;});
}
get('voice-volume').oninput=updateVolume;
get('voice-volume').onchange=updateVolume;
get('voice-hear').onclick=async()=>{
 const g=generation;
 try{
  // Both calls begin in the user gesture, before the first await.
  const resumed=unlockAudio();
  const played=[...peers.values()].filter(p=>p.audio.srcObject).map(p=>p.audio.play().then(()=>{p.blocked=false;}));
  await Promise.all([resumed,...played]);
  if(g!==generation)return;
  const blocked=audioContext&&audioContext.state!=='running';
  get('voice-hear').hidden= !blocked;
  get('voice-output-status').textContent=blocked?'Audio is paused. Tap Play incoming audio again.':'Speaker playback enabled. Ask a nearby player to speak.';
 }catch{get('voice-hear').hidden=false;get('voice-output-status').textContent='Playback is blocked. Tap Play incoming audio again.';}
};
get('voice-test').onclick=async()=>{
 const g=generation;
 try{
  await unlockAudio();
  if(g!==generation)return;
  if(!audioContext||audioContext.state!=='running')throw Error('Audio is paused. Tap Test speaker again.');
  if(testTone)testTone.stop();
  const tone=audioContext.createOscillator(),level=audioContext.createGain();
  const now=audioContext.currentTime;
  level.gain.setValueAtTime(0,now);level.gain.linearRampToValueAtTime(0.12*Number(get('voice-volume').value),now+0.03);level.gain.linearRampToValueAtTime(0,now+0.6);
  tone.frequency.value=440;tone.connect(level).connect(audioContext.destination);
  testTone=tone;tone.onended=()=>{tone.disconnect();level.disconnect();if(testTone===tone)testTone=null;};tone.start();tone.stop(now+0.65);
  get('voice-output-status').textContent='Test tone played. If silent, check the phone’s volume and Bluetooth output. This does not test the voice connection.';
 }catch(error){get('voice-output-status').textContent=error.message;}
};
// A permission dialog may temporarily hide the page on Android. Do not cancel that request.
// Once voice is active, leaving the tab stops capture; returning requires another tap.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream&&!pending)stop('Voice paused while away. Enable voice when you return.');});
window.addEventListener('pagehide',()=>{stop();session=null;});
window.MiniUKVoice={ready(){panel.hidden=false;controls();status('Enter London to connect automatically. Voice becomes available after connection.');},session(endpoint,token,id){stop();session={endpoint:endpoint.replace(/\/$/,''),token,id};panel.hidden=false;controls();status('Tap Turn on mic to speak with nearby players.');},leave(){stop();session=null;controls();status('Voice is available in public London. Waiting for a connection…');}};
})();
