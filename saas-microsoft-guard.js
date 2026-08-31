(()=>{
'use strict';
function apply(){
  const card=document.querySelector('[data-mail="microsoft"]');
  if(!card)return;
  card.classList.add('disabled');
  card.dataset.microsoftPending='1';
  const sub=card.querySelector('.sub');
  if(sub&&!/kommer snart/i.test(sub.textContent||''))sub.textContent='Microsoft 365 / Outlook · kommer snart. Platformens Microsoft OAuth skal aktiveres først.';
}
document.addEventListener('click',e=>{
  const card=e.target?.closest?.('[data-mail="microsoft"]');
  if(!card)return;
  e.preventDefault();e.stopImmediatePropagation();
  apply();
  const box=document.getElementById('obMailState');
  if(box)box.innerHTML='<div class="ob-warn"><strong>Microsoft 365 / Outlook er ikke aktiveret endnu.</strong><br>Google / Gmail kan gennemføres nu. Microsoft-valget åbnes, når den fælles Microsoft OAuth-forbindelse er sat op.</div>';
},true);
new MutationObserver(apply).observe(document.documentElement,{subtree:true,childList:true});
setInterval(apply,700);setTimeout(apply,100);
})();