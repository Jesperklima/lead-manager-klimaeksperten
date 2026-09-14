(()=>{
'use strict';
if(window.__LM_TENANT_ISOLATION_V2)return;
window.__LM_TENANT_ISOLATION_V2=true;

const TENANT_TABLES=new Set([
  'crm_companies','crm_contacts','crm_leads','crm_activities','crm_mail_messages',
  'crm_opportunities','crm_offers','crm_approvals','crm_agent_runs','crm_tasks',
  'crm_agent_requests','crm_sales_intelligence','crm_integrations','crm_feedback',
  'crm_credit_checks','crm_marketing_leads','crm_marketing_connections'
]);
const STATE_KEYS=['companies','contacts','leads','activities','mail','opps','offers','approvals','runs','tasks','requests','intelligence','integrations'];
const activeClientId=()=>{try{return state?.client?.id||null}catch{return null}};
const sameTenant=(row,cid)=>!!row&&typeof row==='object'&&Object.prototype.hasOwnProperty.call(row,'client_id')&&String(row.client_id)===String(cid);

function sanitizeResult(data,cid,table){
  if(!cid||!TENANT_TABLES.has(table))return data;
  if(Array.isArray(data))return data.filter(row=>sameTenant(row,cid));
  if(data==null)return data;
  return sameTenant(data,cid)?data:null;
}
function installSupabaseGuard(){
  if(typeof supabase==='undefined'||typeof supabase.from!=='function'||supabase.from.__lmTenantGuard)return false;
  const originalFrom=supabase.from.bind(supabase);
  const guarded=function(table){
    const q=originalFrom(table);
    if(!TENANT_TABLES.has(table)||!q||typeof q.execute!=='function')return q;
    const originalExecute=q.execute.bind(q);
    q.execute=async function(){
      const cid=activeClientId();
      if(!cid)return {data:null,error:new Error('Tenant mangler: forespørgsel blokeret')};
      const hasClientFilter=Array.isArray(q.params)&&q.params.some(([k])=>k==='client_id');
      if(!hasClientFilter&&typeof q.eq==='function')q.eq('client_id',cid);
      if(q.method==='POST'&&q.body){
        const enforce=row=>row&&typeof row==='object'?{...row,client_id:cid}:row;
        q.body=Array.isArray(q.body)?q.body.map(enforce):enforce(q.body);
      }
      const result=await originalExecute();
      if(result&&'data' in result)result.data=sanitizeResult(result.data,cid,table);
      return result;
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
    const cid=activeClientId();
    const raw=typeof input==='string'?input:(input?.url||'');
    try{
      if(raw.includes('/rest/v1/')){
        const u=new URL(raw,location.origin);
        const m=u.pathname.match(/\/rest\/v1\/([^/]+)$/);
        const table=m?decodeURIComponent(m[1]):'';
        if(TENANT_TABLES.has(table)){
          if(!cid)throw new Error('Tenant mangler: REST-kald blokeret');
          u.searchParams.set('client_id','eq.'+cid);
          if(typeof input==='string')input=u.toString();else input=new Request(u.toString(),input);
        }
      }
    }catch(e){console.error('tenant fetch blocked',e);throw e}
    return originalFetch(input,init);
  };
  guarded.__lmTenantGuard=true;window.fetch=guarded;
}
function clearCrossTenantUi(){
  ['drawer','offerModal','mailModal'].forEach(id=>{try{document.getElementById(id)?.classList.remove('open')}catch{}});
  try{const report=document.getElementById('activityReport');if(report)delete report.dataset.realLoaded}catch{}
  try{if(typeof currentLead!=='undefined')currentLead=null}catch{}
  try{if(typeof currentOffer!=='undefined')currentOffer=null}catch{}
}
function assertStateTenant(){
  const cid=activeClientId();
  if(!cid){for(const key of STATE_KEYS)try{if(Array.isArray(state?.[key]))state[key]=[]}catch{};clearCrossTenantUi();return false}
  let removed=0;
  for(const key of STATE_KEYS){
    try{if(!Array.isArray(state?.[key]))continue;const before=state[key].length;state[key]=state[key].filter(row=>sameTenant(row,cid));removed+=before-state[key].length}catch{}
  }
  if(removed){console.error('SECURITY: cross-tenant rows blocked',removed,cid);clearCrossTenantUi();try{if(typeof render==='function')render()}catch{}}
  return removed===0;
}
function boot(){
  if(typeof supabase==='undefined'||typeof state==='undefined'){setTimeout(boot,25);return}
  installSupabaseGuard();installFetchGuard();assertStateTenant();
  ['lm:tenant-reset','lm:client-switching','lm:client-switched','lm:client-data-ready','lm:data-refreshed','lm:client-page-rendered'].forEach(ev=>window.addEventListener(ev,()=>queueMicrotask(assertStateTenant)));
  window.__LM_TENANT_GUARD={assert:assertStateTenant,activeClientId,sameTenant};
}
boot();
})();
