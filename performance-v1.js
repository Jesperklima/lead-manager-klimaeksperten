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
const allKeys=Object.keys(keyToTable);
const startupKeys=['companies','leads','activities','offers','approvals','tasks','mail'];
const partialStartupKeys=new Set(['activities','mail','approvals','offers']);
const viewRefreshKeys={
  dashboard:['companies','leads','activities','offers','approvals','tasks','mail'],
  leads:['companies','contacts','leads'],
  pipeline:['companies','leads'],
  offers:['companies','offers'],
  offerpipeline:['companies','offers'],
  calendar:['leads','offers','tasks'],
  mail:['mail'],
  activity:['activities'],
  activityReport:['activities','mail','leads','offers'],
  approvals:['approvals'],
  leadmanager:['integrations'],
  agents:['runs','requests'],
  marketingLeads:['companies','contacts','leads'],
  marketingConnections:['integrations']
};

const dirtyTables=new Set();
const loadedAt=new Map();
const partialLoaded=new Set();
let loadedClientId=null;
let startupReady=false;
let refreshInFlight=null;
let refreshClientId=null;
let pendingFull=false;
let pendingWorkspace=false;
const pendingKeys=new Set();
let lastRefreshAt=0;

function resetForClient(cid){
  if(String(loadedClientId||'')===String(cid||''))return;
  loadedClientId=cid||null;
  window.__LM_MAIL_COUNT=0;
  startupReady=false;
  loadedAt.clear();
  partialLoaded.clear();
  dirtyTables.clear();
}

function queryFor(key,cid,{light=false}={}){
  switch(key){
    case 'companies': return supabase.from('crm_companies').select('*').eq('client_id',cid).order('name');
    case 'contacts': return supabase.from('crm_contacts').select('*').eq('client_id',cid);
    case 'leads': return supabase.from('crm_leads').select('*').eq('client_id',cid).order('updated_at',{ascending:false});
    case 'activities':
      return supabase.from('crm_activities')
        .select(light?'id,type,summary,metadata,lead_id,company_id,created_at':'*')
        .eq('client_id',cid).order('created_at',{ascending:false}).limit(500);
    case 'mail':
      return light
        ? supabase.from('crm_mail_messages').select('id',{count:'exact',head:true}).eq('client_id',cid)
        : supabase.from('crm_mail_messages').select('*',{count:'exact'}).eq('client_id',cid).order('message_at',{ascending:false}).limit(300);
    case 'opps': return supabase.from('crm_opportunities').select('*').eq('client_id',cid).order('updated_at',{ascending:false});
    case 'offers': return supabase.from('crm_offers').select(light?'id,client_id,company_id,lead_id,opportunity_id,offer_ref,customer_name,installation_address,sent_date,follow_up_date,follow_up_month,follow_up_owner,contact_person,contact_details,status,status_reason,current_comment,source_file,source_sheet,source_row,data_warning,created_at,updated_at,manual_lock,status_source,status_updated_at,minuba_status,minuba_record_type,minuba_order_number,minuba_last_checked_at,minuba_last_seen_at,minuba_sync_state':'*').eq('client_id',cid).order('follow_up_date',{ascending:true});
    case 'approvals':
      return light
        ? supabase.from('crm_approvals').select('id,status,created_at').eq('client_id',cid).eq('status','pending').order('created_at',{ascending:false})
        : supabase.from('crm_approvals').select('*').eq('client_id',cid).order('created_at',{ascending:false});
    case 'runs': return supabase.from('crm_agent_runs').select('*').eq('client_id',cid).order('started_at',{ascending:false}).limit(100);
    case 'tasks': return supabase.from('crm_tasks').select('*').eq('client_id',cid).order('scheduled_at',{ascending:true});
    case 'requests': return supabase.from('crm_agent_requests').select('*').eq('client_id',cid).order('created_at',{ascending:false}).limit(100);
    case 'intelligence': return supabase.from('crm_sales_intelligence').select('*').eq('client_id',cid).order('created_at',{ascending:false}).limit(500);
    case 'integrations': return supabase.from('crm_integrations').select('*').eq('client_id',cid);
    default: return null;
  }
}

function activeView(){return document.querySelector('.nav button[data-view].active')?.dataset?.view||document.querySelector('.view.active')?.id||'dashboard'}
function keysForView(view=activeView()){return [...(viewRefreshKeys[view]||['companies','leads','offers','tasks'])]}
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
function updateSyncLabel(queryCount,ms,mode){
  const el=document.getElementById('syncState');
  if(el)el.textContent='● Live CRM · '+new Date().toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'});
  window.__LM_PERF_STATS={
    last_refresh_at:new Date().toISOString(),
    queries:queryCount,
    duration_ms:Math.round(ms),
    mode:mode||'view',
    loaded_keys:[...loadedAt.keys()],
    partial_keys:[...partialLoaded],
    dirty_tables:[...dirtyTables],
    client_id:state?.client?.id||null
  };
}
function installWriteTracker(){
  if(typeof supabase==='undefined'||typeof supabase.from!=='function'||supabase.from.__lmPerfWrapped)return;
  const originalFrom=supabase.from.bind(supabase);
  const wrapped=function(table){
    const q=originalFrom(table);
    if(!q||typeof q.execute!=='function')return q;
    const execute=q.execute.bind(q);
    q.execute=async function(){
      const write=q.method==='POST'||q.method==='PATCH'||q.method==='DELETE';
      const result=await execute();
      if(write&&!result?.error&&tableToKey[table])dirtyTables.add(table);
      return result;
    };
    return q;
  };
  wrapped.__lmPerfWrapped=true;
  supabase.from=wrapped;
}

function mergePending(options){
  if(options?.full===true)pendingFull=true;
  if(options?.workspace===true||options?.startup===true)pendingWorkspace=true;
  if(Array.isArray(options?.keys))for(const key of options.keys)if(keyToTable[key])pendingKeys.add(key);
}
function hasFreshFullKey(key,maxAge=60000){
  if(partialLoaded.has(key))return false;
  const at=loadedAt.get(key)||0;
  return at>0&&(Date.now()-at)<maxAge;
}
function seedBaseLoaded(){
  const cid=state?.client?.id||null;
  if(!cid||String(window.__LM_BASE_CLIENT_ID||'')!==String(cid))return;
  const keys=Array.isArray(window.__LM_BASE_LOADED_KEYS)?window.__LM_BASE_LOADED_KEYS:[];
  const now=Date.now();
  for(const key of keys)if(keyToTable[key])loadedAt.set(key,now);
  if(window.__LM_BASE_STARTUP_READY===true)startupReady=true;
}

function installSmartLoader(){
  if(typeof window.loadAll!=='function'||window.loadAll.__lmPerfWrapped)return false;
  const smartLoad=async function(options={}){
    const cid=state?.client?.id||null;
    if(!cid)return;
    resetForClient(cid);

    if(refreshInFlight){
      if(refreshClientId&&String(refreshClientId)!==String(cid)){
        const previous=refreshInFlight;
        return previous.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,0))).then(()=>{
          if(String(state?.client?.id)!==String(cid))return;
          return smartLoad(options);
        });
      }
      mergePending(options);
      return refreshInFlight;
    }

    const started=performance.now();
    refreshClientId=cid;
    const requestedView=options?.view||activeView();
    const isFull=options?.full===true;
    const isWorkspace=options?.workspace===true;
    const isStartup=options?.startup===true||(!startupReady&&!isFull);
    const viewKeys=keysForView(requestedView);

    let keys;
    if(isFull)keys=[...allKeys];
    else if(isWorkspace)keys=[...new Set([...startupKeys,...viewKeys])];
    else if(isStartup)keys=[...startupKeys];
    else if(Array.isArray(options?.keys)&&options.keys.length)keys=[...new Set(options.keys.filter(k=>keyToTable[k]))];
    else{
      keys=[...new Set([...dirtyTables].map(t=>tableToKey[t]).filter(Boolean))];
      if(!keys.length)keys=viewKeys;
    }

    const force=options?.force===true||isStartup||isWorkspace||isFull||dirtyTables.size>0;
    if(!force){
      keys=keys.filter(key=>!hasFreshFullKey(key));
      if(!keys.length){renderView(requestedView);return}
    }

    const thisRefresh=(async()=>{
      const results=await Promise.all(keys.map(async key=>{
        const light=(isStartup||isWorkspace)&&partialStartupKeys.has(key)&&!['activity','activityReport','mail','approvals'].includes(requestedView);
        return [key,light,await queryFor(key,cid,{light})];
      }));
      if(String(state?.client?.id)!==String(cid))return;

      const changed=[];
      for(const [key,light,r] of results){
        if(r?.error){
          console.error('perf refresh '+key,r.error);
          if(typeof toast==='function')toast('Fejl ved '+key);
          continue;
        }
        if(key==='mail'&&Number.isFinite(r?.count))window.__LM_MAIL_COUNT=r.count;
        state[key]=key==='mail'&&light?[]:(r?.data||[]);
        loadedAt.set(key,Date.now());
        if(light)partialLoaded.add(key);else partialLoaded.delete(key);
        dirtyTables.delete(keyToTable[key]);
        changed.push(key);
      }

      startupReady=startupReady||isStartup||isWorkspace||isFull;
      lastRefreshAt=Date.now();
      renderView(requestedView);
      refreshOpenSurface(changed);
      if(changed.includes('offers')&&requestedView!=='offerpipeline')safeCall('renderOfferPipeline');
      const mode=isFull?'full':isWorkspace?'workspace':isStartup?'startup':'view';
      updateSyncLabel(keys.length,performance.now()-started,mode);
      window.dispatchEvent(new CustomEvent('lm:data-refreshed',{detail:{keys:changed,mode,duration_ms:Math.round(performance.now()-started),client_id:cid}}));
    })();

    refreshInFlight=thisRefresh;
    try{return await thisRefresh}
    finally{
      if(refreshInFlight===thisRefresh){refreshInFlight=null;refreshClientId=null}
      if(!refreshInFlight&&(pendingFull||pendingWorkspace||pendingKeys.size)){
        const full=pendingFull,workspace=pendingWorkspace,keys=[...pendingKeys];
        pendingFull=false;pendingWorkspace=false;pendingKeys.clear();
        setTimeout(()=>smartLoad(full?{full:true,force:true}:workspace?{workspace:true,force:true}:{keys,force:true}),0);
      }
    }
  };

  smartLoad.__lmPerfWrapped=true;
  smartLoad.full=()=>smartLoad({full:true,force:true});
  window.loadAll=smartLoad;
  return true;
}

function installNavigationRendering(){
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('.nav button[data-view]');
    if(!button)return;
    const view=button.dataset.view;
    setTimeout(()=>{
      renderView(view);
      const keys=keysForView(view);
      const needed=keys.filter(key=>!hasFreshFullKey(key));
      if(needed.length)window.loadAll({keys:needed,view,force:true});
    },0);
  },true);

  const refresh=document.getElementById('refreshBtn');
  if(refresh)refresh.onclick=async()=>{
    const view=activeView();
    await window.loadAll({keys:keysForView(view),view,force:true});
    if(typeof toast==='function')toast('CRM opdateret');
  };
}

function boot(){
  if(typeof state==='undefined'||typeof supabase==='undefined'||typeof window.loadAll!=='function'){setTimeout(boot,25);return}
  resetForClient(state?.client?.id||null);
  seedBaseLoaded();
  installWriteTracker();
  installSmartLoader();
  installNavigationRendering();
  window.__LM_PERF={
    refreshFull:()=>window.loadAll({full:true,force:true}),
    refreshWorkspace:()=>window.loadAll({workspace:true,view:activeView(),force:true}),
    refreshStartup:()=>window.loadAll({startup:true,view:activeView(),force:true}),
    refreshKeys:(...keys)=>window.loadAll({keys,view:activeView(),force:true}),
    ensureView:view=>{
      const keys=keysForView(view);
      const needed=keys.filter(key=>!hasFreshFullKey(key));
      renderView(view);
      return needed.length?window.loadAll({keys:needed,view,force:true}):Promise.resolve();
    },
    renderCurrent:()=>renderView(),
    getStats:()=>window.__LM_PERF_STATS||null,
    getDirtyTables:()=>[...dirtyTables],
    getLoadedKeys:()=>[...loadedAt.keys()],
    getPartialKeys:()=>[...partialLoaded],
    getLastRefreshAge:()=>lastRefreshAt?Date.now()-lastRefreshAt:null
  };
}
boot();
})();