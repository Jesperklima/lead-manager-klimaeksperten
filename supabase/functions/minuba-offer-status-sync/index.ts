import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-mail-offer-sync-secret','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:any,max=3000)=>String(v??'').trim().slice(0,max);
const norm=(v:any)=>clean(v,500).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const arr=(x:any,keys:string[])=>{if(Array.isArray(x))return x;for(const k of keys)if(Array.isArray(x?.[k]))return x[k];return []};
const rawStatus=(x:any)=>clean(x?.state||x?.status||x?.statusName||x?.offerState||x?.orderState||x?.phase,160);
const numberRefs=(x:any)=>[x?.orderNumber,x?.number,x?.offerNumber,x?.offerNo,x?.offerReference,x?.reference,x?.quotationNumber,x?.quoteNumber].map(norm).filter(Boolean);
const closedCrm=new Set(['VUNDET','TABT','LUKKET – UDSKUDT']);
function errText(e:any){
  if(e instanceof Error&&e.message)return e.message;
  if(e?.message)return String(e.message);
  try{const s=JSON.stringify(e);if(s&&s!=='{}')return s}catch{}
  return String(e??'Ukendt fejl');
}
function safeEqual(a:string,b:string){const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);let d=aa.length^bb.length;for(let i=0;i<Math.max(aa.length,bb.length);i++)d|=(aa[i%Math.max(aa.length,1)]||0)^(bb[i%Math.max(bb.length,1)]||0);return d===0}
function matchesRef(x:any,target:string){if(numberRefs(x).includes(target))return true;const seen=new Set<any>();const walk=(o:any,d=0):boolean=>{if(!o||typeof o!=='object'||d>4||seen.has(o))return false;seen.add(o);for(const [k,v] of Object.entries(o)){if(/offer|quote|quotation/i.test(k)&&['string','number'].includes(typeof v)&&norm(v)===target)return true;if(v&&typeof v==='object'&&walk(v,d+1))return true}return false};return walk(x)}
function plusDaysIso(days:number){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function dkDate(){try{return new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function appendNote(oldValue:any,note:string){const old=clean(oldValue,12000);if(old.includes(note))return old;return clean([old,note].filter(Boolean).join('\n'),12000)}
function addressText(a:any){return [a?.streetAddress||a?.street,a?.streetAddress2,a?.postCode||a?.postalCode,a?.city].filter(Boolean).join(', ')}
const emailList=(v:any)=>[...new Set((clean(v,3000).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map((x:string)=>x.trim()))];
const firstEmail=(v:any)=>emailList(v)[0]||'';
const personalMailDomains=new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.dk','outlook.com','outlook.dk','live.com','live.dk','msn.com','icloud.com','me.com','mac.com','yahoo.com','yahoo.dk','proton.me','protonmail.com','mail.dk','ofir.dk','gmx.com','gmx.de']);
function looksLikePersonName(value:any){
  const name=clean(value,100).replace(/\s+/g,' ');
  if(!name||/[@\d]/.test(name)||/[,&/+]/.test(name)||name===name.toUpperCase())return '';
  if(/\b(?:aps|a\/s|i\/s|ivs|p\/s|amba|holding|kommune|region|service|services|vvs|køl|klima|byg|entreprise|ejendom|ejendomme|hotel|restaurant|skole|center|fonden|forening|group|consult|consulting|solution|solutions|system|systems|bank|forsikring|transport|teknik|auto)\b/i.test(name))return '';
  const parts=name.split(/\s+/).filter(Boolean);
  if(parts.length<2||parts.length>5)return '';
  if(parts.some((part:string)=>!/^[A-Za-zÆØÅæøåÀ-ÖØ-öø-ÿ'’.-]+$/u.test(part)))return '';
  return name;
}
function isPersonalMailbox(value:any){
  const email=firstEmail(value).toLowerCase(),at=email.lastIndexOf('@');
  return at>0&&personalMailDomains.has(email.slice(at+1));
}
const phoneFrom=(v:any)=>{const s=clean(v,500);const m=s.match(/(?:\+45\s*)?(\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/);return m?m[1].replace(/[.-]/g,' ').replace(/\s+/g,' ').trim():''};
function addressContact(a:any,source:string,score=0){
  if(!a||typeof a!=='object')return null;
  const email=firstEmail(a?.email||a?.mail||a?.emailAddress);
  const explicitName=clean(a?.att||a?.contactName||a?.referencePerson||a?.theirref||a?.theirRef,300);
  const name=explicitName||(isPersonalMailbox(email)?looksLikePersonName(a?.name):'');
  const phone=clean(a?.cellPhone||a?.mobile||a?.phone,120);
  if(!name&&!email&&!phone)return null;
  return {name,email,phone,source,score:score+(name?40:0)+(email?60:0)+(phone?5:0),address_id:clean(a?.id,200)};
}
function recordContact(record:any){
  if(!record||typeof record!=='object')return null;
  const directName=clean(record?.theirref||record?.theirRef||record?.contactName||record?.contactPerson?.name||record?.contact?.name,300);
  const directEmail=firstEmail(record?.contactEmail||record?.contactPerson?.email||record?.contact?.email);
  const directPhone=clean(record?.contactPerson?.cellPhone||record?.contactPerson?.phone||record?.contact?.cellPhone||record?.contact?.phone,120);
  const options:any[]=[
    directName||directEmail||directPhone?{name:directName,email:directEmail,phone:directPhone,source:'offer_direct',score:560}:null,
    addressContact(record?.deliveryAddress,'offer_delivery_address',500),
    addressContact(record?.contactAddress,'offer_contact_address',400),
    addressContact(record?.billingAddress,'offer_billing_address',300),
    ...(Array.isArray(record?.addresses)?record.addresses.map((a:any)=>addressContact(a,'offer_address',200)):[])
  ].filter(Boolean);
  options.sort((a,b)=>b.score-a.score);
  return options.find(x=>x.name&&x.email)||options.find(x=>x.email)||options.find(x=>x.name)||options[0]||null;
}
function storedContact(o:any){
  const text=[o?.contact_details,o?.contact_person].filter(Boolean).join(' · ');
  const email=firstEmail(text),phone=phoneFrom(text),name=clean(o?.contact_person,300);
  if(!name&&!email&&!phone)return null;
  return {name,email,phone,source:'stored_offer',score:100};
}
function siblingConsensus(o:any,offers:any[]){
  const byEmail=new Map<string,any>(),byName=new Map<string,any>();
  for(const x of offers){
    if(x?.id===o?.id||!o?.company_id||x?.company_id!==o.company_id)continue;
    const c=recordContact(x?.minuba_raw)||storedContact(x);if(!c)continue;
    const email=clean(c.email,320).toLowerCase(),name=clean(c.name,300).toLowerCase();
    if(email&&!byEmail.has(email))byEmail.set(email,c);
    if(name&&!byName.has(name))byName.set(name,c);
  }
  if(byEmail.size===1)return [...byEmail.values()][0];
  if(byEmail.size===0&&byName.size===1)return [...byName.values()][0];
  return null;
}
function crmConsensus(o:any,contacts:any[]){
  const rows=(contacts||[]).filter((x:any)=>x?.company_id===o?.company_id&&x?.email&&!String(x?.source_type||'').startsWith('smtp_bounced'));
  const unique=new Map<string,any>();for(const x of rows){const e=clean(x.email,320).toLowerCase();if(e&&!unique.has(e))unique.set(e,x)}
  if(unique.size!==1)return null;
  const x=[...unique.values()][0];return{name:clean(x.full_name,300),email:clean(x.email,320),phone:clean(x.phone,120),source:'crm_contact',score:80};
}
function liveClientContact(record:any,clientRows:any[]){
  const clientId=clean(record?.clientId||record?.client?.id,200);if(!clientId)return null;
  const client=(clientRows||[]).find((x:any)=>clean(x?.id,200)===clientId);if(!client)return null;
  const addresses=Array.isArray(client?.addresses)?client.addresses:[];if(!addresses.length)return null;
  const ids=[record?.deliveryAddressId,record?.contactAddressId,record?.billingAddressId,record?.client?.lastUsedDeliveryAddressId,record?.client?.lastUsedContactAddressId,record?.client?.lastUsedBillingAddressId].map((x:any)=>clean(x,200)).filter(Boolean);
  for(const id of ids){const a=addresses.find((x:any)=>clean(x?.id,200)===id);const c=addressContact(a,'client_exact_address',350);if(c&&(c.email||c.name))return c}
  const refAddress=record?.deliveryAddress||record?.contactAddress||record?.billingAddress||null;
  if(refAddress){
    const street=norm(refAddress?.streetAddress||refAddress?.street),post=norm(refAddress?.postCode||refAddress?.postalCode),city=norm(refAddress?.city);
    const same=addresses.find((a:any)=>(!street||norm(a?.streetAddress||a?.street)===street)&&(!post||norm(a?.postCode||a?.postalCode)===post)&&(!city||norm(a?.city)===city));
    const c=addressContact(same,'client_matching_address',300);if(c&&(c.email||c.name))return c;
  }
  const viable=addresses.map((a:any)=>addressContact(a,'client_address',150)).filter((x:any)=>x?.email);
  const unique=new Map<string,any>();for(const x of viable){const e=clean(x.email,320).toLowerCase();if(e&&!unique.has(e))unique.set(e,x)}
  return unique.size===1?[...unique.values()][0]:null;
}
function bestContact(record:any,o:any,offers:any[],clientRows:any[],contacts:any[]){
  const embedded=recordContact(record);if(embedded?.email||embedded?.name)return embedded;
  const live=liveClientContact(record,clientRows);if(live?.email||live?.name)return live;
  const sibling=siblingConsensus(o,offers);if(sibling?.email||sibling?.name)return sibling;
  const crm=crmConsensus(o,contacts);if(crm?.email||crm?.name)return crm;
  return null;
}
function proposalInfo(p:any){const ca=p?.contactAddress||{},da=p?.deliveryAddress||ca,cl=p?.client||{},best=recordContact(p),email=clean(best?.email||ca?.email||cl?.email,300),phone=clean(best?.phone||ca?.cellPhone||ca?.phone,120),customer=clean(cl?.name||ca?.name,300),u=clean(p?.updated||p?.created,80);return{ref:clean(p?.orderNumber||p?.number,160),customer,cvr:clean(cl?.cvr||p?.cvr,40),contact:clean(best?.name||p?.theirref||ca?.att||(isPersonalMailbox(email)?looksLikePersonName(customer):''),300),details:clean([email,phone].filter(Boolean).join(' · '),700),address:clean(addressText(da),700),sent:/^\d{4}-\d{2}-\d{2}/.test(u)?u.slice(0,10):new Date().toISOString().slice(0,10)}}
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
  async function apiGet(path:string,params:Record<string,string>={}){
    const once=async()=>{const q=new URLSearchParams(params);const r=await fetch('https://app.minuba.dk/api/1/'+path+(q.toString()?'?'+q.toString():''),{headers:{Accept:'application/json',Authorization:'Bearer '+accessToken}});return{r,t:await r.text()}};
    let z=await once();if(z.r.status===401){await refreshAccess();z=await once()}let data:any={};try{data=JSON.parse(z.t)}catch{}if(!z.r.ok)throw new Error(`Minuba ${path} fejlede: HTTP ${z.r.status}`);return data;
  }
  async function getState(state:string){const data=await apiGet('Order',{state,forAllUsers:'true',include:'client,addresses'});return arr(data,['orders','Orders','data']).filter((x:any)=>!/draft|kladde/i.test(rawStatus(x)))}
  const states=['proposal','new','started','delayed','completed','closed'];const buckets:any={};for(const s of states)buckets[s]=await getState(s);
  let clientRows:any[]=[];try{const data=await apiGet('Client',{include:'addresses'});clientRows=arr(data,['clients','Clients','data'])}catch(e){console.warn('Minuba Client-adresser kunne ikke hentes',errText(e))}
  const {data:offers,error:oe}=await admin.from('crm_offers').select('*').eq('client_id',clientId);if(oe)throw oe;
  const {data:companies,error:ce}=await admin.from('crm_companies').select('*').eq('client_id',clientId);if(ce)throw ce;
  const {data:contacts}=await admin.from('crm_contacts').select('company_id,full_name,email,phone,source_type,verified,confidence').eq('client_id',clientId);
  const {data:users}=await admin.from('crm_users').select('email,role').eq('client_id',clientId).eq('active',true);
  const owner=(users||[]).find((u:any)=>['owner','admin'].includes(String(u.role||'').toLowerCase()))?.email||(users||[])[0]?.email||null;
  const offerRows:any[]=[...(offers||[])],companyRows:any[]=[...(companies||[])],existingRefs=new Set(offerRows.map((o:any)=>norm(o.offer_ref)).filter(Boolean));let createdMissing=0;
  for(const p of buckets.proposal||[]){
    const info=proposalInfo(p),ref=norm(info.ref);if(!ref||existingRefs.has(ref))continue;
    let company=companyRows.find((x:any)=>info.cvr&&clean(x.cvr,40)===info.cvr)||companyRows.find((x:any)=>norm(x.name)===norm(info.customer));
    if(!company&&info.customer){const ins=await admin.from('crm_companies').insert({client_id:clientId,name:info.customer,cvr:info.cvr||null,address:info.address||null,minuba_relationship_status:'existing_customer',minuba_exact_match:true,minuba_checked_at:new Date().toISOString(),minuba_raw:p}).select('*').single();if(ins.error)throw ins.error;company=ins.data;companyRows.push(company)}
    if(!company)continue;
    const nowCreate=new Date().toISOString(),st=rawStatus(p)||'PROPOSAL';
    const row:any={client_id:clientId,company_id:company.id,offer_ref:info.ref,customer_name:info.customer||company.name,sent_date:info.sent,follow_up_date:plusDaysIso(7),follow_up_owner:owner,status:'I GANG',status_source:'minuba',status_reason:'Oprettet automatisk fra aktivt tilbud i Minuba.',status_updated_at:nowCreate,current_comment:`${dkDate()}: Oprettet automatisk fra aktivt Minuba-tilbud og lagt til opfølgning.`,contact_person:info.contact||null,contact_details:info.details||null,installation_address:info.address||null,minuba_status:st,minuba_record_type:'proposal',minuba_last_checked_at:nowCreate,minuba_last_seen_at:nowCreate,minuba_sync_state:'active',minuba_raw:p,raw:{created_from_minuba_status_sync:true}};
    const ins=await admin.from('crm_offers').insert(row).select('*').single();if(ins.error)throw ins.error;offerRows.push(ins.data);existingRefs.add(ref);createdMissing++;await log(admin,ins.data,`Tilbud ${info.ref} oprettet automatisk fra aktivt Minuba-tilbud.`,{status:'I GANG',minuba_status:st,created_from_minuba:true});
  }
  let contactBackfilled=0,contactUnresolved=0;
  const allRecords=[...states.flatMap((s:string)=>buckets[s]||[])];
  for(const o of offerRows){
    const missingName=!clean(o.contact_person,300),missingDetails=!firstEmail(o.contact_details);
    if(!missingName&&!missingDetails)continue;
    const target=norm(o.offer_ref),record=allRecords.find((x:any)=>matchesRef(x,target))||o.minuba_raw||null;
    let candidate=bestContact(record,o,offerRows,clientRows,contacts||[]);
    if(!candidate){
      const embeddedEmail=firstEmail(o.contact_person),embeddedPhone=phoneFrom(o.contact_person);
      if(embeddedEmail||embeddedPhone)candidate={name:'',email:embeddedEmail,phone:embeddedPhone,source:'contact_person_embedded'};
    }
    const patch:any={};
    if(missingName&&candidate?.name)patch.contact_person=clean(candidate.name,300);
    if(missingDetails&&candidate?.email)patch.contact_details=clean([candidate.email,candidate.phone].filter(Boolean).join(' · '),700);
    if(Object.keys(patch).length){patch.updated_at=new Date().toISOString();const {error}=await admin.from('crm_offers').update(patch).eq('id',o.id);if(error)throw error;Object.assign(o,patch);contactBackfilled++}
    if(!clean(o.contact_person,300)&&!firstEmail(o.contact_details))contactUnresolved++;
  }
  const candidates=offerRows.filter((o:any)=>o.offer_ref&&!closedCrm.has(o.status)&&(o.status!=='LUKKET'||o.status_source==='minuba'));
  const now=new Date().toISOString();let active=0,won=0,closed=0,reopened=0,missingOnce=0,unlinked=0,manual=0;
  for(const o of candidates){
    const target=norm(o.offer_ref),proposal=(buckets.proposal||[]).find((x:any)=>matchesRef(x,target));let order:any=null,orderState='';
    if(!proposal){for(const s of states.slice(1)){const x=(buckets[s]||[]).find((z:any)=>matchesRef(z,target));if(x){order=x;orderState=s;break}}}
    if(proposal){
      const prev=o.status,wasClosed=prev==='LUKKET',status=rawStatus(proposal)||'proposal';
      const resolvedContact=bestContact(proposal,o,offerRows,clientRows,contacts||[]);
      const patch:any={minuba_status:status,minuba_record_type:'proposal',minuba_order_number:null,minuba_last_checked_at:now,minuba_last_seen_at:now,minuba_sync_state:'active',minuba_raw:proposal,updated_at:now};
      if(!clean(o.contact_person,300)&&resolvedContact?.name)patch.contact_person=clean(resolvedContact.name,300);
      if(!firstEmail(o.contact_details)&&resolvedContact?.email)patch.contact_details=clean([resolvedContact.email,resolvedContact.phone].filter(Boolean).join(' · '),700);
      if(!o.manual_lock&&wasClosed){patch.status='I GANG';patch.status_source='minuba';patch.status_reason='Tilbuddet er aktivt igen i Minuba.';patch.status_updated_at=now;patch.follow_up_date=plusDaysIso(7);patch.current_comment=appendNote(o.current_comment,`${dkDate()}: Genåbnet automatisk, fordi tilbuddet igen er aktivt i Minuba.`)}
      const {error}=await admin.from('crm_offers').update(patch).eq('id',o.id);if(error)throw error;active++;
      if(wasClosed&&!o.manual_lock){await ensureTask(admin,o,patch.follow_up_date,now);await log(admin,o,`Tilbud ${o.offer_ref} genåbnet: aktivt igen i Minuba.`,{previous_status:prev,status:'I GANG',minuba_status:status});reopened++}else if(o.manual_lock)manual++;
      continue;
    }
    if(order){
      const orderNo=clean(order?.orderNumber||order?.number,160),status=rawStatus(order)||orderState,prev=o.status;
      const resolvedContact=bestContact(order,o,offerRows,clientRows,contacts||[]);
      const patch:any={minuba_status:status,minuba_record_type:'order',minuba_order_number:orderNo||null,minuba_last_checked_at:now,minuba_last_seen_at:now,minuba_sync_state:'converted_to_order',minuba_raw:order,updated_at:now};
      if(!clean(o.contact_person,300)&&resolvedContact?.name)patch.contact_person=clean(resolvedContact.name,300);
      if(!firstEmail(o.contact_details)&&resolvedContact?.email)patch.contact_details=clean([resolvedContact.email,resolvedContact.phone].filter(Boolean).join(' · '),700);
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
  return {client_id:clientId,checked:candidates.length,total_offers:offerRows.length,created_missing:createdMissing,contact_backfilled:contactBackfilled,contact_unresolved:contactUnresolved,active,won,closed,reopened,missing_once:missingOnce,unlinked,manual_locked:manual};
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
    const results=[];for(const id of clientIds){try{results.push(await clientRunner(admin,id))}catch(e){const msg=errText(e);await admin.from('crm_integrations').update({last_error:clean(msg,1000),updated_at:new Date().toISOString()}).eq('client_id',id).eq('provider','minuba');results.push({client_id:id,error:msg})}}
    const failures=results.filter((x:any)=>x?.error);
    return json({ok:failures.length===0,results},failures.length?207:200);
  }catch(e){console.error(e);return json({error:e instanceof Error?e.message:String(e)},500)}
});