(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let observer=null;
function isCustomer(){return window.LM_ACCESS?.authenticated===true&&window.LM_ACCESS?.platform_admin!==true}
function navLabel(){
  const b=$('.nav button[data-view="leadmanager"]');if(!b)return;
  const spans=b.querySelectorAll('span');
  if(spans.length>1){if(spans[spans.length-1].textContent!=='Indstillinger')spans[spans.length-1].textContent='Indstillinger';}else if(b.textContent!=='Indstillinger')b.textContent='Indstillinger';
}
function heading(){
  if(!isCustomer())return;
  const b=$('.nav button[data-view="leadmanager"]');
  if(b?.classList.contains('active')){
    const t=$('#title'),s=$('#subtitle');
    if(t&&t.textContent!=='Indstillinger')t.textContent='Indstillinger';
    const msg='Opsæt og ændr de funktioner, Lead Manager bruger for jeres virksomhed.';
    if(s&&s.textContent!==msg)s.textContent=msg;
  }
}
function ensureStyle(){
  if($('#lmSettingsHubStyle'))return;
  const s=document.createElement('style');s.id='lmSettingsHubStyle';
  s.textContent=`
  #lmSettingsIntro{margin-bottom:14px;padding:18px 20px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(180deg,#fff,#f8fafc)}
  #lmSettingsIntro h2{margin:0 0 5px;font-size:20px}
  #leadmanager .lm-settings-section-title{margin:22px 0 8px;padding-top:4px}
  #leadmanager .lm-settings-section-title h2{margin:0 0 3px;font-size:15px}
  #leadmanager .lm-settings-section-title+.card{margin-top:0!important}
  #leadmanager .card.section,#leadmanager #mkConnectionsCard{margin-top:10px}
  `;
  document.head.appendChild(s);
}
function intro(){
  const view=$('#leadmanager');if(!view||$('#lmSettingsIntro'))return;
  const d=document.createElement('div');d.id='lmSettingsIntro';
  d.innerHTML='<h2>Indstillinger</h2><div class="sub">Her samles alt, I selv kan opsætte og ændre: leadkriterier, mail, integrationer og marketingforbindelser.</div>';
  view.prepend(d);
}
function hideCommand(){
  if(!isCustomer())return;
  const cmd=$('#lmCommand'),grid=cmd?.closest('.grid2');if(grid)grid.style.display='none';
}
function headingBefore(node,id,title,text){
  if(!node||!node.parentNode)return;
  let h=$('#'+id);
  if(!h){h=document.createElement('div');h.id=id;h.className='lm-settings-section-title';h.innerHTML='<h2>'+esc(title)+'</h2><div class="sub">'+esc(text)+'</div>';}
  if(h.parentNode!==node.parentNode||h.nextSibling!==node)node.parentNode.insertBefore(h,node);
}
function findMinuba(){
  const view=$('#leadmanager');if(!view)return null;
  return [...view.querySelectorAll('.card.section')].find(x=>x.querySelector('h2')?.textContent?.trim()==='Minuba-forbindelse')||null;
}
function rehome(){
  if(!isCustomer())return;
  const view=$('#leadmanager');if(!view)return;
  ensureStyle();navLabel();intro();hideCommand();
  const lead=$('#lmLeadSettingsCard');
  if(lead){if(lead.parentNode!==view)view.appendChild(lead);headingBefore(lead,'lmSettingsLeadHeading','Leads','Bestem hvilke virksomheder, behov og signaler Lead Hunter skal finde.');}
  const mail=$('#lmMailProviderCard');
  if(mail){if(mail.parentNode!==view)view.appendChild(mail);headingBefore(mail,'lmSettingsMailHeading','Mail','Forbind mailkonto og styr afsender, signatur og mailopsætning.');}
  const minuba=findMinuba();
  if(minuba)headingBefore(minuba,'lmSettingsIntegrationHeading','Integrationer','Forbind de systemer, jeres Lead Manager må arbejde sammen med.');
  const marketing=$('#mkConnectionsCard');
  if(marketing){if(marketing.parentNode!==view)view.appendChild(marketing);headingBefore(marketing,'lmSettingsMarketingHeading','Marketing & leadkilder','Forbind formularer, kampagner og andre leadkilder.');}
  heading();
}
function boot(){
  if(typeof window.LM_ACCESS==='undefined'||typeof state==='undefined'||!state?.client){setTimeout(boot,150);return}
  navLabel();if(!isCustomer())return;rehome();
  $('.nav button[data-view="leadmanager"]')?.addEventListener('click',()=>setTimeout(()=>{rehome();heading()},0));
  window.addEventListener('lm:data-refreshed',rehome);
  window.addEventListener('lm:client-data-ready',rehome);
  observer=new MutationObserver(()=>queueMicrotask(rehome));
  observer.observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();