(()=>{
'use strict';
function clientId(){try{return state?.client?.id||null}catch{return null}}
function savedDraft(){const id=clientId();if(!id)return null;try{return JSON.parse(localStorage.getItem('lm_ob4_'+id)||'null')}catch{return null}}
function sync(){const field=document.querySelector('#lmOb4 input[data-f="mail_account"]');if(!field)return;if(field.dataset.mailSyncBound!=='1'){field.dataset.mailSyncBound='1';field.addEventListener('input',e=>{if(e.isTrusted)field.dataset.userTouched='1'})}if(field.dataset.userTouched==='1')return;const d=savedDraft(),business=String(d?.business_email||'').trim().toLowerCase();if(!business)return;if(String(field.value||'').trim().toLowerCase()!==business){field.value=business;d.mail_account=business;try{localStorage.setItem('lm_ob4_'+clientId(),JSON.stringify(d))}catch{}}}
new MutationObserver(()=>setTimeout(sync,0)).observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('click',()=>setTimeout(sync,20),true);
setInterval(sync,800);
setTimeout(sync,300);
})();