(()=>{
'use strict';
if(window.__LM_PERFORMANCE_V1)return;
window.__LM_PERFORMANCE_V1=true;

const tableToKey={
  crm_companies:'companies',crm_contacts:'contacts',crm_leads:'leads',crm_activities:'activities',
  crm_mail_messages:'mail',crm_opportunities:'opps',crm_offers:'offers',crm_approvals:'approvals',
  crm_agent_runs:'runs',crm_tasks:'tasks',crm_agent_requests:'requests',crm_sales_intelligence:'intelligence',
  crm_integrations:'integrations'
};
const keyToTable=Object.fromEntries(Object.entries(tableToKey).map(([table,key])=>[key,table]));
const dirtyTables=new Set();
const viewRefreshKeys={
  dashboard:['companies','contacts','leads','activities','offers','tasks'],
  leads:['companies','contacts','leads'],
  pipeline:['companies','contacts','leads'],
  offers:['companies','offers'],
  offerpipeline:['companies','offers'],
  calendar:['leads','offers','tasks'],
  mail:['mail'],
  activity:['activities'],
  approvals:['approvals'],
  leadmanager:['integrations'],
  agents:['runs','requests'],
  marketingLeads:['companies','contacts','leads'],
  marketingConnections:['integrations']
};
let fullLoaded=false;
let refreshInFlight=null;
let pendingRefresh=false;
let pendingFull=false;
let lastRefreshAt=0;

function queryFor(key,cid){
  switch(key){
    case 'companies': return supabase.from('crm_companies').select('*').eq('client_id',cid).order('name');
    case 'contacts': return supabase.from('crm_contacts').select('*').eq('client_id',cid);
    case 'leads': return supabase.from('crm_leads').select('*').eq('client_id',cid).order('updated_at',{ascending:false});
    case 'activities': return supabase.from('crm_activities').select('*').eq('client_id',cid).order('created_at',{ascending:false}).limit(500);
    case 'mail': return supabase.from('crm_mail_messages').select('*').eq('client_id',cid).order('message_at',{ascending:false}).limit(300);
    case 'opps': return supabase.from('crm_opportunities').select('*').eq('client_id',cid).order('updated_at',{ascending:false});
    case 'offers': return supabase.from('crm_offers').select('*').eq('client_id',cid).order('follow_up_date',{ascending:true});
    case 'approvals': return supabase.from('crm_approvals').select('*').eq('client_id',cid).order('created_at',{ascending:false});
    case 'runs': return supabase.from('crm_agent_runs').select('*').eq('client_id',cid).order('started_at',{ascending:false}).limit(100);
    case 'tasks': return supabase.from('crm_tasks').select('*').eq('client_id',cid).order('scheduled_at',{ascending:true});
    case 'requests': return supabase.from('crm_agent_requests').select('*').eq('client_id',cid).order('created_at',{ascending:false}).limit(100);
    case 'intelligence': return supabase.from('crm_sales_intelligence').select('*').eq('client_id',cid).order('created_at',{ascending:false}).limit(500);
    case 'integrations': return supabase.from('crm_integrations').select('*').eq('client_id',cid);
    default: return null;
  }
}

function activeView(){return document.querySelector('.nav button[data-view].active')?.dataset?.view||'dashboard'}
function keysForActiveView(){return [...(viewRefreshKeys[activeView()]||['companies','leads','offers','tasks'])]}
function safeCall(name){try{if(typeof window[name]==='function')window[name]()}catch(e){console.warn('perf render '+name,e)}}
function renderView(view=activeView()){
  switch(view){
    case 'dashboard': safeCall('renderMetrics');safeCall('renderTasks');safeCall('renderDashCards');safeCall('renderExecutiveDashboard');break;
    case 'leads': safeCall('renderRows');break;
    case 'pipeline': safeCall('renderKanban');break;
    case 'offers': safeCall('renderOffers');break;
    case 'offerpipeline': safeCall('renderOfferPipeline');break;
    case 'calendar': safeCall('renderCalendar');break;
    case 'mail': safeCall('renderMail');break;
    case 'activity': safeCall('renderActivity');break;
    case 'approvals': safeCall('renderApprovals');break;
    case 'leadmanager': safeCall('renderLeadManager');safeCall('renderIntegrations');break;
    case 'agents': safeCall('renderAgents');break;
    default: break;
  }
}
function refreshOpenSurface(changedKeys){
  const changed=new Set(changedKeys||[]);
  try{
    if(document.getElementById('drawer')?.classList.contains('open')&&typeof currentLead!=='undefined'&&currentLead?.id&&['companies','contacts','leads','activities','mail','intelligence','tasks'].some(k=>changed.has(k))){
      const id=currentLead.id;currentLead=(state.leads||[]).find(x=>x.id===id)||currentLead;if(typeof openLead==='function')openLead(id);
    }
  }catch(e){console.warn('perf lead surface',e)}
  try{
    if(document.getElementById('offerModal')?.classList.contains('open')&&typeof currentOffer!=='undefined'&&currentOffer?.id&&changed.has('offers')){
      const id=currentOffer.id;currentOffer=(state.offers||[]).find(x=>x.id===id)||currentOffer;if(typeof openOffer==='function')openOffer(id);
    }
  }catch(e){console.warn('perf offer surface',e)}
}
function updateSyncLabel(queryCount,ms){
  const el=document.getElementById('syncState');if(el)el.textContent='● Live CRM · '+new Date().toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'});
  window.__LM_PERF_STATS={last_refresh_at:new Date().toISOString(),queries:queryCount,duration_ms:Math.round(ms),dirty_tables:[...dirtyTables]};
}
function installWriteTracker(){
  if(typeof supabase==='undefined'||typeof supabase.from!=='function'||supabase.from.__lmPerfWrapped)return;
  const originalFrom=supabase.from.bind(supabase);
  const wrapped=function(table){
    const q=originalFrom(table);if(!q||typeof q.execute!=='function')return q;const execute=q.execute.bind(q);
    q.execute=async function(){const write=q.method==='POST'||q.method==='PATCH'||q.method==='DELETE';const result=await execute();if(write&&!result?.error&&tableToKey[table])dirtyTables.add(table);return result};
    return q;
  };
  wrapped.__lmPerfWrapped=true;supabase.from=wrapped;
}
function installSmartLoader(){
  if(typeof window.loadAll!=='function'||window.loadAll.__lmPerfWrapped)return false;
  const originalLoadAll=window.loadAll.bind(window);
  fullLoaded=!!(state?.client?.id&&['companies','contacts','leads','offers','tasks'].some(k=>Array.isArray(state?.[k])&&state[k].length));
  if(fullLoaded)lastRefreshAt=Date.now();
  const smartLoad=async function(options={}){
    const forceFull=options===true||options?.full===true||!fullLoaded;
    if(refreshInFlight){pendingRefresh=true;pendingFull=pendingFull||forceFull;return refreshInFlight}
    const started=performance.now();
    refreshInFlight=(async()=>{
      if(forceFull){const out=await originalLoadAll();fullLoaded=true;dirtyTables.clear();lastRefreshAt=Date.now();updateSyncLabel(13,performance.now()-started);return out}
      const cid=state?.client?.id;if(!cid)return;
      let keys=[...new Set([...dirtyTables].map(t=>tableToKey[t]).filter(Boolean))];dirtyTables.clear();
      if(!keys.length)keys=keysForActiveView();
      if(Array.isArray(options?.keys)&&options.keys.length)keys=[...new Set(options.keys.filter(k=>keyToTable[k]))];
      const results=await Promise.all(keys.map(async key=>[key,await queryFor(key,cid)]));
      if(state?.client?.id!==cid)return;
      for(const [key,r] of results){if(r?.error){console.error('perf refresh '+key,r.error);if(typeof toast==='function')toast('Fejl ved '+key);continue}state[key]=r?.data||[]}
      lastRefreshAt=Date.now();renderView();refreshOpenSurface(keys);if(keys.includes('offers'))safeCall('renderOfferPipeline');updateSyncLabel(keys.length,performance.now()-started);
      window.dispatchEvent(new CustomEvent('lm:data-refreshed',{detail:{keys,duration_ms:Math.round(performance.now()-started),client_id:cid}}));
    })();
    try{return await refreshInFlight}finally{refreshInFlight=null;if(pendingRefresh){const full=pendingFull;pendingRefresh=false;pendingFull=false;if(dirtyTables.size||full)setTimeout(()=>smartLoad({full}),0)}}
  };
  smartLoad.__lmPerfWrapped=true;smartLoad.full=()=>smartLoad({full:true});window.loadAll=smartLoad;return true;
}
function installNavigationRendering(){
  document.addEventListener('click',e=>{const b=e.target.closest?.('.nav button[data-view]');if(b)setTimeout(()=>renderView(b.dataset.view),0)},true);
  const refresh=document.getElementById('refreshBtn');if(refresh)refresh.onclick=async()=>{await window.loadAll({full:true});if(typeof toast==='function')toast('CRM opdateret')};
}
function boot(){
  if(typeof state==='undefined'||typeof supabase==='undefined'||typeof window.loadAll!=='function'){setTimeout(boot,25);return}
  installWriteTracker();installSmartLoader();installNavigationRendering();
  window.__LM_PERF={refreshFull:()=>window.loadAll({full:true}),refreshKeys:(...keys)=>window.loadAll({keys}),renderCurrent:()=>renderView(),getStats:()=>window.__LM_PERF_STATS||null,getDirtyTables:()=>[...dirtyTables],getLastRefreshAge:()=>lastRefreshAt?Date.now()-lastRefreshAt:null};
}
boot();
})();
