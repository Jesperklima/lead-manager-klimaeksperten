import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-mail-offer-sync-secret','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,max=3000)=>String(v??'').trim().slice(0,max);
const norm=(v:any)=>clean(v,500).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const arr=(x:any,keys:string[])=>{if(Array.isArray(x))return x;for(const k of keys)if(Array.isArray(x?.[k]))return x[k];return []};
const rawStatus=(x:any)=>clean(x?.state||x?.status||x?.statusName||x?.offerState||x?.orderState||x?.phase,160);
const numberRefs=(x:any)=>[x?.orderNumber,x?.number,x?.offerNumber,x?.offerNo,x?.offerReference,x?.reference,x?.quotationNumber,x?.quoteNumber].map(norm).filter(Boolean);
const closedCrm=new Set(['VUNDET','TABT','LUKKET – UDSKUDT']);
function safeEqual(a:string,b:string){const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);let d=aa.length^bb.length;for(let i=0;i<Math.max(aa.length,bb.length);i++)d|=(aa[i%Math.max(aa.length,1)]||0)^(bb[i%Math.max(bb.length,1)]||0);return d===0}
function matchesRef(x:any,target:string){if(numberRefs(x).includes(target))return true;const seen=new Set<any>();const walk=(o:any,d=0):boolean=>{if(!o||typeof o!=='object'||d>4||seen.has(o))return false;seen.add(o);for(const [k,v] of Object.entries(o)){if(/offer|quote|quotation/i.test(k)&&['string','number'].includes(typeof v)&&norm(v)===target)return true;if(v&&typeof v==='object'&&walk(v,d+1))return true}return false};return walk(x)}
function plusDaysIso(days:number){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function dkDate(){try{return new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function appendNote(oldValue:any,note:string){const old=clean(oldValue,12000);if(old.includes(note))return old;return clean([old,note].filter(Boolean).join('\n'),12000)}
async function closeTasks(admin:any,o:any,now:string){await admin.from('crm_tasks').update({status:'done',updated_at:now}).eq('client_id',o.client_id).eq('offer_id',o.id).eq('task_type','offer_followup').eq('status','open')}
async function ensureTask(admin:any,o:any,date:string,now:string){const {data}=await admin.from('crm_tasks').select('id').eq('client_id',o.client_id).eq('offer_id',o.id).eq('task_type','offer_followup').eq('status','open').limit(1);const patch={scheduled_at:date+'T09:00:00+02:00',status:'open',assigned_to:o.follow_up_owner||null,updated_at:now,title:`Følg op på tilbud ${o.offer_ref||''} – ${o.customer_name||''}`,planning_type:'flexible',priority:'A'};if(data?.[0])await admin.from('crm_tasks').update(patch).eq('id',data[0].id);else await admin.from('crm_tasks').insert({client_id:o.client_id,company_id:o.company_id,lead_id:o.lead_id||null,offer_id:o.id,...patch,task_type:'offer_followup',calendar_sync_status:'none'})}
async function log(admin:any,o:any,summary:string,metadata:any){await admin.from('crm_activities').insert({client_id:o.client_id,company_id:o.company_id,lead_id:o.lead_id||null,offer_id:o.id,type:'Minuba→tilbud',actor_type:'agent',actor_name:'Minuba status sync',summary,metadata:{automatic:true,...metadata}})}

async function clientRunner(admin:any,clientId:string){
  async function tenantSecret(kind:string){const {data,error}=await admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:clientId,p_kind:kind});if(error)throw error;return String(data||'')}
  let accessToken=await tenantSecret('access_token'),refreshToken=await tenantSecret('refresh_token');
  const {data:platform,error:pe}=await admin.from('crm_integrations').select('client_id,config').eq('provider','minuba').eq('config->>is_platform_oauth_client','true').limit(1).maybeSingle();if(pe)throw pe;if(!platform?.client_id)throw new Error('Platform Minuba OAuth mangler');
  const [{data:oauthClientId,error:c1},{data:oauthClientSecret,error:c2}]=await Promise.all([admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_id'}),admin.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_secret'})]);if(c1||c2)throw c1||c2;if(!accessToken||!refreshToken)throw new Error('Minuba OAuth mangler for kunden');
  const {data:conn}=await admin.from('crm_oauth_connections').select('token_expires_at,scope').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
  async function refreshAccess(){const r=await fetch(String((platform.config||{}).oauth_token_url||'https://auth.minuba.dk/oauth2/token'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+btoa(`${String(oauthClientId)}:${String(oauthClientSecret)}`)},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken})});const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{}if(!r.ok||!j.access_token)throw new Error('Minuba OAuth refresh fejlede: HTTP '+r.status);accessToken=String(j.access_token);refreshToken=String(j.refresh_token||refreshToken);const exp=new Date(Date.now()+Number(j.expires_in||3599)*1000).toISOString();const {error}=await admin.rpc('set_minuba_oauth_tokens',{p_client_id:clientId,p_access_token:accessToken,p_refresh_token:refreshToken,p_expires_at:exp,p_scope:String(j.scope||conn?.scope||'Administrator')});if(error)throw error}
  if(conn?.token_expires_at&&new Date(conn.token_expires_at).getTime()<=Date.now()+60000)await refreshAccess();
  async function getState(state:string){const once=async()=>{const q=new URLSearchParams({state,forAllUsers:'true',include:'client,addresses'});const r=await fetch('https://app.minuba.dk/api/1/Order?'+q.toString(),{headers:{Accept:'application/json',Authorization:'Bearer '+accessToken}});return{r,t:await r.text()}};let z=await once();if(z.r.status===401){await refreshAccess();z=await once()}let data:any={};try{data=JSON.parse(z.t)}catch{}if(!z.r.ok)throw new Error(`Minuba Order state=${state} fejlede: HTTP ${z.r.status}`);return arr(data,['orders','Orders','data'])}
  const states=['proposal','new','started','delayed','completed','closed'];const buckets:any={};for(const s of states)buckets[s]=await getState(s);
  const {data:offers,error:oe}=await admin.from('crm_offers').select('*').eq('client_id',clientId);if(oe)throw oe;
  const candidates=(offers||[]).filter((o:any)=>o.offer_ref&&!closedCrm.has(o.status)&&(o.status!=='LUKKET'||o.status_source==='minuba'));
  const now=new Date().toISOString();let active=0,won=0,closed=0,reopened=0,missingOnce=0,unlinked=0,manual=0;
  for(const o of candidates){
    const target=norm(o.offer_ref),proposal=(buckets.proposal||[]).find((x:any)=>matchesRef(x,target));let order:any=null,orderState='';
    if(!proposal){for(const s of states.slice(1)){const x=(buckets[s]||[]).find((z:any)=>matchesRef(z,target));if(x){order=x;orderState=s;break}}}
    if(proposal){
      const prev=o.status,wasClosed=prev==='LUKKET',status=rawStatus(proposal)||'proposal';
      const patch:any={minuba_status:status,minuba_record_type:'proposal',minuba_order_number:null,minuba_last_checked_at:now,minuba_last_seen_at:now,minuba_sync_state:'active',minuba_raw:proposal,updated_at:now};
      if(!o.manual_lock&&wasClosed){patch.status='I GANG';patch.status_source='minuba';patch.status_reason='Tilbuddet er aktivt igen i Minuba.';patch.status_updated_at=now;patch.follow_up_date=plusDaysIso(7);patch.current_comment=appendNote(o.current_comment,`${dkDate()}: Genåbnet automatisk, fordi tilbuddet igen er aktivt i Minuba.`)}
      const {error}=await admin.from('crm_offers').update(patch).eq('id',o.id);if(error)throw error;active++;
      if(wasClosed&&!o.manual_lock){await ensureTask(admin,o,patch.follow_up_date,now);await log(admin,o,`Tilbud ${o.offer_ref} genåbnet: aktivt igen i Minuba.`,{previous_status:prev,status:'I GANG',minuba_status:status});reopened++}else if(o.manual_lock)manual++;
      continue;
    }
    if(order){
      const orderNo=clean(order?.orderNumber||order?.number,160),status=rawStatus(order)||orderState,prev=o.status;
      const patch:any={minuba_status:status,minuba_record_type:'order',minuba_order_number:orderNo||null,minuba_last_checked_at:now,minuba_last_seen_at:now,minuba_sync_state:'converted_to_order',minuba_raw:order,updated_at:now};
      if(!o.manual_lock&&prev!=='VUNDET'){patch.status='VUNDET';patch.follow_up_date=null;patch.status_source='minuba';patch.status_updated_at=now;patch.status_reason=`Tilbuddet er blevet til ordre i Minuba${orderNo?' (ordre '+orderNo+')':''}.`;patch.current_comment=appendNote(o.current_comment,`${dkDate()}: Vundet automatisk – tilbuddet er blevet til ordre i Minuba${orderNo?' (ordre '+orderNo+')':''}.`)}
      const {error}=await admin.from('crm_offers').update(patch).eq('id',o.id);if(error)throw error;won++;
      if(!o.manual_lock&&prev!=='VUNDET'){await closeTasks(admin,o,now);await log(admin,o,`Tilbud ${o.offer_ref} markeret VUNDET, fordi det er blevet til ordre i Minuba.`,{previous_status:prev,status:'VUNDET',order_number:orderNo,minuba_status:status})}else if(o.manual_lock)manual++;
      continue;
    }
    if(o.status==='LUKKET'&&o.status_source==='minuba'){await admin.from('crm_offers').update({minuba_last_checked_at:now,updated_at:now}).eq('id',o.id);continue}
    if(!o.minuba_last_seen_at){await admin.from('crm_offers').update({minuba_last_checked_at:now,minuba_sync_state:'unlinked',updated_at:now}).eq('id',o.id);unlinked++;continue}
    const oldCheck=o.minuba_last_checked_at?new Date(o.minuba_last_checked_at).getTime():0,eligibleSecond=o.minuba_sync_state==='missing_once'&&(Date.now()-oldCheck)>=30*60*1000;
    if(!eligibleSecond){await admin.from('crm_offers').update({minuba_last_checked_at:now,minuba_sync_state:'missing_once',updated_at:now}).eq('id',o.id);missingOnce++;continue}
    const prev=o.status,note=`${dkDate()}: Lukket automatisk i Lead Manager, fordi tilbuddet ikke længere er aktivt i Minuba efter to sikre statuskontroller.`;
    const patch:any={minuba_status:'closed',minuba_record_type:'proposal',minuba_order_number:null,minuba_last_checked_at:now,minuba_sync_state:'closed',updated_at:now};
    if(!o.manual_lock){patch.status='LUKKET';patch.follow_up_date=null;patch.status_source='minuba';patch.status_updated_at=now;patch.status_reason='Lukket i Lead Manager, fordi tilbuddet er lukket i Minuba.';patch.current_comment=appendNote(o.current_comment,note)}
    const {error}=await admin.from('crm_offers').update(patch).eq('id',o.id);if(error)throw error;
    if(!o.manual_lock){await closeTasks(admin,o,now);await log(admin,o,`Tilbud ${o.offer_ref} lukket efter to Minuba-kontroller uden aktivt tilbud eller ordre.`,{previous_status:prev,status:'LUKKET',reason:'minuba_missing_twice'});closed++}else manual++;
  }
  await admin.from('crm_integrations').update({status:'connected',last_error:null,last_sync_at:now,updated_at:now}).eq('client_id',clientId).eq('provider','minuba');
  return {client_id:clientId,checked:candidates.length,active,won,closed,reopened,missing_once:missingOnce,unlinked,manual_locked:manual};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>({})),requested=clean(body.client_id,100),cronSecret=clean(req.headers.get('x-mail-offer-sync-secret'),500);const {data:expected}=await admin.rpc('crm_get_mail_offer_sync_secret');const cron=!!cronSecret&&!!expected&&safeEqual(cronSecret,String(expected));let user:any=null;
    if(!cron){const token=clean((req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''),5000);if(!token)return json({error:'Mangler login-token'},401);const a=await admin.auth.getUser(token);user=a.data?.user;if(a.error||!user?.id)return json({error:'Ugyldigt login'},401)}
    let clientIds:string[]=[];
    if(requested){if(user){const {data:m}=await admin.from('crm_users').select('id').eq('client_id',requested).eq('auth_user_id',user.id).eq('active',true).maybeSingle();if(!m)return json({error:'Ingen adgang'},403)}clientIds=[requested]}
    else{if(!cron)return json({error:'client_id er påkrævet'},400);const {data:ints}=await admin.from('crm_integrations').select('client_id').eq('provider','minuba').eq('status','connected');clientIds=[...new Set((ints||[]).map((x:any)=>x.client_id).filter(Boolean))]}
    const results=[];for(const id of clientIds){try{results.push(await clientRunner(admin,id))}catch(e){const msg=e instanceof Error?e.message:String(e);await admin.from('crm_integrations').update({last_error:clean(msg,1000),updated_at:new Date().toISOString()}).eq('client_id',id).eq('provider','minuba');results.push({client_id:id,error:msg})}}
    return json({ok:true,results});
  }catch(e){console.error(e);return json({error:e instanceof Error?e.message:String(e)},500)}
});
