(() => {
'use strict';
const adult=document.getElementById('adult'),guest=document.getElementById('guest'),status=document.getElementById('login-status'),googleBox=document.getElementById('google-signin');
let config=null,initializing=false,submitting=false,attempt=0,googleLoader=null;
const retry=document.createElement('button');retry.type='button';retry.className='entry-link';retry.textContent='Retry Google sign-in';retry.hidden=true;status.after(retry);
retry.onclick=()=>{if(initializing)return;config=null;void setup();};
function googleScript(){
 if(window.google?.accounts?.id)return Promise.resolve();if(googleLoader)return googleLoader;
 googleLoader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
 const timer=setTimeout(()=>{script.remove();googleLoader=null;reject(Error('Google took too long to load. Please retry or continue as guest.'));},8000);
 script.onload=()=>{clearTimeout(timer);if(window.google?.accounts?.id)resolve();else{googleLoader=null;reject(Error('Google sign-in could not load. Please retry.'));}};
 script.onerror=()=>{clearTimeout(timer);script.remove();googleLoader=null;reject(Error('Google sign-in could not load. Check blockers or retry.'));};document.head.appendChild(script);
 });return googleLoader;
}
window.MiniUKWardrobe=null;
function wardrobe(value){window.MiniUKWardrobe=value.signedIn&&value.wardrobeTicket?{ticket:value.wardrobeTicket,expires:value.expires*1000}:null;}
setInterval(async()=>{if(!window.MiniUKWardrobe)return;try{wardrobe(await json('/auth/session'));}catch(e){/* Keep the current grant during a temporary network interruption. */}},30000);
async function json(url,options={}){
 const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(8000),...options});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'Please try again.');return value;
}
function enter(){if(!adult.checked||started)return;window.MiniUKEntryApproved=true;start();}
function update(){guest.disabled=!adult.checked||submitting;googleBox.hidden=!adult.checked;retry.hidden=!adult.checked||initializing||!!config;if(!adult.checked)status.textContent='Confirm your age to choose how to join.';else if(config)status.textContent=config.restored?'Your Google account is saved on this browser.':'Choose Google sign-in or try Mini UK as a guest.';else setup();}
async function setup(){
 if(initializing||config||!adult.checked)return;initializing=true;retry.hidden=true;const cycle=++attempt;let restored=false,ready=false;status.textContent='Loading sign-in options…';
 // A slow saved-account lookup must not prevent the Google button from loading.
 const savedTask=(async()=>{
  try{const saved=await json('/auth/session');if(cycle!==attempt||!saved.signedIn||started)return;
   restored=true;wardrobe(saved);googleBox.replaceChildren();
   const resume=document.createElement('button');resume.className='entry-button';resume.textContent='Continue with saved Google account';resume.onclick=()=>{if(adult.checked)enter();};
   const logout=document.createElement('button');logout.className='entry-link';logout.textContent='Sign out / use another Google account';
   logout.onclick=async()=>{if(submitting)return;submitting=true;try{await json('/auth/logout',{method:'POST',headers:{'X-MiniUK-Login':'1'}});attempt++;window.MiniUKWardrobe=null;config=null;initializing=false;googleBox.replaceChildren();void setup();}catch(e){status.textContent='Could not sign out. Please try again.';}finally{submitting=false;guest.disabled=!adult.checked;}};
   googleBox.append(resume,logout);config={restored:true};status.textContent='Your Google account is saved on this browser.';retry.hidden=true;
  }catch(e){/* Fresh Google sign-in remains independent of saved-account restoration. */}
 })();
 const googleTask=(async()=>{
  try{const options=await json('/auth/config');if(cycle!==attempt||restored||started)return;
   if(!options.clientId)throw Error('Google sign-in is not configured on the server. You can continue as guest.');
   await googleScript();if(cycle!==attempt||restored||started)return;
   googleBox.replaceChildren();window.google.accounts.id.initialize({client_id:options.clientId,nonce:options.nonce,auto_select:false,callback:async result=>{
    if(cycle!==attempt||!adult.checked||submitting||started)return;submitting=true;guest.disabled=true;status.textContent='Verifying your Google sign-in…';
    try{const signed=await json('/auth/google',{method:'POST',headers:{'Content-Type':'application/json','X-MiniUK-Login':'1'},body:JSON.stringify({credential:result.credential})});wardrobe(signed);status.textContent='Signed in. Opening Mini UK…';enter();}
    catch(error){status.textContent=error.message;config=null;retry.hidden=false;}
    finally{submitting=false;guest.disabled=!adult.checked;}
   }});
   window.google.accounts.id.renderButton(googleBox,{theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:Math.min(400,googleBox.clientWidth||280)});
   ready=true;config=options;status.textContent='Choose Google sign-in or try Mini UK as a guest.';
  }catch(error){if(cycle===attempt&&!restored&&!started){config=null;status.textContent=error.name==='TimeoutError'?'Sign-in is taking too long. Retry Google sign-in or continue as guest.':error.message;}}
 })();
 await Promise.allSettled([savedTask,googleTask]);if(cycle!==attempt)return;initializing=false;retry.hidden=!adult.checked||ready||restored;
}
adult.addEventListener('change',update);
const details=document.getElementById('guest-details');
guest.addEventListener('click',()=>{if(adult.checked&&!submitting){details.hidden=false;guest.hidden=true;details.closest('.entry-card').classList.add('guest-mode');document.getElementById('guest-name').focus();}});
document.getElementById('guest-back').addEventListener('click',()=>{details.hidden=true;guest.hidden=false;details.closest('.entry-card').classList.remove('guest-mode');guest.focus();});
details.addEventListener('submit',event=>{event.preventDefault();if(!adult.checked||submitting||started)return;
 const name=document.getElementById('guest-name').value.trim(),location=document.getElementById('guest-location').value.trim();
 if(!/^[A-Za-z0-9 _-]{1,24}$/.test(name)||!location||location.length>60){document.getElementById('guest-error').textContent='Enter a name using 1–24 letters, numbers, spaces, hyphens or underscores, and a town or country.';return;}
 window.MiniUKGuest={name,location};window.MiniUKWardrobe=null;enter();
});
document.getElementById('underage').addEventListener('click',()=>{adult.checked=false;update();status.textContent='Mini UK is for players aged 18 or older.';});
update();
})();
