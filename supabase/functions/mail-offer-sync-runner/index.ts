import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-mail-offer-sync-secret',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const out=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,max=5000)=>String(v??'').trim().slice(0,max);
const lower=(v:any)=>clean(v).toLowerCase();
function safeEqual(a:string,b:string){const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);let d=aa.length^bb.length;for(let i=0;i<Math.max(aa.length,bb.length);i++)d|=(aa[i%Math.max(aa.length,1)]||0)^(bb[i%Math.max(bb.length,1)]||0);return d===0}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function domainOf(email:any){const m=lower(email).match(/@([^\s>]+)$/);return m?.[1]||''}
function cphDate(value:any){const d=new Date(value);const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const g=(t:string)=>p.find(x=>x.type===t)?.value||'';return`${g('year')}-${g('month')}-${g('day')}`}
function easterSunday(year:number){const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(Date.UTC(year,month-1,day,12))}
const iso=(d:Date)=>d.toISOString().slice(0,10);
function mv(d:Date,n:number){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function holidays(y:number){const e=easterSunday(y);return new Set([`${y}-01-01`,`${y}-12-25`,`${y}-12-26`,iso(mv(e,-3)),iso(mv(e,-2)),iso(e),iso(mv(e,1)),iso(mv(e,39)),iso(mv(e,49)),iso(mv(e,50))])}
function addBusinessDays(value:any,n:number){const d=new Date(cphDate(value)+'T12:00:00Z');let left=n;while(left>0){d.setUTCDate(d.getUTCDate()+1);const day=d.getUTCDay();if(day>=1&&day<=5&&!holidays(d.getUTCFullYear()).has(iso(d)))left--}return iso(d)}

async function postflight(sb:any,clientId:string){
  if(!clientId)return[];
  const cutoff=new Date(Date.now()-15*60*1000).toISOString();
  const[{data:users},{data:ints},{data:acts}]=await Promise.all([
    sb.from('crm_users').select('email').eq('client_id',clientId).eq('active',true),
    sb.from('crm_integrations').select('account').eq('client_id',clientId),
    sb.from('crm_activities').select('id,offer_id,summary,metadata,created_at').eq('client_id',clientId).eq('actor_name','Mail & Conversation Agent').gte('created_at',cutoff).order('created_at',{ascending:true})
  ]);
  const internalDomains=new Set<string>();
  for(const x of[...(users||[]),...(ints||[])]){const d=domainOf(x?.email||x?.account);if(d)internalDomains.add(d)}
  const corrections:any[]=[];
  for(const a of acts||[]){
    const meta=a?.metadata||{},target=clean(meta.status,80),previous=clean(meta.previous_status,80),messageId=clean(meta.external_message_id,1000);
    if(!['VUNDET','TABT'].includes(target)||!messageId||!a.offer_id)continue;
    const{data:msg}=await sb.from('crm_mail_messages').select('from_email,message_at,metadata').eq('client_id',clientId).eq('external_message_id',messageId).maybeSingle();
    if(!msg||!internalDomains.has(domainOf(msg.from_email)))continue;
    const{data:offer}=await sb.from('crm_offers').select('*').eq('id',a.offer_id).eq('client_id',clientId).maybeSingle();
    if(!offer||offer.status!==target||offer.status_source!=='mail_sync')continue;
    const restore=previous||'I GANG',closed=['VUNDET','TABT','LUKKET','LUKKET – UDSKUDT'].includes(restore),follow=closed?offer.follow_up_date:addBusinessDays(msg.message_at||new Date(),7),now=new Date().toISOString();
    const reason='Intern mail må ikke alene afgøre om et tilbud er vundet eller tabt.';
    const note=`${cphDate(now)}: Automatisk status fra intern mail blev ignoreret. ${reason}`;
    const current=clean(offer.current_comment,12000),comment=current.includes(note)?current:[current,note].filter(Boolean).join('\n').slice(0,12000);
    const{error}=await sb.from('crm_offers').update({status:restore,follow_up_date:follow,status_source:'mail_sync_guard',status_reason:reason,status_updated_at:now,current_comment:comment,updated_at:now}).eq('id',offer.id);
    if(error)continue;
    await sb.from('crm_mail_messages').update({metadata:{...(msg.metadata||{}),internal_decision_ignored:true,offer_sync_result:'IGNORED_INTERNAL_DECISION',offer_sync_reason:reason}}).eq('client_id',clientId).eq('external_message_id',messageId);
    await sb.from('crm_activities').insert({client_id:clientId,company_id:offer.company_id,lead_id:offer.lead_id,offer_id:offer.id,type:'Mail→tilbud kontrol',actor_type:'agent',actor_name:'Mail sync guard',summary:note,metadata:{automatic:true,source_activity_id:a.id,external_message_id:messageId,ignored_status:target,restored_status:restore}});
    corrections.push({offer_ref:offer.offer_ref,ignored_status:target,restored_status:restore,message_id:messageId});
  }
  return corrections;
}

async function guardDraftApprovals(sb:any,baseUrl:string,secret:string,clientId:string,data:any){
  if(!secret||!clientId)return[];
  const refs=new Set<string>();
  for(const result of(data?.results||[]))for(const p of(result?.proposals||[]))if(!p?.offer&&p?.offer_ref&&!p?.minuba_info)refs.add(clean(p.offer_ref,160));
  const ignored:any[]=[];
  for(const ref of[...refs].slice(0,12)){
    try{
      const r=await fetch(baseUrl+'/functions/v1/minuba-offer-smoke-temp',{method:'POST',headers:{'Content-Type':'application/json','x-mail-offer-sync-secret':secret},body:JSON.stringify({client_id:clientId,offer_ref:ref})});
      const probe=await r.json().catch(()=>({}));if(!r.ok)continue;
      const draft=(probe?.matches||[]).find((m:any)=>/draft|kladde/i.test(clean(m?.state||m?.status||m?.statusName||m?.offerState||m?.orderState,200)));
      if(!draft)continue;
      const reason=`Minuba markerer tilbud ${ref} som ${clean(draft.state||draft.status||draft.statusName||'DRAFT',160)}. Kladder må ikke importeres til Tilbudspipelinen.`;
      const{data:approvals}=await sb.from('crm_approvals').select('id,payload').eq('client_id',clientId).eq('action_type','offer_mail_update').eq('status','pending').contains('payload',{offer_ref:ref});
      let count=0;
      for(const a of approvals||[]){
        const payload=a.payload||{},provider=clean(payload.provider,80),messageId=clean(payload.external_message_id,1000),now=new Date().toISOString();
        await sb.from('crm_approvals').update({status:'rejected',decided_at:now,payload:{...payload,draft_ignored:true,explanation:reason}}).eq('id',a.id);
        if(provider&&messageId){const{data:msg}=await sb.from('crm_mail_messages').select('metadata').eq('client_id',clientId).eq('provider',provider).eq('external_message_id',messageId).maybeSingle();await sb.from('crm_mail_messages').update({metadata:{...(msg?.metadata||{}),offer_sync_processed:true,offer_sync_result:'IGNORED_MINUBA_DRAFT',offer_sync_reason:reason,minuba_state:clean(draft.state||draft.status||draft.statusName,160)}}).eq('client_id',clientId).eq('provider',provider).eq('external_message_id',messageId)}
        count++;
      }
      ignored.push({offer_ref:ref,minuba_state:clean(draft.state||draft.status||draft.statusName,160),approvals_rejected:count});
    }catch{}
  }
  return ignored;
}


const READ_CUTOVER='2026-09-28T00:00:00Z';
function syncProcessed(meta:any){return meta?.offer_sync_processed===true||lower(meta?.offer_sync_processed)==='true'}
function readEligible(row:any){
  const meta=row?.metadata||{},result=clean(meta.offer_sync_result,160).toUpperCase(),state=lower(meta?.offer_read_sync?.state);
  return row?.direction==='inbound'
    && ['gmail','microsoft'].includes(clean(row?.provider,40))
    && syncProcessed(meta)
    && !!result
    && result!=='PENDING_APPROVAL'
    && result!=='IGNORED_CLOSED_STATUS_CONFLICT'
    && state!=='done';
}
async function gmailReadToken(sb:any,clientId:string,intg:any){
  const scope=clean(intg?.config?.direct_send?.scope,3000);
  if(!scope.includes('https://www.googleapis.com/auth/gmail.modify'))return{scope_required:true,error:'Gmail skal genforbindes med gmail.modify for at markere mails som læst.'};
  const{data:mat,error}=await sb.rpc('get_gmail_oauth_material',{p_client_id:clientId});if(error)throw error;
  const appId=clean(mat?.client_id,500),secret=clean(mat?.client_secret,1000),refresh=clean(mat?.refresh_token,4000);
  if(!appId||!secret||!refresh)throw new Error('Gmail OAuth-materiale mangler');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:appId,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(clean(d?.error_description||d?.error||'Gmail tokenfejl',1000));
  return{access:String(d.access_token)};
}
async function microsoftReadToken(sb:any,clientId:string,intg:any){
  const configured=clean(intg?.config?.oauth?.scope,3000);
  if(!/(^|\s)Mail\.ReadWrite(\s|$)/.test(configured))return{scope_required:true,error:'Microsoft skal genforbindes med Mail.ReadWrite for at markere mails som læst.'};
  const{data:mat,error}=await sb.rpc('crm_get_microsoft_oauth_material',{p_client_id:clientId});if(error)throw error;
  const appId=clean(mat?.client_id,500),secret=clean(mat?.client_secret,1000),refresh=clean(mat?.refresh_token,4000),scope=clean(mat?.scope,3000);
  if(!appId||!secret||!refresh)throw new Error('Microsoft OAuth-materiale mangler');
  const r=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:appId,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token',scope})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error(clean(d?.error_description||d?.error||'Microsoft tokenfejl',1000));
  if(d.refresh_token&&d.refresh_token!==refresh)await sb.rpc('crm_set_microsoft_refresh_token',{p_client_id:clientId,p_refresh_token:d.refresh_token,p_account:mat?.account,p_scope:d.scope||scope});
  return{access:String(d.access_token)};
}
async function markProviderRead(provider:string,access:string,messageId:string){
  if(provider==='gmail'){
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId)+'/modify',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({removeLabelIds:['UNREAD']})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(clean(d?.error?.message||('Gmail mark-read fejlede ('+r.status+')'),1000));return;
  }
  const r=await fetch('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(messageId),{method:'PATCH',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({isRead:true})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(clean(d?.error?.message||('Microsoft mark-read fejlede ('+r.status+')'),1000));
}
async function markHandledRead(sb:any,requestedClientId:string){
  let q=sb.from('crm_mail_messages').select('id,client_id,provider,external_message_id,direction,message_at,metadata').in('provider',['gmail','microsoft']).eq('direction','inbound').gte('message_at',READ_CUTOVER).order('message_at',{ascending:true}).limit(500);
  if(requestedClientId)q=q.eq('client_id',requestedClientId);
  const{data,error}=await q;if(error)throw error;
  const rows=(data||[]).filter(readEligible),groups=new Map<string,any[]>();
  for(const row of rows){const key=row.client_id+'|'+row.provider,a=groups.get(key)||[];a.push(row);groups.set(key,a)}
  const results:any[]=[];
  for(const[key,items]of groups){
    const[clientId,provider]=key.split('|');
    try{
      const{data:intg,error:intError}=await sb.from('crm_integrations').select('status,config').eq('client_id',clientId).eq('provider',provider).order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if(intError)throw intError;
      if(!intg||intg.status!=='connected'){results.push({client_id:clientId,provider,candidates:items.length,marked:0,error:'Mailintegration er ikke forbundet'});continue}
      const token=provider==='gmail'?await gmailReadToken(sb,clientId,intg):await microsoftReadToken(sb,clientId,intg);
      if(token.scope_required){results.push({client_id:clientId,provider,candidates:items.length,marked:0,scope_required:true,error:token.error});continue}
      let marked=0,failed=0;
      for(const row of items){
        try{
          await markProviderRead(provider,token.access,row.external_message_id);
          const now=new Date().toISOString(),meta=row.metadata||{};
          const up=await sb.from('crm_mail_messages').update({metadata:{...meta,offer_read_sync:{state:'done',marked_read_at:now,provider}}}).eq('id',row.id);
          if(up.error)throw up.error;
          marked++;
        }catch(e:any){
          failed++;const now=new Date().toISOString(),meta=row.metadata||{};
          await sb.from('crm_mail_messages').update({metadata:{...meta,offer_read_sync:{state:'error',checked_at:now,error:clean(e?.message||e,1000),provider}}}).eq('id',row.id);
        }
      }
      results.push({client_id:clientId,provider,candidates:items.length,marked,failed});
    }catch(e:any){results.push({client_id:clientId,provider,candidates:items.length,marked:0,error:clean(e?.message||e,1000)})}
  }
  return results;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return out({error:'Method not allowed'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const secret=clean(req.headers.get('x-mail-offer-sync-secret'),500),auth=clean(req.headers.get('Authorization'),5000);
    if(!secret&&!auth)return out({error:'Mangler autorisation'},401);
    if(secret){const{data:expected,error}=await sb.rpc('crm_get_mail_offer_sync_secret');if(error||!expected||!safeEqual(secret,String(expected)))return out({error:'Ugyldig scheduler-autorisation'},401)}
    const rawBody=await req.text();let parsed:any={};try{parsed=rawBody?JSON.parse(rawBody):{}}catch{}
    const clientId=clean(parsed?.client_id,100);
    const headers:any={'Content-Type':'application/json'};if(secret)headers['x-mail-offer-sync-secret']=secret;if(auth)headers['Authorization']=auth;
    const endpoint=url+'/functions/v1/mail-offer-sync';let last:any=null;
    for(let attempt=0;attempt<12;attempt++){
      const r=await fetch(endpoint,{method:'POST',headers,body:rawBody});const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}};last={status:r.status,data};
      const errors=(data?.results||[]).map((x:any)=>clean(x?.error,2000)).filter(Boolean),duplicate=errors.some((x:string)=>/duplicate key value violates unique constraint/i.test(x)),transient=r.status===546||r.status===503||errors.some((x:string)=>/WORKER_RESOURCE_LIMIT|resource limit|temporar/i.test(x));
      if(duplicate){await wait(120);continue}if(transient&&attempt<3){await wait(300*(attempt+1));continue}
      const corrections=r.ok?await postflight(sb,clientId):[];
      const drafts=r.ok?await guardDraftApprovals(sb,url,secret,clientId,data):[];
      const readSync=r.ok?await markHandledRead(sb,clientId):[];
      return out({...data,runner_retries:attempt,postflight_corrections:corrections,draft_ignored:drafts,mail_mark_read:readSync},r.status);
    }
    return out({ok:false,error:'Mail-sync kunne ikke blive idempotent efter gentagne sikre forsøg.',last:last?.data,runner_retries:12},500);
  }catch(e:any){return out({error:e instanceof Error?e.message:String(e)},500)}
});