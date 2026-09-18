(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let observer=null,currentTab='leads',scheduled=false,billingState=null,billingLoading=false,billingError='';

function isCustomer(){return window.LM_ACCESS?.authenticated===true&&window.LM_ACCESS?.platform_admin!==true}
function fmtKr(ore){return new Intl.NumberFormat('da-DK',{minimumFractionDigits:0,maximumFractionDigits:2}).format((Number(ore)||0)/100)+' kr./md.'}
function fmtDate(v){if(!v)return'—';try{return new Intl.DateTimeFormat('da-DK',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v))}catch{return String(v)}}
function planName(v){return v==='start'?'Start':v==='pro'?'Pro':v==='business'?'Business':String(v||'—')}
async function planEdge(payload){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Du er ikke logget ind');
  const r=await fetch(SUPABASE_URL+'/functions/v1/saas-plan-change',{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.error||('HTTP '+r.status)),{code:d.code,status:r.status});
  return d;
}

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
    #lmSettingsMailPanel #lmMicrosoftCard,
    #lmSettingsMailPanel #gmailDirectCard,
    #lmSettingsMailPanel #lmMailSenderNameCard,
    #lmSettingsMailPanel #lmMailSignatureCard{margin-top:12px!important}
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
    .lm-subscription{margin-top:14px;border-top:1px solid #e7ebf1;padding-top:18px}
    .lm-subscription-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}
    .lm-subscription-head h3{margin:0 0 4px;font-size:16px}
    .lm-subscription-current{text-align:right}
    .lm-subscription-current strong{display:block;font-size:16px}
    .lm-plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .lm-plan-card{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff;display:flex;flex-direction:column;gap:9px;min-height:152px}
    .lm-plan-card.active{border-color:#3157e8;background:#f7f9ff;box-shadow:0 0 0 1px rgba(49,87,232,.12)}
    .lm-plan-card h4{margin:0;font-size:15px}
    .lm-plan-price{font-size:20px;font-weight:850;color:#10203a}
    .lm-plan-card .sub{font-size:12px;line-height:1.35;flex:1}
    .lm-plan-card .btn{width:100%}
    .lm-plan-card .btn[disabled]{opacity:.55;cursor:not-allowed}
    .lm-billing-lock{margin:12px 0;padding:10px 12px;border-radius:11px;background:#fff8e8;border:1px solid #f4ddb0;color:#805b15;font-size:12px}
    .lm-billing-docs{margin-top:16px}
    .lm-billing-doc{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-top:1px solid #e7ebf1}
    .lm-billing-doc:first-of-type{border-top:0}
    .lm-billing-doc strong{display:block}
    .lm-billing-doc .sub{font-size:12px}
    .lm-billing-doc-amount{text-align:right;white-space:nowrap}
    .lm-plan-modal{position:fixed;inset:0;z-index:17000;background:rgba(15,23,42,.48);display:grid;place-items:center;padding:20px}
    .lm-plan-modal-card{width:min(560px,100%);background:#fff;border-radius:18px;padding:22px;box-shadow:0 26px 80px rgba(15,23,42,.24)}
    .lm-plan-modal-card h3{margin:0 0 8px;font-size:20px}
    .lm-plan-summary{margin:14px 0;padding:13px 14px;border-radius:12px;background:#f8fafc;border:1px solid #e7ebf1}
    .lm-plan-summary div{margin:5px 0}
    .lm-plan-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
    #lmSettingsShell .pill{white-space:nowrap}
    #lmSettingsShell .notice{border-radius:11px!important}
    @media(max-width:760px){
      .lm-settings-tabs{width:100%}.lm-settings-tab{flex:1 1 auto}
      .lm-account-grid{grid-template-columns:1fr}
      .lm-plan-grid{grid-template-columns:1fr}
      .lm-subscription-head{flex-direction:column}.lm-subscription-current{text-align:left}
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
  if(currentTab==='account')loadBilling(false);
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
  const cl=state.client||{},s=cl.settings||{},role=window.LM_ACCESS?.role||'workspace_user';
  const roleName=role==='workspace_owner'?'Ejer':role==='workspace_admin'?'Administrator':'Bruger';
  const sub=billingState?.subscription||null,current=billingState?.current_plan||sub?.plan_code||window.__LM_SAAS_PLAN?.plan_code||'start';
  const price=sub?.monthly_price_ore??({start:14900,pro:19900,business:24900}[current]||0);
  const locked=!!(sub?.lock_until&&new Date(sub.lock_until).getTime()>Date.now());
  const canChange=['workspace_owner','workspace_admin'].includes(role)&&!locked;
  const plans=billingState?.plans||[
    {code:'start',name:'Start',price_ore:14900},
    {code:'pro',name:'Pro',price_ore:19900},
    {code:'business',name:'Business',price_ore:24900}
  ];
  const planCopy={
    start:'Grundpakken til den enkle leadproces.',
    pro:'Flere automatiseringer, mailovervågning og Minuba.',
    business:'Udbud, større kapacitet og de fulde salgsfunktioner.'
  };
  const docs=billingState?.billing_documents||[];

  card.innerHTML=`
    <div class="lm-account-grid">
      <div class="lm-account-item"><span>Virksomhed</span><strong>${esc(cl.name||'—')}</strong></div>
      <div class="lm-account-item"><span>Login</span><strong>${esc(state.session?.user?.email||s.mail||'—')}</strong></div>
      <div class="lm-account-item"><span>Kontaktperson</span><strong>${esc(s.contact_name||'—')}</strong></div>
      <div class="lm-account-item"><span>Rolle</span><strong>${esc(roleName)}</strong></div>
      <div class="lm-account-item"><span>Workspace</span><strong>${esc(cl.name||window.LM_ACCESS?.workspace_name||'—')}</strong></div>
      <div class="lm-account-item"><span>Fakturering</span><strong>1 måned bagud</strong></div>
    </div>

    <div class="lm-subscription">
      <div class="lm-subscription-head">
        <div><h3>Abonnement</h3><div class="sub">Op- eller nedgradér pakken her. En pakkeændring gælder med det samme og giver 30 dages binding.</div></div>
        <div class="lm-subscription-current"><span class="sub">Aktiv pakke</span><strong>${esc(planName(current))}</strong><span class="sub">${esc(fmtKr(price))}</span></div>
      </div>

      ${billingLoading?'<div class="lm-settings-note">Henter abonnement og fakturering…</div>':''}
      ${billingError?'<div class="notice">'+esc(billingError)+'</div>':''}
      ${locked?'<div class="lm-billing-lock"><strong>30 dages binding er aktiv.</strong> Pakken kan ændres igen fra '+esc(fmtDate(sub.lock_until))+'.</div>':''}

      <div class="lm-plan-grid">
        ${plans.map(p=>`
          <div class="lm-plan-card ${p.code===current?'active':''}">
            <div><h4>${esc(p.name||planName(p.code))}</h4><div class="lm-plan-price">${esc(fmtKr(p.price_ore))}</div></div>
            <div class="sub">${esc(planCopy[p.code]||'Lead Manager abonnement.')}</div>
            <button type="button" class="btn ${p.code===current?'':'primary'}" data-lm-plan-change="${esc(p.code)}" ${p.code===current||!canChange?'disabled':''}>
              ${p.code===current?'Aktiv pakke':locked?'Låst i bindingsperioden':p.price_ore>price?'Opgradér':'Nedgradér'}
            </button>
          </div>
        `).join('')}
      </div>

      <div class="lm-settings-note"><strong>Sådan faktureres ændringer:</strong> Lead Manager betales én måned bagud. Ved en pakkeændring oprettes regningen med det samme, den nye pakke træder i kraft med det samme, og beløbet medtages på den næste faktura. Efter ændringen er pakken bundet i 30 dage.</div>

      ${docs.length?`<div class="lm-billing-docs"><h3 style="margin:0 0 6px;font-size:15px">Seneste regninger og pakkeændringer</h3>${docs.map(d=>`
        <div class="lm-billing-doc">
          <div><strong>${esc(d.document_no||'Regning')}</strong><div class="sub">${esc(planName(d.plan_from))} → ${esc(planName(d.plan_to))} · oprettet ${esc(fmtDate(d.created_at))}</div><div class="sub">Medtages på næste faktura omkring ${esc(fmtDate(d.invoice_on))}</div></div>
          <div class="lm-billing-doc-amount"><strong>${esc(fmtKr(d.amount_ore).replace('/md.',''))}</strong><div class="sub">${d.status==='scheduled'?'Planlagt':'Registreret'}</div></div>
        </div>
      `).join('')}</div>`:''}
    </div>

    <div class="lm-settings-note">Virksomhedsoplysninger fra onboarding bruges som grundlag for Lead Manager. Leadkriterier ændres under fanen <strong>Leads</strong>, og mailopsætning ændres under <strong>Mail</strong>.</div>
  `;

  card.querySelectorAll('[data-lm-plan-change]').forEach(b=>b.addEventListener('click',()=>openPlanModal(b.dataset.lmPlanChange)));
}

async function loadBilling(force=false){
  if(billingLoading||(!force&&billingState))return;
  billingLoading=true;billingError='';renderAccount();
  try{billingState=await planEdge({action:'status'})}
  catch(e){billingError=e?.message||String(e)}
  finally{billingLoading=false;renderAccount()}
}

function openPlanModal(target){
  const p=(billingState?.plans||[]).find(x=>x.code===target)||{code:target,name:planName(target),price_ore:{start:14900,pro:19900,business:24900}[target]||0};
  const current=billingState?.current_plan||billingState?.subscription?.plan_code||'start';
  if(target===current)return;
  $('#lmPlanModal')?.remove();
  const m=document.createElement('div');m.id='lmPlanModal';m.className='lm-plan-modal';
  m.innerHTML=`<div class="lm-plan-modal-card">
    <h3>Bekræft pakkeændring</h3>
    <div class="sub">Du ændrer fra <strong>${esc(planName(current))}</strong> til <strong>${esc(p.name||planName(target))}</strong>.</div>
    <div class="lm-plan-summary">
      <div><strong>Ny pris:</strong> ${esc(fmtKr(p.price_ore))}</div>
      <div><strong>Træder i kraft:</strong> med det samme</div>
      <div><strong>Binding:</strong> 30 dage fra ændringen</div>
      <div><strong>Betaling:</strong> én måned bagud</div>
      <div><strong>Regning:</strong> oprettes nu og medtages på næste faktura</div>
    </div>
    <div class="sub">Efter bindingsperioden fortsætter pakken til samme månedspris, indtil I ændrer den igen.</div>
    <div id="lmPlanModalMsg" class="sub" style="margin-top:10px"></div>
    <div class="lm-plan-actions"><button type="button" class="btn" id="lmPlanCancel">Annuller</button><button type="button" class="btn primary" id="lmPlanConfirm">Bekræft pakkeændring</button></div>
  </div>`;
  document.body.appendChild(m);
  $('#lmPlanCancel').onclick=()=>m.remove();
  $('#lmPlanConfirm').onclick=()=>confirmPlanChange(target);
}

async function confirmPlanChange(target){
  const btn=$('#lmPlanConfirm'),msg=$('#lmPlanModalMsg');if(!btn)return;
  btn.disabled=true;if(msg)msg.textContent='Ændrer pakke og opretter regning…';
  try{
    const d=await planEdge({action:'change',plan_code:target});
    billingState=null;
    if(msg)msg.textContent='Pakken er ændret, og regningen er oprettet til næste faktura.';
    if(typeof toast==='function')toast('Pakke ændret til '+planName(target));
    await loadBilling(true);
    setTimeout(()=>location.reload(),900);
  }catch(e){
    if(msg)msg.textContent=e?.message||String(e);
    btn.disabled=false;
  }
}

function rehome(){
  if(!isCustomer())return;
  const view=$('#leadmanager');if(!view)return;
  ensureStyle();navLabel();shell();removeCustomerAdminUi();

  const lead=$('#lmLeadSettingsCard'),leadPanel=$('#lmSettingsLeadPanel');
  if(lead&&leadPanel&&lead.parentNode!==leadPanel)leadPanel.appendChild(lead);

  const mail=$('#lmMailProviderCard'),mailPanel=$('#lmSettingsMailPanel');
  if(mail&&mailPanel&&mail.parentNode!==mailPanel)mailPanel.appendChild(mail);

  const microsoft=$('#lmMicrosoftCard');
  if(microsoft&&mailPanel&&microsoft.parentNode!==mailPanel)mailPanel.appendChild(microsoft);

  const gmail=$('#gmailDirectCard');
  if(gmail&&mailPanel&&gmail.parentNode!==mailPanel)mailPanel.appendChild(gmail);

  const sender=$('#lmMailSenderNameCard');
  if(sender&&mailPanel&&sender.parentNode!==mailPanel)mailPanel.appendChild(sender);

  const signature=$('#lmMailSignatureCard');
  if(signature&&mailPanel&&signature.parentNode!==mailPanel)mailPanel.appendChild(signature);

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
  rehome();loadBilling(false);
  $('.nav button[data-view="leadmanager"]')?.addEventListener('click',()=>setTimeout(()=>{rehome();heading()},0));
  document.querySelectorAll('.nav button:not([data-view="leadmanager"])').forEach(b=>b.addEventListener('click',()=>setTimeout(heading,0)));
  window.addEventListener('lm:data-refreshed',schedule);
  window.addEventListener('lm:client-data-ready',schedule);
  observer=new MutationObserver(schedule);
  observer.observe($('#leadmanager'),{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();