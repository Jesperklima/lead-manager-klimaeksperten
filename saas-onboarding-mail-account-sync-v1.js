(()=>{
'use strict';
function clientId(){try{return state?.client?.id||null}catch{return null}}
function savedDraft(){const id=clientId();if(!id)return null;try{return JSON.parse(localStorage.getItem('lm_ob4_'+id)||'null')}catch{return null}}
function sync(){const field=document.querySelector('#lmOb4 input[data-f="mail_account"]');if(!field)return false;if(field.dataset.mailSyncBound!=='1'){field.dataset.mailSyncBound='1';field.addEventListener('input',e=>{if(e.isTrusted)field.dataset.userTouched='1'})}if(field.dataset.userTouched==='1')return true;const d=savedDraft(),business=String(d?.business_email||'').trim().toLowerCase();if(!business)return true;if(String(field.value||'').trim().toLowerCase()!==business){field.value=business;d.mail_account=business;try{localStorage.setItem('lm_ob4_'+clientId(),JSON.stringify(d))}catch{}}return true}
let observer=null,stopTimer=null;
function disarm(){observer?.disconnect();observer=null;if(stopTimer){clearTimeout(stopTimer);stopTimer=null}}
function arm(){disarm();if(sync())return;const root=document.body||document.documentElement;if(!root)return;observer=new MutationObserver(()=>{if(sync())disarm()});observer.observe(root,{subtree:true,childList:true});stopTimer=setTimeout(disarm,12000)}
window.addEventListener('lm:central-onboarding-required',()=>setTimeout(arm,0));
window.addEventListener('lm:onboarding-required',()=>setTimeout(arm,0));
window.addEventListener('lm:client-switched',()=>setTimeout(arm,0));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(arm,150),{once:true});else setTimeout(arm,150);
})();