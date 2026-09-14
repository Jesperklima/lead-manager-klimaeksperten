(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));
const STORAGE='lm_admin_active_client_v1';
const CACHE_PREFIX='lm_admin_client_cache_v3:';
const CACHE_TTL=5*60*1000;
let rows=[],busy=false,loaded=false;
const prewarmInFlight=new Map();
const ready=()=>typeof state!=='undefined'&&state?.session&&typeof supabase!=='undefined'&&typeof supabase.rpc==='function';
const stateKeys=['companies','contacts','leads','activities','mail','opps','offers','approvals','runs','tasks','requests','intelligence','integrations'];

function style(){if($('lmAdminSwitchStyle'))return;const s=document.createElement('style');s.id='lmAdminSwitchStyle';s.textContent=`#lmAdminClientSwitch{margin:12px 10px 4px;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(255,255,255,.06)}#lmAdminClientSwitch label{display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.72;margin-bottom:5px}#lmAdminClientSwitch select{width:100%;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:8px 9px;background:#fff;color:#17212b;font:inherit}#lmAdminClientSwitch .lmac-meta{font-size:11px;line-height:1.35;opacity:.72;margin-top:6px}#lmAdminClientSwitch .lmac-pill{display:inline-block;margin-top:6px;padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.12);font-size:10px;font-weight:800}`;document.head.appendChild(s)}
function ensure(){if($('lmAdminClientSwitch'))return;const nav=document.querySelector('.side .nav');if(!nav)return;style();const box=document.createElement('div');box.id='lmAdminClientSwitch';box.innerHTML='<label for="lmAdminClientSelect">Kundeprofil</label><select id="lmAdminClientSelect" aria-label="Vælg kundeprofil"></select><div class="lmac-meta" id="lmAdminClientMeta"></div>';nav.parentNode.insertBefore(box,nav);const sel=$('lmAdminClientSelect');sel.onchange=e=>switchClient(e.target.value);sel.addEventListener('pointerdown',()=>setTimeout(prewarmProfiles,0),{passive:true});sel.addEventListener('focus',()=>setTimeout(prewarmProfiles,0),{passive:true})}
function currentRow(){return rows.find(x=>x.client_id===state?.client?.id)||null}
function label(r){return r.is_home?`${r.client_name} · Min profil`:r.client_name}
function render(){ensure();const sel=$('lmAdminClientSelect');if(!sel)return;sel.innerHTML=rows.map(r=>`<option value="${esc(r.client_id)}">${esc(label(r))}</option>`).join('');if(state?.client?.id)sel.value=state.client.id;const r=currentRow(),meta=$('lmAdminClientMeta');if(!meta)return;if(!r){meta.innerHTML='';return}if(r.is_home){meta.innerHTML='Din interne Lead Manager profil.<br><span class="lmac-pill">Admin</span>';return}meta.innerHTML=`Kundeprofil<br><span class="lmac-pill">${r.marketing_active===false?'Marketing pause':'Marketing aktiv'}</span>`}
function clearTenantState(){for(const k of stateKeys)if(Array.isArray(state?.[k]))state[k]=[];try{currentLead=null}catch{}try{currentOffer=null}catch{}}
function managedUi(r){const managed=!!r&&!r.is_home;document.body.dataset.lmManagedProfile=managed?'1':'0';['saasInviteCard','lmLeadSettingsCard'].forEach(id=>{const el=$(id);if(el)el.style.display=managed?'none':''})}
function cacheCurrent(){const id=state?.client?.id;if(!id)return;try{const payload={ts:Date.now(),client:state.client};for(const k of stateKeys)if(Array.isArray(state?.[k]))payload[k]=state[k];sessionStorage.setItem(CACHE_PREFIX+id,JSON.stringify(payload))}catch{}}
function restoreCached(id){try{const raw=sessionStorage.getItem(CACHE_PREFIX+id);if(!raw)return false;const c=JSON.parse(raw);if(!c?.client||Date.now()-c.ts>CACHE_TTL){sessionStorage.removeItem(CACHE_PREFIX+id);return false}clearTenantState();state.client=c.client;for(const k of stateKeys)if(Array.isArray(c[k]))state[k]=c[k];return true}catch{return false}}
function activate(row){localStorage.setItem(STORAGE,state.client.id);if($('brandClient'))$('brandClient').textContent=state.client.name+(row.is_home?' · Admin':'');managedUi(row);render();window.dispatchEvent(new CustomEvent('lm:client-switching',{detail:{client_id:state.client.id,client:state.client,managed:!row.is_home,source:row.source||null}}))}
function renderCurrentSurface(){try{if(window.__LM_PERF?.renderCurrent)window.__LM_PERF.renderCurrent();else if(typeof render==='function')render()}catch(e){console.warn('profile render',e)}const active=document.querySelector('.nav button[data-view="marketingLeads"].active,.nav button[data-view="marketingConnections"].active');if(active&&typeof active.click==='function')active.click()}

async function fetchSnapshot(id){
  const results=await Promise.all([
    supabase.from('crm_clients').select('*').eq('id',id).single(),
    supabase.from('crm_companies').select('*').eq('client_id',id).order('name'),
    supabase.from('crm_contacts').select('*').eq('client_id',id),
    supabase.from('crm_leads').select('*').eq('client_id',id).order('updated_at',{ascending:false}),
    supabase.from('crm_activities').select('*').eq('client_id',id).order('created_at',{ascending:false}).limit(500),
    supabase.from('crm_mail_messages').select('*').eq('client_id',id).order('message_at',{ascending:false}).limit(300),
    supabase.from('crm_opportunities').select('*').eq('client_id',id).order('updated_at',{ascending:false}),
    supabase.from('crm_offers').select('*').eq('client_id',id).order('follow_up_date',{ascending:true}),
    supabase.from('crm_approvals').select('*').eq('client_id',id).order('created_at',{ascending:false}),
    supabase.from('crm_agent_runs').select('*').eq('client_id',id).order('started_at',{ascending:false}).limit(100),
    supabase.from('crm_tasks').select('*').eq('client_id',id).order('scheduled_at',{ascending:true}),
    supabase.from('crm_agent_requests').select('*').eq('client_id',id).order('created_at',{ascending:false}).limit(100),
    supabase.from('crm_sales_intelligence').select('*').eq('client_id',id).order('created_at',{ascending:false}).limit(500),
    supabase.from('crm_integrations').select('*').eq('client_id',id)
  ]);
  const first=results[0];if(first.error||!first.data)throw new Error(first.error?.message||'Kundeprofil kunne ikke hentes');
  const keys=stateKeys;const payload={ts:Date.now(),client:first.data};
  keys.forEach((k,i)=>{const r=results[i+1];if(r?.error)console.warn('preload '+k,r.error);payload[k]=r?.error?[]:(r?.data||[])});
  return payload;
}
function saveSnapshot(id,payload){try{sessionStorage.setItem(CACHE_PREFIX+id,JSON.stringify(payload))}catch{}}
function getSnapshot(id){
  if(prewarmInFlight.has(id))return prewarmInFlight.get(id);
  const p=fetchSnapshot(id).then(payload=>{saveSnapshot(id,payload);return payload}).finally(()=>prewarmInFlight.delete(id));
  prewarmInFlight.set(id,p);return p;
}
async function refreshSnapshot(id){
  try{
    const payload=await getSnapshot(id);if(state?.client?.id!==id)return;
    state.client=payload.client;for(const k of stateKeys)state[k]=Array.isArray(payload[k])?payload[k]:[];
    const row=rows.find(x=>x.client_id===id);if(row)activate(row);renderCurrentSurface();
    window.dispatchEvent(new CustomEvent('lm:client-data-ready',{detail:{client_id:id}}));
  }catch(e){console.warn('background client refresh',e);if(state?.client?.id===id&&typeof toast==='function')toast('Kundeprofilen kunne ikke opdateres')}
}

async function switchClient(id,{silent=false}={}){
  if(busy||!id||id===state?.client?.id){render();return}
  const row=rows.find(x=>x.client_id===id);if(!row)return;
  busy=true;const sel=$('lmAdminClientSelect');if(sel)sel.disabled=true;
  try{
    cacheCurrent();
    const hadCache=restoreCached(id);
    if(!hadCache){clearTenantState();state.client={id,name:row.client_name||'Kunde'};}
    activate(row);renderCurrentSurface();
    window.dispatchEvent(new CustomEvent('lm:client-switched',{detail:{client_id:id,client:state.client,managed:!row.is_home,source:row.source||null,workspace_id:row.workspace_id||null,cached:hadCache}}));
    if(!silent&&typeof toast==='function')toast(`Kundeprofil: ${state.client.name}`);
    refreshSnapshot(id);
  }catch(e){if(typeof toast==='function')toast(e.message||String(e));localStorage.removeItem(STORAGE)}
  finally{busy=false;if(sel)sel.disabled=false;render()}
}
async function prewarmProfiles(){
  for(const row of rows){
    if(row.client_id===state?.client?.id)continue;
    try{
      const raw=sessionStorage.getItem(CACHE_PREFIX+row.client_id);if(raw){const c=JSON.parse(raw);if(c?.client&&Date.now()-c.ts<CACHE_TTL)continue}
      await getSnapshot(row.client_id);
    }catch(e){console.warn('client prewarm',row.client_id,e)}
  }
}
async function load(){if(loaded||!ready())return;loaded=true;try{const r=await supabase.rpc('crm_admin_list_managed_clients',{});if(r.error||!Array.isArray(r.data)||!r.data.length)return;rows=r.data;ensure();render();setTimeout(prewarmProfiles,50);const wanted=localStorage.getItem(STORAGE);if(wanted&&wanted!==state?.client?.id&&rows.some(x=>x.client_id===wanted))await switchClient(wanted,{silent:true});else managedUi(currentRow())}catch(e){console.warn('admin client switcher',e)} }
function init(){if(!ready()){setTimeout(init,250);return}load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('lm:admin-clients-refresh',()=>{loaded=false;load()});
})();
