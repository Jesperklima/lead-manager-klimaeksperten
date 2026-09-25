import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json; charset=utf-8"};
const resp=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Cache-Control":"no-store"}});
const clean=(v:any,max=3000)=>String(v??'').trim().slice(0,max);
const norm=(v:any)=>clean(v,500).toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const arr=(x:any,keys:string[])=>{if(Array.isArray(x))return x;for(const k of keys)if(Array.isArray(x?.[k]))return x[k];return []};
const dateOnly=(v:any)=>{const s=clean(v,80);if(!s)return null;const m=s.match(/^\d{4}-\d{2}-\d{2}/);return m?m[0]:null};
const addressText=(a:any)=>[a?.name,a?.streetAddress,a?.street,a?.streetAddress2,a?.postCode,a?.postalCode,a?.city,a?.country].filter(Boolean).join(', ');
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
const TOKEN_URL='https://auth.minuba.dk/oauth2/token',API_BASE='https://app.minuba.dk/api/1/';

function explicitOfferRefs(x:any){
  return [x?.offerNumber,x?.offerNo,x?.offerReference,x?.reference,x?.quotationNumber,x?.quoteNumber].map(norm).filter(Boolean);
}
function numberRefs(x:any){return [x?.orderNumber,x?.number,...explicitOfferRefs(x)].map(norm).filter(Boolean)}
function matchesRef(x:any,target:string){
  if(numberRefs(x).includes(target))return true;
  const seen=new Set<any>();
  const walk=(o:any,depth=0):boolean=>{
    if(!o||typeof o!=='object'||depth>4||seen.has(o))return false;
    seen.add(o);
    for(const [k,v] of Object.entries(o)){
      if(/offer|quote|quotation/i.test(k)&&['string','number'].includes(typeof v)&&norm(v)===target)return true;
      if(v&&typeof v==='object'&&walk(v,depth+1))return true;
    }
    return false;
  };
  return walk(x);
}
function rawStatus(x:any){return clean(x?.state||x?.status||x?.statusName||x?.offerState||x?.orderState||x?.phase,160)}
function crmStatus(recordType:string,status:string){
  const s=norm(status);
  if(recordType==='proposal'||s==='proposal')return 'I GANG';
  if(recordType==='order')return 'VUNDET';
  if(/accepted|approved|won|converted|accepteret|godkendt/.test(s))return 'VUNDET';
  if(/rejected|declined|lost|cancelled|canceled|afvist|tabt/.test(s))return 'TABT';
  if(/paused|delayed|postponed|onhold|udskudt/.test(s))return 'PÅ PAUSE';
  if(/active|open|sent|started|pending|offered|proposal/.test(s))return 'I GANG';
  return null;
}
function contactAddressFor(record:any){
  const addresses=Array.isArray(record?.addresses)?record.addresses:[];
  return record?.contactAddress||addresses.find((a:any)=>String(a?.addressType||'').toUpperCase()==='CONTACT')||record?.billingAddress||record?.deliveryAddress||addresses[0]||{};
}
function installationAddressFor(record:any){
  const addresses=Array.isArray(record?.addresses)?record.addresses:[];
  return record?.deliveryAddress||addresses.find((a:any)=>String(a?.addressType||'').toUpperCase()==='DELIVERY')||record?.contactAddress||record?.billingAddress||addresses[0]||{};
}
function optionsFromAddress(a:any,source='address'){
  if(!a||typeof a!=='object')return [];
  const phone=clean(a?.cellPhone||a?.phone,120);
  return emailList(a?.email).map(email=>{
    const explicitName=clean(a?.att||a?.contactName||a?.referencePerson||a?.theirref||a?.theirRef,300);
    const name=explicitName||(isPersonalMailbox(email)?looksLikePersonName(a?.name):'');
    return {name,email,phone,source,address_id:clean(a?.id,200),address_type:clean(a?.addressType,80)};
  });
}
function dedupeOptions(items:any[]){
  const seen=new Set<string>(),out:any[]=[];
  for(const x of items){
    const email=clean(x?.email,320),name=clean(x?.name,300),phone=clean(x?.phone,120);
    if(!email)continue;
    const key=email.toLowerCase()+'|'+name.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);out.push({...x,email,name,phone});
  }
  return out;
}
function extract(record:any,recordType:'proposal'|'order',ref:string){
  const client=record?.client||record?.customer||{};
  const installationAddress=installationAddressFor(record);
  const contactAddress=contactAddressFor(record);
  const contact=record?.contactPerson||record?.contact||{};
  const status=rawStatus(record);
  const directEmails=emailList(contact?.email||record?.contactEmail||client?.email);
  const directPerson=clean(contact?.name||record?.contactName||record?.theirref||record?.theirRef,300);
  const directPhone=clean(contact?.cellPhone||contact?.phone,120);
  const addresses=Array.isArray(record?.addresses)?record.addresses:[];
  const addressOptions=dedupeOptions([
    ...optionsFromAddress(record?.deliveryAddress,'offer_delivery_address'),
    ...optionsFromAddress(record?.contactAddress,'offer_contact_address'),
    ...optionsFromAddress(record?.billingAddress,'offer_billing_address'),
    ...addresses.flatMap((a:any)=>optionsFromAddress(a,'offer_address'))
  ]);
  const contactOptions=dedupeOptions([
    ...directEmails.map(email=>({name:directPerson,email,phone:directPhone,source:'offer_direct'})),
    ...addressOptions
  ]);
  const primary=
    contactOptions.find(x=>x.source==='offer_delivery_address'&&x.name&&x.email)||
    contactOptions.find(x=>x.name&&x.email)||
    contactOptions.find(x=>x.source==='offer_delivery_address'&&x.email)||
    contactOptions[0]||null;
  const contactEmails=[...new Set([...directEmails,...contactOptions.map((x:any)=>clean(x?.email,320)).filter(Boolean)])];
  const selectedEmail=clean(primary?.email||contactEmails[0],320);
  const customerName=clean(client?.name||record?.clientName||record?.customerName||contactAddress?.name,300);
  const selectedPerson=clean(primary?.name||directPerson||contactAddress?.att||installationAddress?.att||(isPersonalMailbox(selectedEmail)?looksLikePersonName(customerName):''),300);
  const contactPhone=clean(primary?.phone||directPhone||installationAddress?.cellPhone||installationAddress?.phone||contactAddress?.cellPhone||contactAddress?.phone,120);
  return{
    found:true,
    record_type:recordType,
    offer_ref:recordType==='proposal'?clean(record?.orderNumber||record?.number||ref,160):clean(record?.offerNumber||record?.offerNo||record?.offerReference||ref,160),
    status_raw:status,
    crm_status:crmStatus(recordType,status),
    order_number:recordType==='order'?clean(record?.orderNumber||record?.number,160):'',
    customer_name:customerName,
    cvr:clean(client?.cvr||record?.cvr,40),
    installation_address:clean(addressText(installationAddress),700),
    sent_date:dateOnly(record?.sentDate||record?.offerDate||record?.date||record?.created||record?.updated),
    contact_person:selectedPerson,
    contact_email:selectedEmail,
    contact_emails:contactEmails,
    contact_phone:contactPhone,
    contact_details:clean([selectedEmail,contactPhone].filter(Boolean).join(' · ')||record?.contactDetails,700),
    contact_options:contactOptions,
    minuba_id:clean(record?.id,200),
    raw:record
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return resp({error:'Method not allowed'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,sk=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,sb=createClient(url,sk,{auth:{persistSession:false,autoRefreshToken:false}});
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    const {data:ud,error:ue}=await sb.auth.getUser(token),user=ud?.user;
    if(ue||!user?.id)return resp({error:'Ugyldigt login'},401);
    const body=await req.json().catch(()=>({})),clientId=clean(body.client_id,100),ref=clean(body.offer_ref,160),target=norm(ref);
    if(!clientId||!target)return resp({error:'client_id og offer_ref er påkrævet'},400);
    const [{data:member,error:me},{data:limits},{data:storedOffer}]=await Promise.all([
      sb.from('crm_users').select('email,client_id,role,auth_user_id').eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle(),
      sb.from('crm_usage_limits').select('allow_minuba').eq('client_id',clientId).maybeSingle(),
      sb.from('crm_offers').select('contact_person,contact_details').eq('client_id',clientId).eq('offer_ref',ref).order('updated_at',{ascending:false}).limit(1).maybeSingle()
    ]);
    if(me)throw me;
    if(!member)return resp({error:'Ingen adgang',code:'NO_CLIENT_ACCESS'},403);
    if(limits?.allow_minuba===false)return resp({found:false,skipped:true,code:'PLAN_MINUBA_DISABLED'});

    async function tenantSecret(kind:string){const {data,error}=await sb.rpc('get_minuba_oauth_secret_for_service',{p_client_id:clientId,p_kind:kind});if(error)throw error;return String(data||'')}
    let accessToken=await tenantSecret('access_token'),refreshToken=await tenantSecret('refresh_token');
    const {data:platform,error:pe}=await sb.from('crm_integrations').select('client_id,config').eq('provider','minuba').eq('config->>is_platform_oauth_client','true').limit(1).maybeSingle();
    if(pe)throw pe;
    if(!platform?.client_id)return resp({found:false,skipped:true,code:'PLATFORM_OAUTH_NOT_CONFIGURED'});
    const [{data:oauthClientId,error:c1},{data:oauthClientSecret,error:c2}]=await Promise.all([
      sb.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_id'}),
      sb.rpc('get_minuba_oauth_secret_for_service',{p_client_id:platform.client_id,p_kind:'client_secret'})
    ]);
    if(c1||c2)throw c1||c2;
    if(!accessToken||!refreshToken)return resp({found:false,skipped:true,code:'MINUBA_OAUTH_MISSING'});
    if(!oauthClientId||!oauthClientSecret)return resp({found:false,skipped:true,code:'PLATFORM_CREDENTIALS_MISSING'});
    const {data:conn}=await sb.from('crm_oauth_connections').select('token_expires_at,scope').eq('client_id',clientId).eq('provider','minuba').maybeSingle();
    async function refreshAccess(){
      const r=await fetch(String((platform.config||{}).oauth_token_url||TOKEN_URL),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','Authorization':'Basic '+btoa(`${String(oauthClientId)}:${String(oauthClientSecret)}`)},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken})});
      const raw=await r.text();let j:any={};try{j=JSON.parse(raw)}catch{}
      if(!r.ok||!j.access_token){const e:any=new Error('Minuba OAuth refresh fejlede: HTTP '+r.status);e.httpStatus=r.status;throw e}
      accessToken=String(j.access_token);refreshToken=String(j.refresh_token||refreshToken);
      const exp=new Date(Date.now()+Number(j.expires_in||3599)*1000).toISOString();
      const {error}=await sb.rpc('set_minuba_oauth_tokens',{p_client_id:clientId,p_access_token:accessToken,p_refresh_token:refreshToken,p_expires_at:exp,p_scope:String(j.scope||conn?.scope||'Administrator')});if(error)throw error;
    }
    if(conn?.token_expires_at&&new Date(conn.token_expires_at).getTime()<=Date.now()+60000)await refreshAccess();
    async function mg(path:string,params:Record<string,string>={}){
      const q=new URLSearchParams(params);
      const once=async()=>{const r=await fetch(API_BASE+path+(q.toString()?'?'+q.toString():''),{headers:{Accept:'application/json',Authorization:'Bearer '+accessToken}});return{r,t:await r.text()}};
      let z=await once();if(z.r.status===401){await refreshAccess();z=await once()}
      let data:any={};try{data=JSON.parse(z.t)}catch{}
      return{ok:z.r.ok,status:z.r.status,data};
    }

    const attempts:any[]=[];
    async function finalize(record:any,recordType:'proposal'|'order'){
      const result:any=extract(record,recordType,ref);
      const storedPerson=clean(storedOffer?.contact_person,300),storedEmail=firstEmail(storedOffer?.contact_details);
      if(!result.contact_person&&storedPerson)result.contact_person=storedPerson;
      if(!result.contact_email&&storedEmail){result.contact_email=storedEmail;result.contact_details=clean([storedEmail,result.contact_phone].filter(Boolean).join(' · '),700)}

      if(!result.contact_person||!result.contact_email){
        const clientKey=clean(record?.clientId||record?.client?.id,200);
        if(clientKey){
          const clientsResponse=await mg('Client',{include:'addresses'});
          attempts.push({endpoint:'Client',include:'addresses',status:clientsResponse.status});
          if(clientsResponse.ok){
            const clients=arr(clientsResponse.data,['clients','Clients','data']);
            const client=clients.find((x:any)=>String(x?.id||'')===clientKey);
            const addresses=Array.isArray(client?.addresses)?client.addresses:[];
            const offerEmails=new Set((result.contact_emails||[]).map((x:string)=>x.toLowerCase()));
            let options=dedupeOptions(addresses.flatMap((a:any)=>optionsFromAddress(a,'client_address')));
            if(offerEmails.size){
              const matched=options.filter((x:any)=>offerEmails.has(String(x.email).toLowerCase()));
              if(matched.length)options=matched;
            }
            result.contact_options=dedupeOptions([...(result.contact_options||[]),...options]);
            const best=result.contact_options.find((x:any)=>x.name&&x.email&&(!offerEmails.size||offerEmails.has(String(x.email).toLowerCase())))||result.contact_options.find((x:any)=>x.name&&x.email)||null;
            if(best){
              if(!result.contact_person)result.contact_person=clean(best.name,300);
              if(!result.contact_email||offerEmails.has(String(best.email).toLowerCase()))result.contact_email=clean(best.email,320);
              if(!result.contact_phone)result.contact_phone=clean(best.phone,120);
              result.contact_details=clean([result.contact_email,result.contact_phone].filter(Boolean).join(' · '),700);
            }
          }
        }
      }
      return result;
    }

    // Minuba exposes active offers as Order records with state PROPOSAL.
    const proposal=await mg('Order',{state:'proposal',forAllUsers:'true',include:'client,addresses'});
    attempts.push({endpoint:'Order',state:'proposal',status:proposal.status});
    if(proposal.ok){
      const rows=arr(proposal.data,['orders','Orders','data']);
      const exact=rows.find((x:any)=>matchesRef(x,target));
      if(exact){
        const result=await finalize(exact,'proposal');
        await sb.from('crm_integrations').update({status:'connected',last_error:null,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','minuba');
        return resp({...result,attempts});
      }
    }

    // If the proposal is no longer active, look for the same reference as a real order.
    for(const state of ['new','started','delayed','completed','closed']){
      const r=await mg('Order',{state,forAllUsers:'true',include:'client,addresses'});
      attempts.push({endpoint:'Order',state,status:r.status});
      if(!r.ok)continue;
      const rows=arr(r.data,['orders','Orders','data']);
      const exact=rows.find((x:any)=>matchesRef(x,target));
      if(exact){
        const result=await finalize(exact,'order');
        await sb.from('crm_integrations').update({status:'connected',last_error:null,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','minuba');
        return resp({...result,attempts});
      }
    }
    await sb.from('crm_integrations').update({status:'connected',last_error:null,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','minuba');
    return resp({found:false,offer_ref:ref,attempts});
  }catch(e:any){
    console.error(e);
    return resp({error:e instanceof Error?e.message:String(e),code:'MINUBA_OFFER_LOOKUP_ERROR'},e?.httpStatus===401?401:500);
  }
});