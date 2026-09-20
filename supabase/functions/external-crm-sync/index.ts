import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-lead-manager-secret, x-external-crm-sync-secret',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,n=4000)=>String(v??'').trim().slice(0,n);
const lower=(v:any)=>clean(v,1000).toLowerCase();
const PROVIDERS=new Set(['crm_webhook','hubspot']);

function randomSecret(bytes=32){
  const a=new Uint8Array(bytes);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function timingSafe(a:string,b:string){
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;
}
async function hmacHex(secret:string,body:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));
  return [...sig].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function parseJson(r:Response){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {raw:t}}}
function noSecretConfig(cfg:any){const c={...(cfg||{})};delete c.secret_id;return c}

async function actor(admin:any,req:Request,requestedClient?:string){
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)throw Object.assign(new Error('Mangler login'),{status:401});
  const {data,error}=await admin.auth.getUser(token);const u=data?.user;
  if(error||!u?.id)throw Object.assign(new Error('Ugyldigt eller udløbet login'),{status:401});
  const {data:pa}=await admin.from('crm_platform_admins').select('auth_user_id').eq('auth_user_id',u.id).eq('active',true).maybeSingle();
  if(pa){
    if(!requestedClient)throw Object.assign(new Error('Workspace mangler'),{status:400});
    return {user:u,clientId:requestedClient,canManage:true,platformAdmin:true};
  }
  const {data:m,error:me}=await admin.from('crm_users').select('client_id,role,active').eq('auth_user_id',u.id).eq('active',true);
  if(me)throw me;
  const row=(m||[]).find((x:any)=>!requestedClient||x.client_id===requestedClient);
  if(!row)throw Object.assign(new Error('Ingen adgang til workspace'),{status:403});
  return {user:u,clientId:row.client_id,canManage:['owner','admin'].includes(lower(row.role)),platformAdmin:false};
}
async function requireManage(admin:any,req:Request,clientId:string){
  const a=await actor(admin,req,clientId);
  if(!a.canManage)throw Object.assign(new Error('Kun ejer/admin kan ændre CRM-forbindelsen'),{status:403});
  return a;
}
async function getIntegration(admin:any,clientId:string,provider?:string,id?:string){
  let q=admin.from('crm_integrations').select('*').eq('client_id',clientId);
  if(id)q=q.eq('id',id);else if(provider)q=q.eq('provider',provider);
  const {data,error}=await q.maybeSingle();if(error)throw error;return data;
}
async function getSecret(admin:any,integrationId:string){
  const {data,error}=await admin.rpc('crm_external_crm_get_secret',{p_integration_id:integrationId});
  if(error)throw error;return data||{};
}
async function saveSecret(admin:any,integrationId:string,secret:any){
  const {data,error}=await admin.rpc('crm_external_crm_store_secret',{p_integration_id:integrationId,p_secret:secret});
  if(error)throw error;return data;
}
async function ensureIntegration(admin:any,clientId:string,provider:string,account:string,status:string,config:any){
  const current=await getIntegration(admin,clientId,provider);
  if(current){
    const {data,error}=await admin.from('crm_integrations').update({account,status,config:{...(current.config||{}),...(config||{})},last_error:null,updated_at:new Date().toISOString()}).eq('id',current.id).select('*').single();
    if(error)throw error;return data;
  }
  const {data,error}=await admin.from('crm_integrations').insert({client_id:clientId,provider,account,status,config:config||{}}).select('*').single();
  if(error)throw error;return data;
}

async function hubFetch(token:string,path:string,init:any={}){
  const r=await fetch('https://api.hubapi.com'+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(init.headers||{})}});
  const d=await parseJson(r);
  if(!r.ok)throw Object.assign(new Error(clean(d?.message||d?.error||('HubSpot HTTP '+r.status),1200)),{status:r.status,body:d});
  return d;
}
function inferHubPipeline(d:any){
  const pipelines=(d?.results||[]).filter((x:any)=>!x.archived);
  const p=pipelines.find((x:any)=>String(x.id)==='default')||pipelines[0];
  if(!p)return {pipeline_id:null,open_stage_id:null,won_stage_id:null,lost_stage_id:null,pipelines:[]};
  const stages=(p.stages||[]).filter((x:any)=>!x.archived).sort((a:any,b:any)=>(a.displayOrder??0)-(b.displayOrder??0));
  const won=stages.find((x:any)=>/closed\s*won|vundet|won/i.test(clean(x.label)));
  const lost=stages.find((x:any)=>/closed\s*lost|tabt|lost/i.test(clean(x.label)));
  const open=stages.find((x:any)=>x.id!==won?.id&&x.id!==lost?.id)||stages[0];
  return {pipeline_id:p.id,open_stage_id:open?.id||null,won_stage_id:won?.id||null,lost_stage_id:lost?.id||null,pipelines:pipelines.map((x:any)=>({id:x.id,label:x.label,stages:(x.stages||[]).map((s:any)=>({id:s.id,label:s.label,displayOrder:s.displayOrder}))}))};
}
async function testHubSpot(token:string){
  await hubFetch(token,'/crm/v3/objects/companies?limit=1&properties=name');
  await hubFetch(token,'/crm/v3/objects/contacts?limit=1&properties=email');
  const pipelines=await hubFetch(token,'/crm/v3/pipelines/deals');
  let account:any={};
  try{account=await hubFetch(token,'/account-info/v3/details')}catch{}
  return {account, ...inferHubPipeline(pipelines)};
}
function splitName(v:string){const p=clean(v,400).split(/\s+/).filter(Boolean);return {firstname:p[0]||'',lastname:p.slice(1).join(' ')}}
function hubObject(entityType:string){return entityType==='company'?'companies':entityType==='contact'?'contacts':'deals'}
async function loadEntity(admin:any,job:any){
  if(job.entity_type==='company'){
    const {data,error}=await admin.from('crm_companies').select('id,client_id,name,cvr,domain,phone,address,industry,website_url,employee_size_text,company_summary').eq('id',job.local_id).eq('client_id',job.client_id).maybeSingle();
    if(error)throw error;return data;
  }
  if(job.entity_type==='contact'){
    const {data,error}=await admin.from('crm_contacts').select('id,client_id,company_id,full_name,title,phone,email,linkedin_url').eq('id',job.local_id).eq('client_id',job.client_id).maybeSingle();
    if(error)throw error;return data;
  }
  const {data,error}=await admin.from('crm_leads').select('id,client_id,company_id,status,score,priority,source,next_action,next_at,owner_name,loss_reason,won_value,source_url').eq('id',job.local_id).eq('client_id',job.client_id).maybeSingle();
  if(error)throw error;
  if(!data)return null;
  const {data:co}=await admin.from('crm_companies').select('id,name,domain,website_url').eq('id',data.company_id).maybeSingle();
  return {...data,company:co||null};
}
function hubProps(entityType:string,row:any,cfg:any){
  if(entityType==='company')return {
    name:row.name||'',domain:row.domain||undefined,phone:row.phone||undefined,address:row.address||undefined,
    website:row.website_url||undefined,industry:row.industry||undefined,
    description:row.company_summary||undefined
  };
  if(entityType==='contact'){
    const n=splitName(row.full_name||'');
    return {firstname:n.firstname||undefined,lastname:n.lastname||undefined,email:row.email||undefined,phone:row.phone||undefined,jobtitle:row.title||undefined};
  }
  let stage=cfg.open_stage_id||undefined;
  const st=clean(row.status).toUpperCase();
  if(st==='VUNDET'&&cfg.won_stage_id)stage=cfg.won_stage_id;
  if(['TABT','LUKKET','LUKKET – UDSKUDT'].includes(st)&&cfg.lost_stage_id)stage=cfg.lost_stage_id;
  return {
    dealname:(row.company?.name||'Lead')+(row.source?' · '+row.source:''),
    pipeline:cfg.pipeline_id||undefined,
    dealstage:stage,
    amount:row.won_value!=null?String(row.won_value):undefined,
    description:[row.next_action,row.source,row.source_url].filter(Boolean).join(' · ')||undefined
  };
}
function stripUndefined(o:any){return Object.fromEntries(Object.entries(o||{}).filter(([,v])=>v!==undefined&&v!==null&&v!==''))}
async function hubSearch(token:string,entityType:string,row:any){
  let prop='',value='';
  if(entityType==='company'&&row.domain){prop='domain';value=row.domain}
  if(entityType==='contact'&&row.email){prop='email';value=row.email}
  if(!prop)return null;
  const d=await hubFetch(token,`/crm/v3/objects/${hubObject(entityType)}/search`,{method:'POST',body:JSON.stringify({filterGroups:[{filters:[{propertyName:prop,operator:'EQ',value}]}],limit:1})});
  return d?.results?.[0]?.id||null;
}
const assocCache=new Map<string,string>();
async function hubAssociationType(token:string,from:string,to:string){
  const k=from+'>'+to;if(assocCache.has(k))return assocCache.get(k)!;
  const d=await hubFetch(token,`/crm/v4/associations/${from}/${to}/labels`);
  const r=(d?.results||[]).find((x:any)=>x.category==='HUBSPOT_DEFINED'&&(x.label==null||x.label===''))||(d?.results||[])[0];
  const id=String(r?.typeId||'');if(id)assocCache.set(k,id);return id;
}
async function hubAssociate(token:string,from:string,fromId:string,to:string,toId:string){
  if(!fromId||!toId)return;
  try{
    const type=await hubAssociationType(token,from,to);if(!type)return;
    await hubFetch(token,`/crm/v4/objects/${from}/${encodeURIComponent(fromId)}/associations/${to}/${encodeURIComponent(toId)}/${type}`,{method:'POST',body:'{}'});
  }catch(e){console.warn('HubSpot association',e)}
}
async function upsertLink(admin:any,job:any,remoteId:string,remoteUrl:string|null,metadata:any={}){
  const {data:existing}=await admin.from('crm_external_entity_links').select('id').eq('integration_id',job.integration_id).eq('entity_type',job.entity_type).eq('local_id',job.local_id).maybeSingle();
  const payload={client_id:job.client_id,integration_id:job.integration_id,entity_type:job.entity_type,local_id:job.local_id,remote_id:remoteId,remote_url:remoteUrl,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata};
  if(existing){
    const {error}=await admin.from('crm_external_entity_links').update(payload).eq('id',existing.id);if(error)throw error;
  }else{
    const {error}=await admin.from('crm_external_entity_links').insert(payload);if(error)throw error;
  }
}
async function syncHubSpot(admin:any,job:any,integration:any,secret:any){
  const token=clean(secret.token,3000);if(!token)throw new Error('HubSpot-token mangler');
  const {data:link}=await admin.from('crm_external_entity_links').select('*').eq('integration_id',integration.id).eq('entity_type',job.entity_type).eq('local_id',job.local_id).maybeSingle();
  const object=hubObject(job.entity_type);
  if(job.operation==='delete'){
    if(link?.remote_id){
      try{await hubFetch(token,`/crm/v3/objects/${object}/${encodeURIComponent(link.remote_id)}`,{method:'DELETE'})}catch(e:any){if(e?.status!==404)throw e}
      await admin.from('crm_external_entity_links').delete().eq('id',link.id);
    }
    return {remote_id:link?.remote_id||null,deleted:true};
  }
  const row=await loadEntity(admin,job);if(!row)return {skipped:true,reason:'local_missing'};
  const properties=stripUndefined(hubProps(job.entity_type,row,integration.config||{}));
  let remoteId=link?.remote_id||null;
  if(!remoteId)remoteId=await hubSearch(token,job.entity_type,row);
  let remote:any;
  if(remoteId)remote=await hubFetch(token,`/crm/v3/objects/${object}/${encodeURIComponent(remoteId)}`,{method:'PATCH',body:JSON.stringify({properties})});
  else remote=await hubFetch(token,`/crm/v3/objects/${object}`,{method:'POST',body:JSON.stringify({properties})});
  remoteId=String(remote.id||remoteId||'');if(!remoteId)throw new Error('HubSpot returnerede ikke record-id');
  const hubId=clean(integration.config?.hub_id,100);
  const objectType=job.entity_type==='company'?'0-2':job.entity_type==='contact'?'0-1':'0-3';
  const remoteUrl=hubId?`https://app.hubspot.com/contacts/${hubId}/record/${objectType}/${remoteId}`:null;
  await upsertLink(admin,job,remoteId,remoteUrl,{provider:'hubspot'});
  if(job.entity_type==='contact'&&row.company_id){
    const {data:co}=await admin.from('crm_external_entity_links').select('remote_id').eq('integration_id',integration.id).eq('entity_type','company').eq('local_id',row.company_id).maybeSingle();
    if(co?.remote_id)await hubAssociate(token,'contacts',remoteId,'companies',co.remote_id);
  }
  if(job.entity_type==='lead'&&row.company_id){
    const {data:co}=await admin.from('crm_external_entity_links').select('remote_id').eq('integration_id',integration.id).eq('entity_type','company').eq('local_id',row.company_id).maybeSingle();
    if(co?.remote_id)await hubAssociate(token,'deals',remoteId,'companies',co.remote_id);
  }
  return {remote_id:remoteId,remote_url:remoteUrl};
}
async function syncWebhook(admin:any,job:any,integration:any,secret:any){
  const endpoint=clean(integration.config?.endpoint_url,3000);if(!/^https:\/\//i.test(endpoint))throw new Error('Webhook endpoint mangler eller er ikke HTTPS');
  const row=job.operation==='delete'?null:await loadEntity(admin,job);
  const {data:link}=await admin.from('crm_external_entity_links').select('*').eq('integration_id',integration.id).eq('entity_type',job.entity_type).eq('local_id',job.local_id).maybeSingle();
  const payload={version:1,event:job.operation,entity_type:job.entity_type,local_id:job.local_id,remote_id:link?.remote_id||null,workspace_id:job.client_id,data:row,occurred_at:new Date().toISOString()};
  const body=JSON.stringify(payload),headers:any={'Content-Type':'application/json','User-Agent':'Lead-Manager-CRM-Sync/1.0'};
  if(secret.bearer_token)headers.Authorization='Bearer '+clean(secret.bearer_token,4000);
  if(secret.outbound_secret)headers['X-Lead-Manager-Signature']='sha256='+await hmacHex(clean(secret.outbound_secret,4000),body);
  const r=await fetch(endpoint,{method:'POST',headers,body});const d=await parseJson(r);
  if(!r.ok)throw Object.assign(new Error(clean(d?.error||d?.message||('Webhook HTTP '+r.status),1200)),{status:r.status});
  const remoteId=clean(d?.remote_id||link?.remote_id||job.local_id,1000);
  if(job.operation==='delete'){if(link?.id)await admin.from('crm_external_entity_links').delete().eq('id',link.id)}
  else await upsertLink(admin,job,remoteId,clean(d?.remote_url,3000)||null,{provider:'crm_webhook'});
  return {remote_id:remoteId,remote_url:clean(d?.remote_url,3000)||null};
}
async function logJob(admin:any,job:any,status:string,summary:string,meta:any={}){
  await admin.from('crm_external_sync_log').insert({client_id:job.client_id,integration_id:job.integration_id,queue_id:job.id,entity_type:job.entity_type,local_id:job.local_id,operation:job.operation,direction:'outbound',status,summary,metadata:meta});
}
async function finishJob(admin:any,job:any,ok:boolean,errorText=''){
  if(ok){
    await admin.from('crm_external_sync_queue').update({status:'done',completed_at:new Date().toISOString(),error_text:null,updated_at:new Date().toISOString()}).eq('id',job.id);
    return;
  }
  const dead=Number(job.attempts||0)>=Number(job.max_attempts||5);
  const mins=Math.min(60,Math.pow(2,Math.max(0,Number(job.attempts||1)-1))*2);
  await admin.from('crm_external_sync_queue').update({status:dead?'dead':'error',error_text:errorText.slice(0,2000),available_at:new Date(Date.now()+mins*60000).toISOString(),updated_at:new Date().toISOString()}).eq('id',job.id);
}
async function processJob(admin:any,job:any){
  const {data:integration,error}=await admin.from('crm_integrations').select('*').eq('id',job.integration_id).eq('client_id',job.client_id).maybeSingle();
  if(error)throw error;if(!integration||integration.status!=='connected')throw new Error('CRM-forbindelsen er ikke aktiv');
  const secret=await getSecret(admin,integration.id);
  let result:any;
  if(integration.provider==='hubspot')result=await syncHubSpot(admin,job,integration,secret);
  else if(integration.provider==='crm_webhook')result=await syncWebhook(admin,job,integration,secret);
  else throw new Error('Provider er ikke implementeret endnu: '+integration.provider);
  await logJob(admin,job,'done','CRM sync completed',result||{});
  await admin.from('crm_integrations').update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',integration.id);
  return result;
}
function hubInboundData(entityType:string,p:any,cfg:any){
  if(entityType==='company')return {name:p.name,domain:p.domain,phone:p.phone,address:p.address,website_url:p.website,industry:p.industry};
  if(entityType==='contact')return {full_name:[p.firstname,p.lastname].filter(Boolean).join(' '),email:p.email,phone:p.phone,title:p.jobtitle};
  const out:any={};
  if(p.dealstage&&cfg.won_stage_id&&String(p.dealstage)===String(cfg.won_stage_id))out.status='VUNDET';
  if(p.dealstage&&cfg.lost_stage_id&&String(p.dealstage)===String(cfg.lost_stage_id))out.status='TABT';
  if(p.amount!=null&&p.amount!=='')out.won_value=p.amount;
  return out;
}
async function pullHubSpot(admin:any,integration:any,secret:any){
  const cfg=integration.config||{},last=cfg.last_inbound_poll_at?new Date(cfg.last_inbound_poll_at).getTime():0;
  if(Date.now()-last<15*60000)return {skipped:true};
  const token=clean(secret.token,3000);if(!token)return {skipped:true,reason:'token_missing'};
  const groups:any={company:[],contact:[],lead:[]};
  const {data:links,error}=await admin.from('crm_external_entity_links').select('entity_type,remote_id').eq('integration_id',integration.id).limit(300);
  if(error)throw error;for(const l of links||[])if(groups[l.entity_type])groups[l.entity_type].push(l.remote_id);
  let applied=0;
  for(const [entityType,ids] of Object.entries(groups) as any){
    if(!ids.length)continue;
    const object=hubObject(entityType);
    const properties=entityType==='company'?['name','domain','phone','address','website','industry']:entityType==='contact'?['firstname','lastname','email','phone','jobtitle']:['dealstage','amount','dealname'];
    for(let i=0;i<ids.length;i+=100){
      const d=await hubFetch(token,`/crm/v3/objects/${object}/batch/read`,{method:'POST',body:JSON.stringify({properties,inputs:ids.slice(i,i+100).map((id:string)=>({id}))})});
      for(const r of d?.results||[]){
        const data=hubInboundData(entityType,r.properties||{},cfg);
        if(!Object.keys(stripUndefined(data)).length)continue;
        const x=await admin.rpc('crm_apply_external_crm_inbound',{p_integration_id:integration.id,p_entity_type:entityType,p_remote_id:String(r.id),p_data:stripUndefined(data)});
        if(x.error)throw x.error;if(x.data?.ok)applied++;
      }
    }
  }
  await admin.from('crm_integrations').update({config:{...cfg,last_inbound_poll_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('id',integration.id);
  return {applied};
}
async function drain(admin:any){
  const {data:jobs,error}=await admin.rpc('crm_claim_external_sync_jobs',{p_limit:25});if(error)throw error;
  const out:any[]=[];
  for(const job of jobs||[]){
    try{const r=await processJob(admin,job);await finishJob(admin,job,true);out.push({id:job.id,ok:true,result:r})}
    catch(e){const msg=e instanceof Error?e.message:String(e);await logJob(admin,job,'error',msg);await finishJob(admin,job,false,msg);await admin.from('crm_integrations').update({last_error:msg.slice(0,1000),updated_at:new Date().toISOString()}).eq('id',job.integration_id);out.push({id:job.id,ok:false,error:msg})}
  }
  const {data:hub}=await admin.from('crm_integrations').select('*').eq('provider','hubspot').eq('status','connected').limit(20);
  const pulls:any[]=[];
  for(const integration of hub||[]){
    try{const secret=await getSecret(admin,integration.id);pulls.push({integration_id:integration.id,...await pullHubSpot(admin,integration,secret)})}
    catch(e){pulls.push({integration_id:integration.id,error:e instanceof Error?e.message:String(e)})}
  }
  return {jobs:out,pulls};
}
async function queueFullResync(admin:any,clientId:string,integrationId:string){
  let queued=0;
  for(const [table,entity] of [['crm_companies','company'],['crm_contacts','contact'],['crm_leads','lead']] as any){
    const {data,error}=await admin.from(table).select('id').eq('client_id',clientId).limit(2000);if(error)throw error;
    for(const row of data||[]){
      const {error:ie}=await admin.from('crm_external_sync_queue').insert({client_id:clientId,integration_id:integrationId,entity_type:entity,local_id:row.id,operation:'upsert',direction:'outbound',status:'queued',payload:{full_resync:true}});
      if(ie&&ie.code!=='23505')throw ie;if(!ie)queued++;
    }
  }
  return queued;
}
async function handleGenericInbound(admin:any,req:Request,integrationId:string){
  const {data:integration,error}=await admin.from('crm_integrations').select('*').eq('id',integrationId).eq('provider','crm_webhook').eq('status','connected').maybeSingle();
  if(error)throw error;if(!integration)return json({error:'Ukendt CRM webhook'},404);
  const secret=await getSecret(admin,integration.id),given=clean(req.headers.get('x-lead-manager-secret'),4000),expected=clean(secret.inbound_secret,4000);
  if(!expected||!given||!timingSafe(given,expected))return json({error:'Ugyldig webhook-secret'},401);
  const body=await req.json().catch(()=>({})),events=Array.isArray(body)?body:[body],results:any[]=[];
  for(const ev of events.slice(0,100)){
    const entity=clean(ev.entity_type,40),remote=clean(ev.remote_id,1000);
    if(!['company','contact','lead'].includes(entity)||!remote){results.push({ok:false,error:'entity_type/remote_id mangler'});continue}
    if(clean(ev.operation||'upsert',40)==='delete'){results.push({ok:true,ignored:true,reason:'remote_delete_not_applied'});continue}
    const x=await admin.rpc('crm_apply_external_crm_inbound',{p_integration_id:integration.id,p_entity_type:entity,p_remote_id:remote,p_data:ev.data||{}});
    if(x.error)results.push({ok:false,error:x.error.message});else results.push(x.data);
  }
  return json({ok:true,results});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const url=new URL(req.url),hookId=clean(url.searchParams.get('integration'),100);
    if(hookId)return await handleGenericInbound(admin,req,hookId);

    const body=await req.json().catch(()=>({})),action=clean(body.action||'status',60),clientId=clean(body.client_id,100);
    if(action==='drain'){
      const got=clean(req.headers.get('x-external-crm-sync-secret'),500);
      const {data:expected,error}=await admin.rpc('crm_get_external_crm_sync_secret');if(error)throw error;
      if(!got||!expected||!timingSafe(got,String(expected)))return json({error:'Unauthorized runner'},401);
      return json({ok:true,...await drain(admin)});
    }

    const a=action==='status'?await actor(admin,req,clientId):await requireManage(admin,req,clientId);
    if(action==='status'){
      const {data:rows,error:re}=await admin.from('crm_integrations').select('id,provider,account,status,config,last_sync_at,last_error,updated_at').eq('client_id',a.clientId).in('provider',['crm_webhook','hubspot']);
      if(re)throw re;
      const {count:links,error:le}=await admin.from('crm_external_entity_links').select('id',{count:'exact',head:true}).eq('client_id',a.clientId);if(le)throw le;
      const counts:any={queued:0,running:0,error:0,dead:0};
      for(const k of Object.keys(counts)){const {count,error}=await admin.from('crm_external_sync_queue').select('id',{count:'exact',head:true}).eq('client_id',a.clientId).eq('status',k);if(error)throw error;counts[k]=count||0}
      const {data:last,error:lge}=await admin.from('crm_external_sync_log').select('created_at').eq('client_id',a.clientId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(lge)throw lge;
      return json({ok:true,connections:(rows||[]).map((x:any)=>({...x,config:noSecretConfig(x.config)})),queue:counts,links:links||0,last_event:last?.created_at||null,can_manage:a.canManage});
    }

    if(action==='connect_hubspot'){
      const token=clean(body.token,4000);if(!token)return json({error:'HubSpot token mangler'},400);
      const t=await testHubSpot(token),hubId=clean(t.account?.portalId||t.account?.portal_id||t.account?.hubId||t.account?.hub_id,100);
      const cfg={mode:'private_app',hub_id:hubId,pipeline_id:t.pipeline_id,open_stage_id:t.open_stage_id,won_stage_id:t.won_stage_id,lost_stage_id:t.lost_stage_id,sync_companies:true,sync_contacts:true,sync_leads:true,last_inbound_poll_at:null};
      const integration=await ensureIntegration(admin,a.clientId,'hubspot',clean(t.account?.accountName||('HubSpot '+hubId),300),'connected',cfg);
      await saveSecret(admin,integration.id,{token});
      const queued=await queueFullResync(admin,a.clientId,integration.id);
      return json({ok:true,provider:'hubspot',integration_id:integration.id,account:integration.account,queued,pipelines:t.pipelines,config:cfg});
    }

    if(action==='connect_webhook'){
      const endpoint=clean(body.endpoint_url,3000);if(!/^https:\/\//i.test(endpoint))return json({error:'Webhook URL skal bruge HTTPS'},400);
      const inboundSecret=randomSecret(32),outboundSecret=randomSecret(32),bearer=clean(body.bearer_token,4000);
      const pingBody=JSON.stringify({version:1,event:'ping',source:'lead_manager',occurred_at:new Date().toISOString()});
      const headers:any={'Content-Type':'application/json','X-Lead-Manager-Signature':'sha256='+await hmacHex(outboundSecret,pingBody)};
      if(bearer)headers.Authorization='Bearer '+bearer;
      const ping=await fetch(endpoint,{method:'POST',headers,body:pingBody});const pd=await parseJson(ping);
      if(!ping.ok)return json({error:clean(pd?.error||pd?.message||('Webhook test fejlede HTTP '+ping.status),1200)},400);
      const cfg={endpoint_url:endpoint,mode:'bidirectional_webhook',sync_companies:true,sync_contacts:true,sync_leads:true};
      const integration=await ensureIntegration(admin,a.clientId,'crm_webhook',clean(body.account||new URL(endpoint).host,300),'connected',cfg);
      await saveSecret(admin,integration.id,{bearer_token:bearer||null,inbound_secret:inboundSecret,outbound_secret:outboundSecret});
      const queued=await queueFullResync(admin,a.clientId,integration.id);
      return json({ok:true,provider:'crm_webhook',integration_id:integration.id,queued,inbound_url:Deno.env.get('SUPABASE_URL')+'/functions/v1/external-crm-sync?integration='+integration.id,inbound_secret:inboundSecret,outbound_signature:'X-Lead-Manager-Signature: sha256=<HMAC-SHA256 body>'});
    }

    if(action==='test'){
      const integration=await getIntegration(admin,a.clientId,undefined,clean(body.integration_id,100));if(!integration)return json({error:'CRM-forbindelsen findes ikke'},404);
      const secret=await getSecret(admin,integration.id);
      if(integration.provider==='hubspot'){const t=await testHubSpot(clean(secret.token,4000));return json({ok:true,provider:'hubspot',hub_id:t.account?.portalId||t.account?.hubId||null,pipelines:t.pipelines})}
      if(integration.provider==='crm_webhook'){
        const endpoint=clean(integration.config?.endpoint_url,3000),b=JSON.stringify({version:1,event:'ping',source:'lead_manager',occurred_at:new Date().toISOString()});
        const headers:any={'Content-Type':'application/json','X-Lead-Manager-Signature':'sha256='+await hmacHex(clean(secret.outbound_secret,4000),b)};
        if(secret.bearer_token)headers.Authorization='Bearer '+clean(secret.bearer_token,4000);
        const r=await fetch(endpoint,{method:'POST',headers,body:b});const d=await parseJson(r);if(!r.ok)return json({error:clean(d?.error||d?.message||('HTTP '+r.status),1200)},400);return json({ok:true,provider:'crm_webhook'});
      }
      return json({error:'Ukendt provider'},400);
    }

    if(action==='resync'){
      const integration=await getIntegration(admin,a.clientId,undefined,clean(body.integration_id,100));if(!integration)return json({error:'CRM-forbindelsen findes ikke'},404);
      const queued=await queueFullResync(admin,a.clientId,integration.id);return json({ok:true,queued});
    }

    if(action==='disconnect'){
      const integration=await getIntegration(admin,a.clientId,undefined,clean(body.integration_id,100));if(!integration)return json({ok:true});
      await admin.rpc('crm_external_crm_delete_secret',{p_integration_id:integration.id});
      const {error}=await admin.from('crm_integrations').delete().eq('id',integration.id);if(error)throw error;
      return json({ok:true});
    }

    return json({error:'Ukendt handling'},400);
  }catch(e:any){
    console.error('external-crm-sync',e);
    return json({error:e?.message||String(e)},Number(e?.status)||500);
  }
});