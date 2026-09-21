(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uniq=a=>[...new Set((a||[]).map(x=>String(x||'').trim()).filter(Boolean))];
const split=v=>String(v||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
const INDUSTRIES=['Tømrer','VVS','Elektriker','Maler','Murer','Køl / klima','Ventilation','Entreprenør','Byggeri','Ejendomme / facility','Hotel / restaurant','Produktion','Fødevarer','Pharma / laboratorie','Transport / logistik','Grossist','Detailhandel','IT / software','ERP / økonomisystemer','Rengøring','Vagt / sikkerhed','Rådgivning','Offentlig sektor','Boligforeninger'];
const SIGNALS=['Nyt projekt eller ny lokation','Nybyggeri eller renovering','Virksomhed i vækst','Dokumenteret behov for ydelsen','Aktivt udbud','Ny investering eller anlæg','Nyt ledelses- eller indkøbspersonale','Eksisterende løsning skal udskiftes'];
const EXCLUSIONS=['Private forbrugere','Konkurrenter','Eksisterende kunder','Enkeltmandsvirksomheder','Virksomheder uden offentlig kontaktmulighed'];
const MODES={company_targets:'Virksomheder jeg kan sælge til',documented_need:'Virksomheder med dokumenteret behov',projects:'Konkrete projekter / opgaver',tenders:'Offentlige udbud / opgaver'};
let ctx=null,busy=false,poolBusy=false,bootPromise=null,bootedClient='';
function accessPlan(){
  const access=window.LM_ACCESS||null;
  if(access?.platform_admin===true)return {plan_code:'internal'};
  return access?.plan&&typeof access.plan==='object'?access.plan:null;
}
function hydrateFromAccess(){
  const cid=String(state?.client?.id||''),plan=accessPlan();
  if(!cid||!plan)return null;
  ctx={...(ctx||{}),plan,client:state.client||ctx?.client||{},membership:{...(ctx?.membership||{}),role:window.LM_ACCESS?.role||'',email:state?.session?.user?.email||''}};
  bootedClient=cid;window.__LM_SAAS_PLAN=plan;applyGating();injectSettingsButton();return ctx;
}
async function session(){if(typeof supabase==='undefined')return null;const {data}=await supabase.auth.getSession();return data?.session||null}
async function edge(name,payload={}){const s=await session();if(!s?.access_token)throw new Error('Login-session mangler');const r=await fetch(`${API}/functions/v1/${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify(payload)}),raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
function hide(el,yes=true){if(el)el.classList.toggle('hidden',!!yes)}
function cardByHeading(text){return $$('.card').find(c=>(c.querySelector('h2')?.textContent||'').trim()===text)||null}
function applyGating(){if(!ctx?.plan)return;const p=ctx.plan,internal=p.plan_code==='internal',allow=f=>internal||!!p[f];
  // Internal-only surfaces: never visible to external customers, regardless of package.
  hide($('.nav button[data-view="agents"]'),!internal);hide($('#agents'),!internal);
  hide(cardByHeading('AI-mailassistent'),!internal); // API-key/platform configuration is internal only.
  // Package surfaces.
  hide(cardByHeading('Minuba-forbindelse'),!allow('allow_minuba'));
  $$('.minuba-rel').forEach(x=>hide(x.closest('.customer-section')||x,!allow('allow_minuba')));
  $$('[data-minuba-refresh]').forEach(x=>hide(x,!allow('allow_minuba')));
  $$('.nav button[data-view="offers"],.nav button[data-view="offerpipeline"]').forEach(x=>hide(x,!allow('allow_offers')));
  hide($('#offers'),!allow('allow_offers'));hide($('#offerpipeline'),!allow('allow_offer_pipeline'));
  hide($('.nav button[data-view="activityReport"]'),!allow('allow_activity_report'));hide($('#activityReport'),!allow('allow_activity_report'));
  hide($('.nav button[data-view="approvals"]'),!allow('allow_approvals'));hide($('#approvals'),!allow('allow_approvals'));
  hide($('#gmailHistoryBlock'),!allow('allow_mail_monitor'));
  hide($('#requestInfoMail'),!allow('allow_ai_mail'));hide($('#requestNoContactMail'),!allow('allow_ai_mail'));
  const aiPane=$('#mailModal .mail-ai-pane'),aiRewrite=$('#mailModal .ai-rewrite-bar'),aiState=$('#mAiState');hide(aiPane,!allow('allow_ai_mail'));hide(aiRewrite,!allow('allow_ai_mail'));hide(aiState,!allow('allow_ai_mail'));
  const layout=$('#mailModal .mail-ai-layout');if(layout&&!allow('allow_ai_mail'))layout.style.gridTemplateColumns='1fr';
  $$('#agentCards .card').forEach(card=>{const n=(card.querySelector('strong')?.textContent||'').trim();if(n==='Opportunity & Tender Hunter')hide(card,!allow('allow_tender_search'));if(n==='Mail & Conversation Agent')hide(card,!allow('allow_mail_monitor'));if(['Info-Mail Agent','No-Contact Mail Agent','AI Mail Assistant'].includes(n))hide(card,!allow('allow_ai_mail'))});
}
function canEditLeadSettings(){
  if(window.LM_ACCESS?.platform_admin===true)return true;
  const membershipRole=String(ctx?.membership?.role||'').toLowerCase();
  const accessRole=String(window.LM_ACCESS?.role||'').toLowerCase();
  return ['owner','admin'].includes(membershipRole)||['workspace_owner','workspace_admin'].includes(accessRole);
}
function currentLeadPoolLimit(){
  const raw=Number(ctx?.client?.settings?.new_lead_pool_limit??state?.client?.settings?.new_lead_pool_limit??10);
  return [10,20,30].includes(raw)?raw:10;
}
function ensureLeadPoolStyle(){
  if($('#lmLeadPoolStyle'))return;
  const s=document.createElement('style');s.id='lmLeadPoolStyle';s.textContent=`
    #lmLeadSettingsCard .lm-lead-card-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-end}
    #lmLeadSettingsCard .lm-pool-block{display:grid;gap:5px;min-width:250px}
    #lmLeadSettingsCard .lm-pool-label{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
    #lmLeadSettingsCard .lm-pool-label strong{font-size:12px;color:#334155}
    #lmLeadSettingsCard .lm-pool-label span{font-size:11px;color:#64748b}
    #lmLeadSettingsCard .lm-pool-options{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:4px;background:#eef2f7;border-radius:11px}
    #lmLeadSettingsCard .lm-pool-option{border:0;background:transparent;color:#52606a;font-weight:800;padding:8px 11px;border-radius:8px;cursor:pointer;min-width:52px}
    #lmLeadSettingsCard .lm-pool-option.active{background:#fff;color:#2451d6;box-shadow:0 2px 7px rgba(30,55,90,.10)}
    #lmLeadSettingsCard .lm-pool-option:disabled{opacity:.55;cursor:not-allowed}
    #lmLeadPoolMsg{min-height:16px;font-size:11px;color:#64748b}
    @media(max-width:760px){
      #lmLeadSettingsCard .lm-lead-card-actions{width:100%;justify-content:stretch}
      #lmLeadSettingsCard .lm-pool-block{width:100%;min-width:0}
      #lmLeadSettingsCard .lm-lead-card-actions>.btn{width:100%}
    }
  `;document.head.appendChild(s);
}
function renderLeadPoolButtons(message=''){
  const limit=currentLeadPoolLimit(),editable=canEditLeadSettings();
  $$('[data-lm-pool-limit]').forEach(b=>{
    const value=Number(b.dataset.lmPoolLimit);
    b.classList.toggle('active',value===limit);
    b.setAttribute('aria-pressed',value===limit?'true':'false');
    b.disabled=poolBusy||!editable;
    b.title=editable?'': 'Kun ejer/admin kan ændre lead-puljen';
  });
  const edit=$('#lmEditLeadSettings');if(edit){edit.disabled=!editable;edit.title=editable?'':'Kun ejer/admin kan ændre lead-indstillinger';}
  const msg=$('#lmLeadPoolMsg');if(msg)msg.textContent=message||`Holder op til ${limit} nye standardleads klar.`;
}
async function saveLeadPoolLimit(limit){
  const next=Number(limit),current=currentLeadPoolLimit();
  if(poolBusy||!canEditLeadSettings()||![10,20,30].includes(next)||next===current)return;
  const clientId=ctx?.client?.id||state?.client?.id;if(!clientId)return;
  poolBusy=true;renderLeadPoolButtons('Gemmer…');
  try{
    const {data,error}=await supabase.rpc('crm_set_new_lead_pool_limit',{p_client_id:clientId,p_limit:next});
    if(error)throw error;
    if(ctx?.client){ctx.client.settings={...(ctx.client.settings||{}),new_lead_pool_limit:next};}
    if(state?.client?.id===clientId){state.client.settings={...(state.client.settings||{}),new_lead_pool_limit:next};}
    const refill=next>current;
    renderLeadPoolButtons(refill?`Puljen er sat til ${next}. Lead Manager fylder op automatisk.`:`Puljen er sat til ${next}.`);
    if(typeof toast==='function')toast(`Nye leads i puljen: ${next}`);
    window.dispatchEvent(new CustomEvent('lm:lead-pool-limit-changed',{detail:{client_id:clientId,old_limit:current,new_limit:next,result:data||null}}));
  }catch(e){
    renderLeadPoolButtons(e?.message||String(e));
  }finally{
    poolBusy=false;renderLeadPoolButtons($('#lmLeadPoolMsg')?.textContent||'');
  }
}
function injectSettingsButton(){
  const view=$('#leadmanager');if(!view)return;
  ensureLeadPoolStyle();
  let card=$('#lmLeadSettingsCard');
  if(!card){
    card=document.createElement('div');card.id='lmLeadSettingsCard';card.className='card section';card.style.marginTop='14px';
    card.innerHTML=`<div class="split" style="align-items:center;justify-content:space-between;gap:18px">
      <div style="flex:1 1 360px"><h2 style="margin:0 0 4px">Lead-indstillinger</h2><div class="sub">Ændr hvilke virksomheder, behov og opgaver Lead Hunter skal finde. Vælg også hvor mange nye standardleads Lead Manager skal holde klar.</div></div>
      <div class="lm-lead-card-actions">
        <div class="lm-pool-block">
          <div class="lm-pool-label"><strong>Nye leads i puljen</strong><span>10 / 20 / 30</span></div>
          <div class="lm-pool-options" role="group" aria-label="Antal nye leads i puljen">
            <button class="lm-pool-option" type="button" data-lm-pool-limit="10">10</button>
            <button class="lm-pool-option" type="button" data-lm-pool-limit="20">20</button>
            <button class="lm-pool-option" type="button" data-lm-pool-limit="30">30</button>
          </div>
          <div id="lmLeadPoolMsg"></div>
        </div>
        <button class="btn primary" id="lmEditLeadSettings" type="button">Redigér lead-indstillinger</button>
      </div>
    </div>`;
    view.prepend(card);
  }
  card.querySelectorAll('[data-lm-pool-limit]').forEach(b=>{b.onclick=()=>saveLeadPoolLimit(Number(b.dataset.lmPoolLimit))});
  const edit=$('#lmEditLeadSettings');
  if(edit)edit.onclick=()=>{
    if(!canEditLeadSettings()){if(typeof toast==='function')toast('Kun ejer/admin eller Platform Owner kan ændre lead-indstillinger');return}
    openSettings();
  };
  renderLeadPoolButtons();
}
function style(){if($('#lmCustomerControlsStyle'))return;const s=document.createElement('style');s.id='lmCustomerControlsStyle';s.textContent=`#lmLeadSettingsModal{position:fixed;inset:0;z-index:13000;background:rgba(15,23,42,.52);display:grid;place-items:center;padding:18px}#lmLeadSettingsModal .lmcc{width:min(920px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;border:1px solid #e5e7eb;box-shadow:0 24px 70px rgba(0,0,0,.22)}#lmLeadSettingsModal .lmh,#lmLeadSettingsModal .lmf{padding:18px 22px;border-bottom:1px solid #e5e7eb}#lmLeadSettingsModal .lmb{padding:22px}#lmLeadSettingsModal .lmf{border-top:1px solid #e5e7eb;border-bottom:0;display:flex;justify-content:flex-end;gap:8px}#lmLeadSettingsModal .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}#lmLeadSettingsModal label{display:block;font-size:12px;font-weight:750;color:#52606a;margin:12px 0 5px}#lmLeadSettingsModal input,#lmLeadSettingsModal textarea,#lmLeadSettingsModal select{width:100%;padding:10px;border:1px solid #dce3ea;border-radius:10px}#lmLeadSettingsModal .chips{display:flex;gap:7px;flex-wrap:wrap}#lmLeadSettingsModal .chip{border:1px solid #dce3ea;background:#fff;border-radius:999px;padding:8px 10px;cursor:pointer}#lmLeadSettingsModal .chip.on{border-color:#3157e8;background:#edf3ff;color:#2451d6}#lmLeadSettingsModal .choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}#lmLeadSettingsModal .choice{border:1px solid #dce3ea;border-radius:12px;padding:10px;cursor:pointer}#lmLeadSettingsModal .choice.on{border-color:#3157e8;background:#edf3ff;color:#2451d6}#lmLeadSettingsModal .note{padding:10px 12px;background:#f8fafc;border:1px solid #dce3ea;border-radius:10px;color:#52606a}@media(max-width:700px){#lmLeadSettingsModal .grid,#lmLeadSettingsModal .choices{grid-template-columns:1fr}}`;document.head.appendChild(s)}
function existingDraft(){const c=ctx.client||{},s=c.settings||{},p=s.lead_search_profile||s.capability_profile?.search_strategy||{};return {industries:uniq(p.industries||[]),lead_modes:uniq(p.lead_modes||[]),customer_types:uniq(p.customer_types||s.customer_types||[]),task_types:uniq(p.task_types||[]),employee_min:p.employee_range?.min??'',employee_max:p.employee_range?.max??'',project_value_min:p.project_value_dkk?.min??'',project_value_max:p.project_value_dkk?.max??'',ideal_signals:uniq(p.ideal_signals||[]),geography_mode:p.geography?.mode||'denmark',geography_values:uniq(p.geography?.values||[]),exclusions:uniq(p.exclusions||s.exclude_types||[])}}
function openSettings(){if(busy||!ctx||!canEditLeadSettings())return;$('#lmLeadSettingsModal')?.remove();style();let d=existingDraft();const business=['business','internal'].includes(ctx.plan?.plan_code);document.body.insertAdjacentHTML('beforeend',`<div id="lmLeadSettingsModal"><div class="lmcc"><div class="lmh"><h2 style="margin:0 0 4px">Lead-indstillinger</h2><div class="sub">Disse kriterier er autoritative for Lead Hunter.</div></div><div class="lmb"><label>Brancher</label><div class="chips" id="lmccIndustries">${INDUSTRIES.map(x=>`<button class="chip ${d.industries.includes(x)?'on':''}" type="button" data-i="${esc(x)}">${esc(x)}</button>`).join('')}</div><label>Andre brancher · én pr. linje</label><textarea id="lmccOtherIndustries" rows="3">${esc(d.industries.filter(x=>!INDUSTRIES.includes(x)).join('\n'))}</textarea><label>Leadtyper</label><div class="choices" id="lmccModes">${Object.entries(MODES).map(([k,v])=>`<div class="choice ${d.lead_modes.includes(k)?'on':''}" data-m="${k}" data-disabled="${k==='tenders'&&!business?'1':'0'}" style="${k==='tenders'&&!business?'opacity:.45;cursor:not-allowed':''}"><strong>${esc(v)}</strong>${k==='tenders'&&!business?'<div class="sub">Kræver Business</div>':''}</div>`).join('')}</div><div class="grid"><div><label>Minimum ansatte</label><input id="lmccEmpMin" type="number" min="0" value="${esc(d.employee_min)}"></div><div><label>Maksimum ansatte</label><input id="lmccEmpMax" type="number" min="0" value="${esc(d.employee_max)}"></div></div><label>Virksomhedstyper · én pr. linje</label><textarea id="lmccCustomerTypes" rows="3">${esc(d.customer_types.join('\n'))}</textarea><label>Opgavetyper / behov · én pr. linje</label><textarea id="lmccTasks" rows="3">${esc(d.task_types.join('\n'))}</textarea><div class="grid"><div><label>Minimum opgaveværdi (DKK)</label><input id="lmccProjectMin" type="number" min="0" value="${esc(d.project_value_min)}"></div><div><label>Maksimum opgaveværdi (DKK)</label><input id="lmccProjectMax" type="number" min="0" value="${esc(d.project_value_max)}"></div></div><label>Købssignaler</label><div class="chips" id="lmccSignals">${SIGNALS.map(x=>`<button class="chip ${d.ideal_signals.includes(x)?'on':''}" type="button" data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div><label>Geografi</label><select id="lmccGeoMode"><option value="denmark" ${d.geography_mode==='denmark'?'selected':''}>Hele Danmark</option><option value="selected" ${d.geography_mode==='selected'?'selected':''}>Udvalgte områder</option></select><div id="lmccGeoWrap" style="${d.geography_mode==='selected'?'':'display:none'}"><label>Områder · én pr. linje</label><textarea id="lmccGeo" rows="3">${esc(d.geography_values.join('\n'))}</textarea></div><label>Fravalg</label><div class="chips" id="lmccExclusions">${EXCLUSIONS.map(x=>`<button class="chip ${d.exclusions.includes(x)?'on':''}" type="button" data-e="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="note" id="lmccMsg" style="margin-top:14px">Gemmer du ændringer, bliver kundens Lead Hunter-profil opdateret. Eksisterende leads slettes ikke.</div></div><div class="lmf"><button class="btn" id="lmccCancel" type="button">Annullér</button><button class="btn primary" id="lmccSave" type="button">Gem lead-indstillinger</button></div></div></div>`);
  const toggle=(sel,attr,key)=>$$(sel).forEach(b=>b.onclick=()=>{const v=b.getAttribute(attr);if(!v)return;b.classList.toggle('on');const on=b.classList.contains('on');d[key]=on?uniq([...(d[key]||[]),v]):(d[key]||[]).filter(x=>x!==v)});toggle('#lmccIndustries .chip','data-i','industries');toggle('#lmccSignals .chip','data-s','ideal_signals');toggle('#lmccExclusions .chip','data-e','exclusions');$$('#lmccModes .choice').forEach(b=>b.onclick=()=>{if(b.dataset.disabled==='1')return;const v=b.dataset.m;b.classList.toggle('on');d.lead_modes=b.classList.contains('on')?uniq([...d.lead_modes,v]):d.lead_modes.filter(x=>x!==v)});$('#lmccGeoMode').onchange=e=>{$('#lmccGeoWrap').style.display=e.target.value==='selected'?'':'none'};$('#lmccCancel').onclick=()=>$('#lmLeadSettingsModal')?.remove();$('#lmccSave').onclick=()=>saveSettings(d)}
async function saveSettings(d){
  if(busy||!canEditLeadSettings())return;
  busy=true;
  const msg=$('#lmccMsg'),btn=$('#lmccSave');
  if(btn)btn.disabled=true;
  if(msg)msg.textContent='Gemmer…';
  try{
    const clientId=ctx?.client?.id||state?.client?.id;
    if(!clientId)throw new Error('Workspace mangler.');
    const industries=uniq([...d.industries,...split($('#lmccOtherIndustries').value)]);
    const leadModes=uniq(d.lead_modes||[]);
    if(!industries.length)throw new Error('Vælg mindst én branche.');
    if(!leadModes.length)throw new Error('Vælg mindst én leadtype.');
    const geoMode=$('#lmccGeoMode').value;
    const geoValues=geoMode==='selected'?uniq(split($('#lmccGeo').value)):[];
    if(geoMode==='selected'&&!geoValues.length)throw new Error('Angiv mindst ét geografisk område.');
    const toNumber=value=>{const raw=String(value??'').trim();if(!raw)return null;const n=Number(raw);return Number.isFinite(n)?n:null};
    const employeeMin=toNumber($('#lmccEmpMin').value),employeeMax=toNumber($('#lmccEmpMax').value);
    const projectMin=toNumber($('#lmccProjectMin').value),projectMax=toNumber($('#lmccProjectMax').value);
    if(employeeMin!=null&&employeeMax!=null&&employeeMin>employeeMax)throw new Error('Minimum ansatte kan ikke være større end maksimum.');
    if(projectMin!=null&&projectMax!=null&&projectMin>projectMax)throw new Error('Minimum opgaveværdi kan ikke være større end maksimum.');
    const profile={
      industries,
      lead_modes:leadModes,
      customer_types:uniq(split($('#lmccCustomerTypes').value)),
      task_types:uniq(split($('#lmccTasks').value)),
      employee_range:{min:employeeMin,max:employeeMax},
      project_value_dkk:{min:projectMin,max:projectMax},
      ideal_signals:uniq(d.ideal_signals||[]),
      geography:{mode:geoMode,values:geoValues,text:geoMode==='denmark'?'Danmark':geoValues.join(', ')},
      exclusions:uniq(d.exclusions||[])
    };
    const {data,error}=await supabase.rpc('crm_update_lead_search_profile',{p_client_id:clientId,p_profile:profile});
    if(error)throw error;
    const settings=data?.settings||null;
    if(settings){
      if(ctx?.client?.id===clientId)ctx.client.settings=settings;
      if(state?.client?.id===clientId)state.client.settings=settings;
    }
    if(msg)msg.textContent='✓ Lead-indstillinger gemt. Næste Lead Hunter-søgning bruger de nye kriterier.';
    if(typeof toast==='function')toast('Lead-indstillinger gemt');
    setTimeout(()=>$('#lmLeadSettingsModal')?.remove(),700);
  }catch(e){
    if(msg)msg.textContent=e?.message||String(e);
    if(btn)btn.disabled=false;
  }finally{
    busy=false;
  }
}
async function boot(force=false){
  const cid=String(state?.client?.id||'');if(!cid)return null;
  if(!force){
    if(ctx&&bootedClient===cid){applyGating();injectSettingsButton();return ctx}
    const local=hydrateFromAccess();if(local)return local
  }
  if(bootPromise)return bootPromise;
  bootPromise=(async()=>{try{const s=await session();if(!s)return null;ctx=await edge('saas-onboarding',{action:'status'});bootedClient=cid;window.__LM_SAAS_PLAN=ctx.plan||null;applyGating();injectSettingsButton();return ctx}catch(e){console.warn('customer controls',e);return null}})();
  try{return await bootPromise}finally{bootPromise=null}
}
// Event-driven only: no MutationObserver and no polling.
document.addEventListener('click',e=>{const b=e.target.closest?.('.nav button');if(b)setTimeout(()=>{applyGating();injectSettingsButton()},0)},true);
window.addEventListener('lm:workspace-ready',()=>setTimeout(()=>boot(false),0));
window.addEventListener('lm:client-data-ready',()=>setTimeout(()=>boot(false),0));
window.addEventListener('lm:client-switched',()=>{ctx=null;bootedClient='';setTimeout(()=>boot(false),0)});
if(!window.LMAccess){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>boot(false),0),{once:true});else setTimeout(()=>boot(false),0)}
})();
