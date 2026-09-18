(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let observer=null,currentTab='leads',scheduled=false;

function isCustomer(){return window.LM_ACCESS?.authenticated===true&&window.LM_ACCESS?.platform_admin!==true}

function navLabel(){
  const b=$('.nav button[data-view="leadmanager"]');if(!b)return;
  const spans=b.querySelectorAll('span');
  if(spans.length>1){if(spans[spans.length-1].textContent!=='Indstillinger')spans[spans.length-1].textContent='Indstillinger'}
  else if(b.textContent!=='Indstillinger')b.textContent='Indstillinger';
}

function settingsActive(){return !!$('.nav button[data-view="leadmanager"]')?.classList.contains('active')}

function heading(){
  if(!isCustomer())return;
  const active=settingsActive();
  document.body.classList.toggle('lm-settings-active',active);
  if(!active)return;
  const t=$('#title'),s=$('#subtitle');
  if(t)t.textContent='Indstillinger';
  if(s)s.textContent='Styr jeres leads, mail og integrationer ét sted.';
}

function ensureStyle(){
  if($('#lmSettingsHubStyle'))return;
  const s=document.createElement('style');s.id='lmSettingsHubStyle';
  s.textContent=`
    body.lm-settings-active .topactions{display:none!important}
    body.lm-settings-active #leadmanager{max-width:1180px;margin:0 auto}
    #lmSettingsShell{display:grid;gap:18px}
    #lmSettingsIntro{padding:22px 24px;border:1px solid #e5eaf0;border-radius:18px;background:linear-gradient(135deg,#fff 0%,#f7f9ff 100%);box-shadow:0 8px 28px rgba(30,55,90,.05)}
    #lmSettingsIntro h2{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
    #lmSettingsIntro .sub{max-width:720px;line-height:1.5}
    .lm-settings-tabs{display:flex;gap:7px;flex-wrap:wrap;padding:5px;background:#eef2f7;border-radius:13px;width:max-content;max-width:100%}
    .lm-settings-tab{border:0;background:transparent;color:#52606a;font-weight:750;padding:9px 14px;border-radius:9px;cursor:pointer}
    .lm-settings-tab.active{background:#fff;color:#2451d6;box-shadow:0 2px 7px rgba(30,55,90,.08)}
    .lm-settings-panel{display:none}
    .lm-settings-panel.active{display:block}
    .lm-settings-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:2px 0 10px}
    .lm-settings-panel-head h2{margin:0 0 3px;font-size:17px}
    .lm-settings-panel-head .sub{max-width:760px}
    #leadmanager .card.section,#leadmanager .card{box-shadow:0 4px 18px rgba(30,55,90,.045)!important}
    #leadmanager .lm-settings-panel>.card{margin-top:0!important}
    #lmLeadSettingsCard{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px!important}
    #lmLeadSettingsCard h2{font-size:16px!important;margin:0 0 3px!important}
    #lmLeadSettingsCard .sub{max-width:700px}
    #lmMailProviderCard{padding:20px!important}
    #lmMailProviderCard>.split:first-child{align-items:center!important}
    #lmMailProviderCard>.split:first-child .sub{max-width:720px}
    #lmMailProviderCard .lm-mail-provider-grid{display:grid!important;grid-template-columns:1fr!important;gap:12px!important;margin-top:16px!important}
    #lmMailProviderCard .lm-mail-provider-box{background:#fff!important;border:1px solid #e7ebf1!important;border-radius:14px!important;padding:16px!important}
    #lmMailProviderCard .lm-mail-provider-grid>.lm-mail-provider-box:first-child{background:#fbfcfe!important}
    #lmMailProviderCard .field{margin:10px 0!important}
    #lmMailProviderCard .field label{font-weight:700;color:#475569}
    #lmMailProviderCard input,#lmMailProviderCard select{min-height:42px}
    #lmMailProviderCard .lm-mail-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px!important}
    #lmMailProviderCard .lm-mail-account{min-height:68px;align-items:center!important;background:#fbfcfe!important}
    #lmMailProviderCard .lm-mail-options{margin:10px 0 0!important}
    #lmMailProviderCard .lm-mail-server{font-size:11.5px!important}
    .lm-settings-advanced{margin-top:12px;border-top:1px solid #e7ebf1;padding-top:10px}
    .lm-settings-advanced summary{cursor:pointer;font-weight:750;color:#475569;list-style:none;display:flex;align-items:center;gap:7px}
    .lm-settings-advanced summary::-webkit-details-marker{display:none}
    .lm-settings-advanced summary:before{content:'›';font-size:20px;line-height:1;transition:transform .15s ease}
    .lm-settings-advanced[open] summary:before{transform:rotate(90deg)}
    .lm-settings-advanced .lm-advanced-body{margin-top:10px;padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e7ebf1}
    #lmSettingsIntegrationPanel .card{padding:20px!important}
    #lmSettingsAccountCard{padding:20px!important}
    .lm-account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .lm-account-item{border:1px solid #e7ebf1;border-radius:12px;padding:12px 14px;background:#fbfcfe}
    .lm-account-item span{display:block;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:800;margin-bottom:4px}
    .lm-account-item strong{display:block;font-size:14px;overflow-wrap:anywhere}
    .lm-settings-note{margin-top:12px;padding:11px 13px;border-radius:11px;background:#f8fafc;border:1px solid #e7ebf1;color:#64748b;font-size:12px}
    #lmSettingsShell .pill{white-space:nowrap}
    #lmSettingsShell .notice{border-radius:11px!important}
    @media(max-width:760px){
      .lm-settings-tabs{width:100%}.lm-settings-tab{flex:1 1 auto}
      .lm-account-grid{grid-template-columns:1fr}
      #lmLeadSettingsCard{align-items:flex-start;flex-direction:column}
      #lmLeadSettingsCard .btn{width:100%}
    }
  `;
  document.head.appendChild(s);
}

function shell(){
  const view=$('#leadmanager');if(!view)return null;
  let sh=$('#lmSettingsShell');
  if(sh)return sh;
  sh=document.createElement('div');sh.id='lmSettingsShell';
  sh.innerHTML=`
    <div id="lmSettingsIntro">
      <h2>Indstillinger</h2>
      <div class="sub">Her kan I ændre det, Lead Manager bruger i jeres daglige arbejde. Tekniske og administrative systemindstillinger er skjult for kundebrugere.</div>
    </div>
    <div class="lm-settings-tabs" role="tablist" aria-label="Indstillinger">
      <button class="lm-settings-tab active" type="button" data-lm-settings-tab="leads">Leads</button>
      <button class="lm-settings-tab" type="button" data-lm-settings-tab="mail">Mail</button>
      <button class="lm-settings-tab" type="button" data-lm-settings-tab="integrations">Integrationer</button>
      <button class="lm-settings-tab" type="button" data-lm-settings-tab="account">Konto</button>
    </div>
    <section id="lmSettingsLeadPanel" class="lm-settings-panel active" data-lm-settings-panel="leads">
      <div class="lm-settings-panel-head"><div><h2>Leads</h2><div class="sub">Bestem hvilke virksomheder og signaler Lead Hunter skal lede efter.</div></div></div>
    </section>
    <section id="lmSettingsMailPanel" class="lm-settings-panel" data-lm-settings-panel="mail">
      <div class="lm-settings-panel-head"><div><h2>Mail</h2><div class="sub">Forbind mailkonto, vælg afsender og styr signatur og forbindelse.</div></div></div>
    </section>
    <section id="lmSettingsIntegrationPanel" class="lm-settings-panel" data-lm-settings-panel="integrations">
      <div class="lm-settings-panel-head"><div><h2>Integrationer</h2><div class="sub">Forbind de systemer, Lead Manager må arbejde sammen med.</div></div></div>
    </section>
    <section id="lmSettingsAccountPanel" class="lm-settings-panel" data-lm-settings-panel="account">
      <div class="lm-settings-panel-head"><div><h2>Konto</h2><div class="sub">Se virksomhed, bruger og abonnement for dette workspace.</div></div></div>
      <div id="lmSettingsAccountCard" class="card"></div>
    </section>
  `;
  view.prepend(sh);
  sh.querySelectorAll('[data-lm-settings-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.lmSettingsTab)));
  return sh;
}

function selectTab(tab){
  currentTab=tab||'leads';
  document.querySelectorAll('[data-lm-settings-tab]').forEach(b=>b.classList.toggle('active',b.dataset.lmSettingsTab===currentTab));
  document.querySelectorAll('[data-lm-settings-panel]').forEach(p=>p.classList.toggle('active',p.dataset.lmSettingsPanel===currentTab));
}

function removeCustomerAdminUi(){
  if(!isCustomer())return;
  const cmd=$('#lmCommand'),grid=cmd?.closest('.grid2');if(grid)grid.style.display='none';
  const ai=$('#openaiApiKey')?.closest('.card.section');if(ai)ai.style.display='none';
  $('#lmSettingsMarketingHeading')?.remove();
  $('#mkConnectionsCard')?.remove();
}

function polishMail(){
  const card=$('#lmMailProviderCard');if(!card||card.dataset.lmSettingsPolished==='1')return;
  card.dataset.lmSettingsPolished='1';
  const grid=card.querySelector('.lm-mail-provider-grid');
  if(!grid)return;
  const boxes=[...grid.children].filter(x=>x.classList?.contains('lm-mail-provider-box'));
  const setup=boxes[0],accounts=boxes[1];
  if(accounts&&setup){
    accounts.querySelector('h3')?.replaceChildren(document.createTextNode('Forbundne mailkonti'));
    grid.insertBefore(accounts,setup);
  }
  if(setup){
    const username=$('#lmMailUsernameWrap'),smtp=$('#lmMailSmtpFields');
    if((username||smtp)&&!$('#lmMailAdvanced')){
      const details=document.createElement('details');details.id='lmMailAdvanced';details.className='lm-settings-advanced';
      details.innerHTML='<summary>Avancerede mailindstillinger</summary><div class="lm-advanced-body"></div>';
      const body=details.querySelector('.lm-advanced-body');
      if(username)body.appendChild(username);
      if(smtp)body.appendChild(smtp);
      const buttons=setup.querySelector('.split');
      setup.insertBefore(details,buttons||null);
    }
  }
}

function renderAccount(){
  const card=$('#lmSettingsAccountCard');if(!card||typeof state==='undefined'||!state?.client)return;
  const c=state.client||{},s=c.settings||{},plan=window.__LM_SAAS_PLAN||{},role=window.LM_ACCESS?.role||'workspace_user';
  const planName=String(plan.plan_code||'start').replace(/^./,m=>m.toUpperCase());
  const roleName=role==='workspace_owner'?'Ejer':role==='workspace_admin'?'Administrator':'Bruger';
  card.innerHTML=`
    <div class="lm-account-grid">
      <div class="lm-account-item"><span>Virksomhed</span><strong>${esc(c.name||'—')}</strong></div>
      <div class="lm-account-item"><span>Login</span><strong>${esc(state.session?.user?.email||s.mail||'—')}</strong></div>
      <div class="lm-account-item"><span>Kontaktperson</span><strong>${esc(s.contact_name||'—')}</strong></div>
      <div class="lm-account-item"><span>Abonnement</span><strong>${esc(planName)}</strong></div>
      <div class="lm-account-item"><span>Rolle</span><strong>${esc(roleName)}</strong></div>
      <div class="lm-account-item"><span>Workspace</span><strong>${esc(c.name||window.LM_ACCESS?.workspace_name||'—')}</strong></div>
    </div>
    <div class="lm-settings-note">Virksomhedsoplysninger fra onboarding bruges som grundlag for Lead Manager. Leadkriterier ændres under fanen <strong>Leads</strong>, og mailopsætning ændres under <strong>Mail</strong>.</div>
  `;
}

function rehome(){
  if(!isCustomer())return;
  const view=$('#leadmanager');if(!view)return;
  ensureStyle();navLabel();shell();removeCustomerAdminUi();

  const lead=$('#lmLeadSettingsCard'),leadPanel=$('#lmSettingsLeadPanel');
  if(lead&&leadPanel&&lead.parentNode!==leadPanel)leadPanel.appendChild(lead);

  const mail=$('#lmMailProviderCard'),mailPanel=$('#lmSettingsMailPanel');
  if(mail&&mailPanel&&mail.parentNode!==mailPanel)mailPanel.appendChild(mail);
  polishMail();

  const minuba=[...view.querySelectorAll('.card.section')].find(x=>x.querySelector('h2')?.textContent?.trim()==='Bruger I Minuba?'||x.querySelector('h2')?.textContent?.trim()==='Minuba-forbindelse');
  const intPanel=$('#lmSettingsIntegrationPanel');
  if(minuba&&intPanel&&minuba.parentNode!==intPanel)intPanel.appendChild(minuba);

  renderAccount();selectTab(currentTab);heading();
}

function schedule(){
  if(scheduled)return;scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;rehome()});
}

function boot(){
  if(typeof window.LM_ACCESS==='undefined'||typeof state==='undefined'||!state?.client){setTimeout(boot,150);return}
  navLabel();if(!isCustomer())return;
  rehome();
  $('.nav button[data-view="leadmanager"]')?.addEventListener('click',()=>setTimeout(()=>{rehome();heading()},0));
  document.querySelectorAll('.nav button:not([data-view="leadmanager"])').forEach(b=>b.addEventListener('click',()=>setTimeout(heading,0)));
  window.addEventListener('lm:data-refreshed',schedule);
  window.addEventListener('lm:client-data-ready',schedule);
  observer=new MutationObserver(schedule);
  observer.observe($('#leadmanager'),{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();