(() => {
'use strict';
const adult=document.getElementById('adult'),guest=document.getElementById('guest'),status=document.getElementById('login-status'),googleBox=document.getElementById('google-signin');
let config=null,initializing=false,submitting=false;
window.MiniUKWardrobe=null;
function wardrobe(value){window.MiniUKWardrobe=value.signedIn&&value.wardrobeTicket?{ticket:value.wardrobeTicket,expires:value.expires*1000}:null;}
setInterval(async()=>{if(!window.MiniUKWardrobe)return;try{wardrobe(await json('/auth/session'));}catch(e){window.MiniUKWardrobe=null;}},30000);
async function json(url,options={}){
 const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000),...options});
 const value=await response.json();if(!response.ok)throw new Error(value.error||'Please try again.');return value;
}
function enter(){if(!adult.checked||started)return;window.MiniUKEntryApproved=true;start();}
function update(){guest.disabled=!adult.checked||submitting;googleBox.hidden=!adult.checked;if(!adult.checked)status.textContent='Confirm your age to choose how to join.';else setup();}
async function setup(){
 if(initializing||config)return;initializing=true;status.textContent='Checking sign-in options…';
 try{
  config=await json('/auth/config');
  if(!config.clientId){status.textContent='Google sign-in is not available yet. You can continue as guest.';return;}
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  script.onerror=()=>{status.textContent='Google sign-in could not load. You can continue as guest.';};
  script.onload=()=>{
   google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,auto_select:false,callback:async result=>{
    if(!adult.checked||submitting||started)return;submitting=true;guest.disabled=true;status.textContent='Verifying your Google sign-in…';
    try{const signed=await json('/auth/google',{method:'POST',headers:{'Content-Type':'application/json','X-MiniUK-Login':'1'},body:JSON.stringify({credential:result.credential})});wardrobe(signed);status.textContent='Signed in. Opening Mini UK…';enter();}
    catch(error){status.textContent=error.message;}
    finally{submitting=false;guest.disabled=!adult.checked;}
   }});
   google.accounts.id.renderButton(googleBox,{theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:Math.min(400,googleBox.clientWidth||280)});
   status.textContent='Choose Google sign-in or try Mini UK as a guest.';
  };document.head.appendChild(script);
 }catch(error){status.textContent='Google sign-in is unavailable. You can still continue as guest.';config=null;}
 finally{initializing=false;}
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
