(()=>{
'use strict';
function clientId(){try{return state?.client?.id||null}catch{return null}}
function savedDraft(){const id=clientId();if(!id)return null;try{return JSON.parse(localStorage.getItem('lm_ob4_'+id)||'null')}catch{return null}}
function sync(){const field=document.querySelector('#lmOb4 input[data-f="mail_account"]');if(!field)return false;if(field.dataset.mailSyncBound!=='1'){field.dataset.mailSyncBound='1';field.addEventListener('input',e=>{if(e.isTrusted)field.dataset.userTouched='1'})}if(field.dataset.userTouched==='1')return true;const d=savedDraft(),business=String(d?.business_email||'').trim().toLowerCase();if(!business)return true;if(String(field.value||'').trim().toLowerCase()!==business){field.value=business;d.mail_account=business;try{localStorage.setItem('lm_ob4_'+clientId(),JSON.stringify(d))}catch{}}return true}
let retryRun=0;
function arm(){
  const run=++retryRun;
  const delays=[0,100,250,500,1000,2000,4000,7000,11000];
  for(const delay of delays)setTimeout(()=>{if(run!==retryRun)return;if(sync())retryRun++},delay);
}
window.addEventListener('lm:central-onboarding-required',()=>setTimeout(arm,0));
window.addEventListener('lm:onboarding-required',()=>setTimeout(arm,0));
window.addEventListener('lm:client-switched',()=>setTimeout(arm,0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(arm,150),{once:true});else setTimeout(arm,150);
})();