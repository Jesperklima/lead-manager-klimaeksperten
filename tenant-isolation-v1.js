(()=>{
'use strict';
if(window.__LM_TENANT_ISOLATION_V1)return;
window.__LM_TENANT_ISOLATION_V1=true;

const TENANT_TABLES=new Set([
  'crm_companies','crm_contacts','crm_leads','crm_activities','crm_mail_messages',
  'crm_opportunities','crm_offers','crm_approvals','crm_agent_runs','crm_tasks',
  'crm_agent_requests','crm_sales_intelligence','crm_integrations','crm_feedback',
  'crm_credit_checks','crm_marketing_leads','crm_marketing_connections'
]);
const activeClientId=()=>{try{return state?.client?.id||null}catch{return null}};

function installSupabaseGuard(){
  if(typeof supabase==='undefined'||typeof supabase.from!=='function'||supabase.from.__lmTenantGuard)return false;
  const originalFrom=supabase.from.bind(supabase);
  const guarded=function(table){
    const q=originalFrom(table);
    if(!TENANT_TABLES.has(table)||!q||typeof q.execute!=='function')return q;
    const originalExecute=q.execute.bind(q);
    q.execute=async function(){
      const cid=activeClientId();
      if(!cid)return originalExecute();
      const hasClientFilter=Array.isArray(q.params)&&q.params.some(([k])=>k==='client_id');
      if(!hasClientFilter&&typeof q.eq==='function')q.eq('client_id',cid);
      if(q.method==='POST'&&q.body){
        if(Array.isArray(q.body))q.body=q.body.map(row=>row&&typeof row==='object'?{...row,client_id:row.client_id||cid}:row);
        else if(typeof q.body==='object')q.body={...q.body,client_id:q.body.client_id||cid};
      }
      return originalExecute();
    };
    return q;
  };
  guarded.__lmTenantGuard=true;
  supabase.from=guarded;
  return true;
}

function installFetchGuard(){
  if(window.fetch.__lmTenantGuard)return;
  const originalFetch=window.fetch.bind(window);
  const guarded=async function(input,init){
    try{
      const cid=activeClientId();
      const raw=typeof input==='string'?input:(input?.url||'');
      if(cid&&raw.includes('/rest/v1/')){
        const u=new URL(raw,location.origin);
        const m=u.pathname.match(/\/rest\/v1\/([^/]+)$/);
        const table=m?decodeURIComponent(m[1]):'';
        if(TENANT_TABLES.has(table)&&!u.searchParams.has('client_id')){
          u.searchParams.append('client_id','eq.'+cid);
          if(typeof input==='string')input=u.toString();
          else input=new Request(u.toString(),input);
        }
      }
    }catch(e){console.warn('tenant fetch guard',e)}
    return originalFetch(input,init);
  };
  guarded.__lmTenantGuard=true;
  window.fetch=guarded;
}

function clearCrossTenantUi(){
  try{document.getElementById('drawer')?.classList.remove('open')}catch{}
  try{document.getElementById('offerModal')?.classList.remove('open')}catch{}
  try{document.getElementById('mailModal')?.classList.remove('open')}catch{}
  try{const report=document.getElementById('activityReport');if(report)delete report.dataset.realLoaded}catch{}
  try{if(typeof currentLead!=='undefined')currentLead=null}catch{}
  try{if(typeof currentOffer!=='undefined')currentOffer=null}catch{}
}

function assertStateTenant(){
  const cid=activeClientId();if(!cid)return;
  const keys=['companies','contacts','leads','activities','mail','opps','offers','approvals','runs','tasks','requests','intelligence','integrations'];
  let removed=0;
  for(const key of keys){
    try{
      if(!Array.isArray(state?.[key]))continue;
      const before=state[key].length;
      state[key]=state[key].filter(row=>!row?.client_id||row.client_id===cid);
      removed+=before-state[key].length;
    }catch{}
  }
  if(removed){
    console.error('Tenant isolation removed cross-client rows',removed,cid);
    try{if(typeof render==='function')render()}catch{}
  }
}

function boot(){
  if(typeof supabase==='undefined'||typeof state==='undefined'){setTimeout(boot,25);return}
  installSupabaseGuard();installFetchGuard();assertStateTenant();
  window.addEventListener('lm:client-switching',()=>{clearCrossTenantUi();queueMicrotask(assertStateTenant)});
  window.addEventListener('lm:client-data-ready',assertStateTenant);
  window.addEventListener('lm:data-refreshed',assertStateTenant);
  window.__LM_TENANT_GUARD={assert:assertStateTenant,activeClientId};
}
boot();
})();
