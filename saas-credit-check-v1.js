(()=>{
  'use strict';
  const API='https://ouqhostcsvdyrkjefiya.supabase.co';
  const APIKEY='sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
  let lastLeadId='',leadBusy=false,historyLoaded=false;
  const txt=v=>v==null?'':String(v).trim();
  const esc=s=>txt(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>{const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',maximumFractionDigits:0}).format(n):'—'};
  const date=v=>{try{return new Intl.DateTimeFormat('da-DK',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch{return txt(v)}};

  function session(){
    try{const s=JSON.parse(localStorage.getItem('lm_supabase_session_v1')||'null');if(s?.access_token)return s}catch{}
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i),raw=key&&localStorage.getItem(key);if(!raw)continue;
      try{const value=JSON.parse(raw),candidates=[value,value.session,value.currentSession,value.data?.session];for(const item of candidates)if(item?.access_token)return item}catch{}
    }
    return null;
  }
  async function edge(payload){
    const s=session();if(!s?.access_token)return {error:'Login-sessionen kunne ikke findes. Log ind igen.',code:'NO_SESSION'};
    const response=await fetch(API+'/functions/v1/credit-check',{
      method:'POST',headers:{apikey:APIKEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
    return response.ok?{data}:{error:data.error||('HTTP '+response.status),code:data.code||null,status:response.status};
  }
  function levelMeta(level){
    if(level==='high')return {icon:'●',label:'Høj risiko',cls:'high'};
    if(level==='elevated')return {icon:'●',label:'Forhøjet risiko',cls:'elevated'};
    return {icon:'●',label:'Lav offentlig risiko',cls:'low'};
  }
  function signalHtml(signal){
    const icon=signal.severity==='critical'?'!':signal.severity==='attention'?'△':signal.severity==='positive'?'✓':'i';
    return '<div class="cc-signal '+esc(signal.severity)+'"><span class="cc-signal-icon">'+icon+'</span><div><strong>'+esc(signal.title)+'</strong><div>'+esc(signal.detail)+'</div></div></div>';
  }
  function resultHtml(check,meta={}){
    const company=check?.company_snapshot||{},level=levelMeta(check?.risk_level),signals=Array.isArray(check?.signals)?check.signals:[];
    const cached=meta.cached?'<span class="cc-cache">Genbrugt data fra seneste døgn</span>':'';
    const stale=meta.stale?'<div class="notice" style="margin-top:10px">Kilden kunne ikke opdateres. Resultatet bruger det senest gemte datagrundlag.</div>':'';
    return '<div class="cc-result '+level.cls+'">'
      +'<div class="cc-result-head"><div><div class="cc-company">'+esc(check.company_name||company.name||'Virksomhed')+'</div><div class="sub">CVR '+esc(check.cvr)+' · '+esc(company.companydesc||company.companytypeshort||'')+'</div></div><div class="cc-score"><span>'+level.icon+'</span><strong>'+esc(check.risk_score)+'/100</strong><small>'+esc(level.label)+'</small></div></div>'
      +'<div class="cc-company-grid"><div><span>Status</span><strong>'+esc(company.status||'Ukendt')+'</strong></div><div><span>Startdato</span><strong>'+esc(company.startdate||'Ukendt')+'</strong></div><div><span>Medarbejdere</span><strong>'+(company.employees==null?'Ukendt':esc(company.employees))+'</strong></div><div><span>Ordrebeløb</span><strong>'+(check.order_value==null?'Ikke angivet':money(check.order_value))+'</strong></div></div>'
      +'<div class="cc-recommend"><span>Anbefaling</span><strong>'+esc(check.recommendation)+'</strong></div>'
      +'<div class="cc-signals">'+signals.map(signalHtml).join('')+'</div>'+stale
      +'<div class="cc-source">Kontrolleret '+esc(date(check.source_checked_at||check.checked_at))+' · '+cached+' <a href="'+esc(check.source_url||('https://datacvr.virk.dk/enhed/virksomhed/'+check.cvr))+'" target="_blank" rel="noopener">Åbn CVR-oplysninger i Virk</a></div>'
      +'<div class="cc-disclaimer">Offentlig risikoscreening – ikke RKI og ikke en fuld kreditrapport. Ved større ordrer bør regnskab og betalingsvilkår vurderes særskilt.</div></div>';
  }

  function installStyles(){
    if(document.getElementById('lm-credit-check-css'))return;
    const style=document.createElement('style');style.id='lm-credit-check-css';style.textContent=`
      .cc-shell{max-width:1060px}.cc-form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto;gap:12px;align-items:end}.cc-form .field{margin:0}.cc-form input{width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:10px}.cc-help{margin:12px 0 0;color:var(--muted);font-size:13px}.cc-result{border:1px solid var(--border);border-left:5px solid #64748b;background:#fff;border-radius:14px;padding:16px}.cc-result.low{border-left-color:#16a36a}.cc-result.elevated{border-left-color:#d18b12}.cc-result.high{border-left-color:#c23b3b}.cc-result-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.cc-company{font-size:20px;font-weight:850;color:#10203a}.cc-score{min-width:130px;display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center}.cc-score>span{grid-row:1/3;font-size:24px;color:#64748b}.cc-result.low .cc-score>span{color:#16a36a}.cc-result.elevated .cc-score>span{color:#d18b12}.cc-result.high .cc-score>span{color:#c23b3b}.cc-score strong{font-size:21px}.cc-score small{font-size:12px;color:var(--muted)}.cc-company-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0}.cc-company-grid>div{background:#f7f9fc;border:1px solid #e7ebf0;border-radius:10px;padding:10px}.cc-company-grid span,.cc-recommend span{display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.045em;color:#687386;margin-bottom:4px}.cc-company-grid strong{font-size:13px}.cc-recommend{padding:13px 14px;background:#edf3ff;border-radius:11px;margin:12px 0}.cc-recommend strong{display:block;line-height:1.45}.cc-signals{display:grid;gap:7px}.cc-signal{display:grid;grid-template-columns:25px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #eef1f4;font-size:13px}.cc-signal:last-child{border-bottom:0}.cc-signal-icon{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#eef2f7;font-weight:900}.cc-signal.positive .cc-signal-icon{background:#dff7eb;color:#14784f}.cc-signal.attention .cc-signal-icon{background:#fff0d5;color:#976000}.cc-signal.critical .cc-signal-icon{background:#ffe2e2;color:#ae2e2e}.cc-signal>div>div{color:var(--muted);margin-top:2px}.cc-source{margin-top:10px;font-size:12px;color:var(--muted)}.cc-source a{margin-left:4px}.cc-cache{margin-right:3px}.cc-disclaimer{margin-top:8px;font-size:12px;color:#687386}.cc-history{display:grid;gap:9px}.cc-history-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--border)}.cc-history-row:last-child{border-bottom:0}.cc-mini{width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:7px;background:#64748b}.cc-mini.low{background:#16a36a}.cc-mini.elevated{background:#d18b12}.cc-mini.high{background:#c23b3b}.cc-lead-empty{padding:4px 0}.cc-lead-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cc-loading{padding:16px;text-align:center;color:var(--muted)}
      @media(max-width:760px){.cc-form{grid-template-columns:1fr}.cc-company-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-result-head{flex-direction:column}.cc-history-row{grid-template-columns:1fr auto}.cc-history-row>small{grid-column:1/-1}}
    `;document.head.appendChild(style);
  }
  function activateView(button){
    document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));button.classList.add('active');
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.getElementById('creditcheck')?.classList.add('active');
    const title=document.getElementById('title'),subtitle=document.getElementById('subtitle');if(title)title.textContent='Kreditcheck';if(subtitle)subtitle.textContent='Tjek en ny virksomhed, før I accepterer ordren.';
    loadHistory();
  }
  function installView(){
    const nav=document.querySelector('.nav'),leadManager=document.getElementById('leadmanager');if(!nav||!leadManager)return;
    if(!document.getElementById('creditcheck')){
      const section=document.createElement('section');section.id='creditcheck';section.className='view';section.innerHTML='<div class="cc-shell"><div class="card"><h2 style="margin:0 0 4px">Manuelt kreditcheck</h2><div class="sub">Skriv et CVR-nummer. Tjekket opretter ikke et lead.</div><form id="ccManualForm" class="cc-form" style="margin-top:16px"><div class="field"><label for="ccCvr">CVR-nummer</label><input id="ccCvr" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="8 cifre" required></div><div class="field"><label for="ccOrderValue">Forventet ordrebeløb (valgfrit)</label><input id="ccOrderValue" inputmode="numeric" type="number" min="0" step="1000" placeholder="Fx 175000"></div><button class="btn primary" id="ccRun" type="submit">Tjek virksomhed</button></form><div class="cc-help">Ordrebeløbet påvirker anbefalingen om depositum og forudbetaling – ikke virksomhedens grundscore.</div></div><div id="ccManualResult" style="margin-top:12px"></div><div class="card" style="margin-top:12px"><h2 style="margin:0 0 10px">Seneste manuelle tjek</h2><div id="ccHistory" class="cc-history"><div class="cc-loading">Henter historik…</div></div></div></div>';
      leadManager.parentNode.insertBefore(section,leadManager);
      section.querySelector('#ccManualForm')?.addEventListener('submit',runManual);
      section.querySelector('#ccCvr')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,8)});
    }
    if(!nav.querySelector('[data-view="creditcheck"]')){
      const button=document.createElement('button');button.type='button';button.dataset.view='creditcheck';button.innerHTML='<span class="lm-nav-icon">◈</span><span>Kreditcheck</span>';
      const before=nav.querySelector('[data-view="leadmanager"]');nav.insertBefore(button,before||null);button.addEventListener('click',()=>activateView(button));
    }
  }
  async function runManual(event){
    event.preventDefault();const cvr=txt(document.getElementById('ccCvr')?.value).replace(/\D/g,''),orderRaw=document.getElementById('ccOrderValue')?.value||'',result=document.getElementById('ccManualResult'),button=document.getElementById('ccRun');
    if(!/^\d{8}$/.test(cvr)){if(result)result.innerHTML='<div class="notice">CVR-nummeret skal bestå af 8 cifre.</div>';return}
    if(button){button.disabled=true;button.textContent='Tjekker…'}if(result)result.innerHTML='<div class="card cc-loading">Henter aktuelle CVR-signaler…</div>';
    const response=await edge({action:'check',client_id:typeof state!=='undefined'?state?.client?.id:null,cvr,check_kind:'manual',order_value:orderRaw===''?null:Number(orderRaw)});
    if(button){button.disabled=false;button.textContent='Tjek virksomhed'}
    if(response.error){if(result)result.innerHTML='<div class="notice"><strong>Tjekket kunne ikke gennemføres.</strong><div style="margin-top:4px">'+esc(response.error)+'</div></div>';return}
    if(result)result.innerHTML=resultHtml(response.data.check,response.data);historyLoaded=false;loadHistory();
  }
  async function loadHistory(){
    if(historyLoaded)return;const box=document.getElementById('ccHistory');if(!box||typeof state==='undefined'||!state?.client?.id)return;
    box.innerHTML='<div class="cc-loading">Henter historik…</div>';const response=await edge({action:'history',client_id:state.client.id});
    if(response.error){box.innerHTML='<div class="sub">Historikken kunne ikke hentes.</div>';return}
    const checks=response.data.checks||[];historyLoaded=true;box.innerHTML=checks.length?checks.map(check=>'<button type="button" class="cc-history-row btn" data-cc-history="'+esc(check.id)+'"><span><span class="cc-mini '+esc(check.risk_level)+'"></span><strong>'+esc(check.company_name||'Virksomhed')+'</strong><span class="sub" style="margin-left:8px">CVR '+esc(check.cvr)+'</span></span><strong>'+esc(check.risk_score)+'/100</strong><small>'+esc(date(check.checked_at))+'</small></button>').join(''):'<div class="sub">Ingen manuelle tjek endnu.</div>';
    box.querySelectorAll('[data-cc-history]').forEach(button=>button.addEventListener('click',()=>{const check=checks.find(x=>x.id===button.dataset.ccHistory),result=document.getElementById('ccManualResult');if(check&&result){result.innerHTML=resultHtml(check);result.scrollIntoView({behavior:'smooth',block:'start'})}}));
  }
  function installLeadBlock(){
    const contact=document.getElementById('contactBlock');if(!contact||document.getElementById('creditCheckBlock'))return;
    const block=document.createElement('div');block.id='creditCheckBlock';block.className='card';block.style.cssText='margin-top:10px;padding:12px';block.innerHTML='<div class="cc-loading">Kreditcheck afventer lead…</div>';contact.insertAdjacentElement('afterend',block);
  }
  function openManual(cvr=''){
    const button=document.querySelector('.nav button[data-view="creditcheck"]');button?.click();setTimeout(()=>{const input=document.getElementById('ccCvr');if(input){input.value=cvr;input.focus()}},40);
  }
  async function checkLead(force=false){
    if(leadBusy)return;let lead=null,client=null,company={};try{lead=currentLead;client=state?.client;company=state?.companies?.find(x=>x.id===lead?.company_id)||{}}catch{}
    const block=document.getElementById('creditCheckBlock');if(!block||!lead?.id||!client?.id)return;const cvr=txt(company.cvr).replace(/\D/g,'');
    if(!/^\d{8}$/.test(cvr)){block.innerHTML='<div class="cc-lead-empty"><strong>Kreditcheck</strong><div class="sub" style="margin-top:4px">Leadet mangler et gyldigt CVR-nummer, så der er ikke lavet en risikovurdering.</div><div class="cc-lead-actions"><button class="btn small" id="ccLeadManual">Åbn manuelt CVR-tjek</button></div></div>';document.getElementById('ccLeadManual')?.addEventListener('click',()=>openManual());return}
    leadBusy=true;block.innerHTML='<div class="cc-loading">Kontrollerer betalingsrisiko for CVR '+esc(cvr)+'…</div>';
    const response=await edge({action:'check',client_id:client.id,cvr,check_kind:'lead',lead_id:lead.id,company_id:company.id,force_refresh:force});leadBusy=false;
    if(response.error){block.innerHTML='<strong>Kreditcheck</strong><div class="notice" style="margin-top:8px">'+esc(response.error)+'</div><div class="cc-lead-actions"><button class="btn small" id="ccLeadRetry">Prøv igen</button><button class="btn small" id="ccLeadManual">Åbn manuelt tjek</button></div>';document.getElementById('ccLeadRetry')?.addEventListener('click',()=>checkLead(true));document.getElementById('ccLeadManual')?.addEventListener('click',()=>openManual(cvr));return}
    block.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px"><strong>Kreditcheck</strong><button class="btn small" id="ccLeadRefresh">Tjek igen</button></div>'+resultHtml(response.data.check,response.data);document.getElementById('ccLeadRefresh')?.addEventListener('click',()=>checkLead(true));
  }
  function watchLead(){
    installView();installLeadBlock();const drawer=document.getElementById('drawer'),open=drawer?.classList.contains('open');let lead=null;try{lead=currentLead}catch{}
    if(!open||!lead?.id){lastLeadId='';return}if(lead.id!==lastLeadId){lastLeadId=lead.id;setTimeout(()=>checkLead(false),150)}
  }
  function init(){installStyles();installView();installLeadBlock();watchLead()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  document.addEventListener('click',()=>setTimeout(watchLead,20),true);
  new MutationObserver(watchLead).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  setInterval(watchLead,800);
})();
