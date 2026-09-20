(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const STORAGE='lm_admin_active_client_v1';let rows=[],loaded=false,switchSeq=0;
const ready=()=>typeof state!=='undefined'&&state?.session&&typeof supabase!=='undefined'&&typeof supabase.rpc==='function';
const accessReady=()=>typeof window.LM_ACCESS!=='undefined';
const isPlatformAdmin=()=>window.LM_ACCESS?.platform_admin===true;
const DATA_KEYS=['companies','contacts','leads','activities','mail','opps','offers','approvals','runs','tasks','requests','intelligence','integrations'];
const SNAPSHOT_KEYS=['companies','leads','activities','offers','approvals','tasks'];
function style(){if($('lmAdminSwitchStyle'))return;const s=document.createElement('style');s.id='lmAdminSwitchStyle';s.textContent=`#lmAdminClientSwitch{margin:12px 10px 4px;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(255,255,255,.06)}#lmAdminClientSwitch label{display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.72;margin-bottom:5px}#lmAdminClientSwitch select{width:100%;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:8px 9px;background:rgba(7,22,32,.88)!important;color:#e7f1f5!important;font:inherit;color-scheme:dark;transition:opacity .12s ease,border-color .12s ease}#lmAdminClientSwitch select option{background:#0a1b26;color:#e8f2f6}#lmAdminClientSwitch.is-switching select{cursor:progress;opacity:.72}body.lm-workspace-switching .main{pointer-events:none;opacity:.72;transition:opacity .12s ease}body.lm-workspace-switching .side .nav{pointer-events:none}#lmAdminClientSwitch .lmac-static{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:9px 10px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;line-height:1.25;overflow-wrap:anywhere}#lmAdminClientSwitch .lmac-meta{font-size:11px;line-height:1.35;opacity:.72;margin-top:6px}#lmAdminClientSwitch .lmac-pill{display:inline-block;margin-top:6px;padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.12);font-size:10px;font-weight:800}`;document.head.appendChild(s)}
function ensure(){style();let box=$('lmAdminClientSwitch');const nav=document.querySelector('.side .nav');if(!nav)return null;if(!box){box=document.createElement('div');box.id='lmAdminClientSwitch';nav.parentNode.insertBefore(box,nav)}box.innerHTML='<label for="lmAdminClientSelect">Kundeprofil</label><select id="lmAdminClientSelect" aria-label="Vælg kundeprofil"></select><div class="lmac-meta" id="lmAdminClientMeta"></div>';const sel=$('lmAdminClientSelect');sel.addEventListener('change',e=>switchClient(e.target.value));return sel}
function renderStaticCustomer(){style();let box=$('lmAdminClientSwitch');const nav=document.querySelector('.side .nav');if(!nav)return;if(!box){box=document.createElement('div');box.id='lmAdminClientSwitch';nav.parentNode.insertBefore(box,nav)}const name=state?.client?.name||window.LM_ACCESS?.workspace_name||'Kundeworkspace';box.innerHTML='<label>Kundeprofil</label><div class="lmac-static" id="lmCustomerWorkspaceName">'+esc(name)+'</div>'}
function currentRow(){return rows.find(x=>String(x.client_id)===String(state?.client?.id))||null}
function render(){let sel=$('lmAdminClientSelect');if(!sel)sel=ensure();if(!sel)return;sel.innerHTML='';for(const r of rows){const o=document.createElement('option');o.value=String(r.client_id);o.textContent=r.is_home?`${r.client_name} · Min profil`:r.client_name;sel.appendChild(o)}if(state?.client?.id&&rows.some(r=>String(r.client_id)===String(state.client.id)))sel.value=String(state.client.id);const r=currentRow(),meta=$('lmAdminClientMeta');if(meta)meta.innerHTML=!r?'':r.is_home?'Din interne Lead Manager profil.<br><span class="lmac-pill">Admin</span>':`Kundeprofil<br><span class="lmac-pill">${r.marketing_active===false?'Marketing pause':'Marketing aktiv'}</span>`}
function resetWorkspaceUi(renderAfter=true){
  for(const id of ['leadSearch','offerSearch','mailSearch']){const el=$(id);if(el)el.value=''}
  for(const id of ['statusFilter','offerStatusFilter']){const el=$(id);if(el)el.value=''}
  for(const key of DATA_KEYS){try{if(Array.isArray(state?.[key]))state[key]=[]}catch{}}
  try{if(typeof currentLead!=='undefined')currentLead=null}catch{}
  try{if(typeof currentOffer!=='undefined')currentOffer=null}catch{}
  for(const id of ['drawer','offerModal','mailModal'])try{$(id)?.classList.remove('open')}catch{}
  if(renderAfter)try{window.__LM_PERF?.renderCurrent?.()}catch(e){console.warn('workspace reset render failed',e)}
}
function captureWorkspace(){
  const data={};
  for(const key of DATA_KEYS)data[key]=Array.isArray(state?.[key])?[...state[key]]:[];
  return {
    client:state?.client?{...state.client}:null,
    data,
    mailCount:window.__LM_MAIL_COUNT,
    baseClientId:window.__LM_BASE_CLIENT_ID,
    baseLoadedKeys:Array.isArray(window.__LM_BASE_LOADED_KEYS)?[...window.__LM_BASE_LOADED_KEYS]:[],
    baseStartupReady:window.__LM_BASE_STARTUP_READY===true
  };
}
function restoreWorkspace(snapshot){
  if(!snapshot?.client)return;
  state.client=snapshot.client;
  for(const key of DATA_KEYS)state[key]=Array.isArray(snapshot.data?.[key])?[...snapshot.data[key]]:[];
  window.__LM_MAIL_COUNT=snapshot.mailCount;
  window.__LM_BASE_CLIENT_ID=snapshot.baseClientId;
  window.__LM_BASE_LOADED_KEYS=snapshot.baseLoadedKeys;
  window.__LM_BASE_STARTUP_READY=snapshot.baseStartupReady;
}
function assertVisibleData(){try{const view=activeView(),leadCount=Array.isArray(state?.leads)?state.leads.length:0,offerCount=Array.isArray(state?.offers)?state.offers.length:0;if(view==='leads'){const leadRows=$('leadRows');if(leadCount&&leadRows&&!leadRows.querySelector('[data-open-lead]')){const s=$('leadSearch'),f=$('statusFilter');if(s)s.value='';if(f)f.value='';if(typeof renderRows==='function')renderRows()}const visibleLeads=leadRows?.querySelectorAll('[data-open-lead]').length||0;if(leadCount&&!visibleLeads)console.error('DATA CONSISTENCY: lead data exists but lead view is empty',{client_id:state?.client?.id,leadCount,visibleLeads})}if(view==='offers'){const offerRows=$('offerRows');if(offerCount&&offerRows&&!offerRows.querySelector('[data-open-offer]')){const s=$('offerSearch'),f=$('offerStatusFilter');if(s)s.value='';if(f)f.value='';if(typeof renderOffers==='function')renderOffers()}const visibleOffers=offerRows?.querySelectorAll('[data-open-offer]').length||0;if(offerCount&&!visibleOffers)console.error('DATA CONSISTENCY: offer data exists but offer view is empty',{client_id:state?.client?.id,offerCount,visibleOffers})}}catch(e){console.warn('workspace data consistency check failed',e)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nextPaint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
function activeView(){return document.querySelector('.nav button[data-view].active')?.dataset?.view||document.querySelector('.view.active')?.id||'dashboard'}
function setSwitching(on,label=''){document.body.classList.toggle('lm-workspace-switching',!!on);const box=$('lmAdminClientSwitch'),sel=$('lmAdminClientSelect'),meta=$('lmAdminClientMeta');box?.classList.toggle('is-switching',!!on);if(sel)sel.disabled=!!on;if(on&&meta)meta.textContent='Skifter til '+(label||'kundeprofil')+'…'}
async function fetchWorkspaceSnapshot(id){
  const [clientRes,snapshotRes]=await Promise.all([
    supabase.from('crm_clients').select('*').eq('id',id).limit(1),
    supabase.rpc('crm_startup_snapshot',{p_client_id:id})
  ]);
  if(clientRes?.error)throw clientRes.error;
  if(!Array.isArray(clientRes?.data)||!clientRes.data[0])throw new Error('Kundeprofil kunne ikke hentes');
  if(snapshotRes?.error)throw snapshotRes.error;
  return {client:clientRes.data[0],snapshot:snapshotRes?.data||{}};
}
async function fullLoadForClient(id){
  let last;
  const waits=[0,180,450];
  for(let attempt=0;attempt<waits.length;attempt++){
    if(waits[attempt])await sleep(waits[attempt]);
    try{
      const loaded=await fetchWorkspaceSnapshot(id);
      if(String(loaded.client?.id)!==String(id))throw new Error('Forkert kundeprofil returneret');
      return loaded;
    }catch(e){
      last=e;
      console.warn('customer switch snapshot attempt failed',attempt+1,e);
    }
  }
  throw last||new Error('Kunne ikke hente kundedata');
}
function applyWorkspaceSnapshot(id,loaded){
  resetWorkspaceUi(false);
  state.client=loaded.client;
  const snapshot=loaded.snapshot||{};
  for(const key of SNAPSHOT_KEYS)state[key]=Array.isArray(snapshot[key])?snapshot[key]:[];
  state.mail=[];
  window.__LM_MAIL_COUNT=Number(snapshot.mail_count)||0;
  window.__LM_BASE_CLIENT_ID=id;
  window.__LM_BASE_LOADED_KEYS=[...SNAPSHOT_KEYS,'mail'];
  window.__LM_BASE_STARTUP_READY=true;
  if(typeof setText==='function')setText('syncState','● Live CRM · '+new Date().toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}));
}
async function switchClient(id){
  id=String(id||'');
  if(!id||id===String(state?.client?.id)){render();return}
  const row=rows.find(r=>String(r.client_id)===id);
  if(!row)return;
  const seq=++switchSeq,previous=captureWorkspace(),started=performance.now();
  let committed=false;
  setSwitching(true,row.client_name||'kundeprofil');
  try{
    await nextPaint();
    window.dispatchEvent(new CustomEvent('lm:client-switching',{detail:{client_id:id}}));
    const loaded=await fullLoadForClient(id);
    if(seq!==switchSeq)return;

    applyWorkspaceSnapshot(id,loaded);
    committed=true;
    localStorage.setItem(STORAGE,id);
    if($('brandClient'))$('brandClient').textContent=state.client.name+(row.is_home?' · Admin':'');
    window.dispatchEvent(new CustomEvent('lm:tenant-reset',{detail:{client_id:id}}));
    window.dispatchEvent(new CustomEvent('lm:client-switched',{detail:{client_id:id}}));
    try{window.__LM_TENANT_GUARD?.assert?.()}catch{}
    render();
    assertVisibleData();

    const duration=Math.round(performance.now()-started);
    window.__LM_WORKSPACE_SWITCH_STATS={client_id:id,duration_ms:duration,finished_at:new Date().toISOString(),mode:'atomic_snapshot'};
    window.dispatchEvent(new CustomEvent('lm:data-refreshed',{detail:{keys:[...SNAPSHOT_KEYS,'mail'],mode:'workspace_snapshot',duration_ms:duration,client_id:id}}));
    window.dispatchEvent(new CustomEvent('lm:client-data-ready',{detail:{client_id:id,leads:state?.leads?.length||0,offers:state?.offers?.length||0,duration_ms:duration}}));

    if(window.__LM_PERF?.refreshWorkspace){
      Promise.resolve().then(()=>window.__LM_PERF.refreshWorkspace()).catch(error=>console.warn('workspace background refresh failed',error));
    }
    if(typeof toast==='function')toast(`Kundeprofil: ${state.client.name}`);
  }catch(e){
    console.error('customer switch failed',e);
    if(seq===switchSeq){
      if(committed)restoreWorkspace(previous);
      localStorage.setItem(STORAGE,String(previous.client?.id||''));
      if($('brandClient')&&previous.client){const previousRow=rows.find(r=>String(r.client_id)===String(previous.client.id));$('brandClient').textContent=previous.client.name+(previousRow?.is_home?' · Admin':'');}
      render();
      if(typeof toast==='function')toast('Kunne ikke skifte kundeprofil. Prøv igen.');
    }
  }finally{
    if(seq===switchSeq)setSwitching(false);
  }
}
async function load(force=false){if((loaded&&!force)||!ready())return;if(!accessReady()){setTimeout(()=>load(force),120);return}if(!isPlatformAdmin()){loaded=true;renderStaticCustomer();return}loaded=true;try{const r=await supabase.rpc('crm_admin_list_managed_clients',{});if(r.error)throw r.error;if(!Array.isArray(r.data)||!r.data.length)throw new Error('Ingen kundeprofiler returneret');rows=r.data;ensure();render()}catch(e){loaded=false;console.error('admin client list failed',e);ensure();const meta=$('lmAdminClientMeta');if(meta)meta.textContent='Kunne ikke hente kundelisten.'}}
function init(){if(!ready()||!accessReady()){setTimeout(init,120);return}load(true);if(!isPlatformAdmin())window.addEventListener('lm:data-refreshed',renderStaticCustomer);else window.addEventListener('lm:data-refreshed',assertVisibleData)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();window.addEventListener('lm:admin-clients-refresh',()=>load(true));window.__LM_ADMIN_CLIENT_SWITCHER_TEST={resetWorkspaceUi,assertVisibleData,fetchWorkspaceSnapshot,fullLoadForClient,applyWorkspaceSnapshot,switchClient};
})();
