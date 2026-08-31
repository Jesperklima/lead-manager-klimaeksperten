import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const str=(v:unknown,n=1000)=>String(v??'').trim().slice(0,n);
const arr=(v:unknown,n=50)=>Array.isArray(v)?v.map(x=>str(x,300)).filter(Boolean).slice(0,n):[];
const uniq=(a:string[])=>[...new Set(a.map(x=>x.trim()).filter(Boolean))];
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const urlOk=(v:string)=>!v||/^https?:\/\//i.test(v)||/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(v);
const num=(v:unknown)=>{if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)return json({error:'Mangler login-token',code:'NO_TOKEN'},401);
  const body=await req.json().catch(()=>({})),action=str(body.action||'status',40),url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ud,error:ue}=await admin.auth.getUser(token);const user=ud?.user;if(ue||!user?.id||!user.email)return json({error:'Ugyldigt eller udløbet login',code:'INVALID_LOGIN'},401);if(!user.email_confirmed_at)return json({error:'E-mailen skal være bekræftet',code:'EMAIL_NOT_CONFIRMED'},403);
  const {data:members,error:me}=await admin.from('crm_users').select('client_id,email,role,active,auth_user_id').eq('active',true).eq('auth_user_id',user.id);if(me)throw me;const member=members?.[0];if(!member)return json({error:'Denne bruger er ikke knyttet til en Lead Manager-konto',code:'NO_MEMBERSHIP'},403);
  const clientId=member.client_id;let {data:limits}=await admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle();if(!limits){const p=await admin.rpc('crm_apply_plan',{p_client_id:clientId,p_plan_code:'start'});if(p.error)throw p.error;const q=await admin.from('crm_usage_limits').select('*').eq('client_id',clientId).single();if(q.error)throw q.error;limits=q.data}
  const {data:client,error:ce}=await admin.from('crm_clients').select('*').eq('id',clientId).single();if(ce||!client)return json({error:'Kundeprofilen blev ikke fundet'},404);
  if(action==='status')return json({ok:true,client,membership:{role:member.role,email:user.email},plan:limits});
  if(!['owner','admin'].includes(String(member.role||'').toLowerCase()))return json({error:'Kun ejer/admin kan ændre onboardingprofilen',code:'ROLE_FORBIDDEN'},403);
  if(action==='save_progress'){
    const step=Math.max(1,Math.min(12,Number(body.step||1))),draft=body.draft&&typeof body.draft==='object'?body.draft:{};const settings=client.settings||{};
    const {error}=await admin.from('crm_clients').update({settings:{...settings,saas:{...(settings.saas||{}),onboarding_version:'saas_v2',onboarding_step:step,onboarding_draft:draft,onboarding_last_saved_at:new Date().toISOString()}}}).eq('id',clientId);if(error)throw error;return json({ok:true,step});
  }
  if(action!=='complete')return json({error:'Ukendt handling'},400);
  const companyName=str(body.company_name,240),website=str(body.website,600),cvr=str(body.cvr,40),phone=str(body.phone,100),address=str(body.address,400),postcode=str(body.postcode,20),city=str(body.city,120),contactName=str(body.contact_name,240),businessEmail=str(body.business_email||user.email,320).toLowerCase();
  const services=uniq(arr(body.services)),industries=uniq(arr(body.industries)),leadModes=uniq(arr(body.lead_modes)).filter(x=>['company_targets','documented_need','projects','tenders'].includes(x)),taskTypes=uniq(arr(body.task_types)),customerTypes=uniq(arr(body.customer_types)),idealSignals=uniq(arr(body.ideal_signals)),exclusions=uniq(arr(body.exclusions)),geographyValues=uniq(arr(body.geography_values));
  const geographyMode=str(body.geography_mode||'denmark',40),mailProvider=str(body.mail_provider||'',30).toLowerCase(),employeeMin=num(body.employee_min),employeeMax=num(body.employee_max),projectMin=num(body.project_value_min),projectMax=num(body.project_value_max);
  if(companyName.length<2)return json({error:'Virksomhedsnavn mangler'},400);if(!emailOk(businessEmail))return json({error:'Virksomhedsmailen er ugyldig'},400);if(!urlOk(website))return json({error:'Hjemmesiden er ugyldig'},400);if(!services.length)return json({error:'Angiv mindst én ydelse eller et produkt I sælger'},400);if(!industries.length)return json({error:'Vælg mindst én branche I ønsker leads fra'},400);if(!leadModes.length)return json({error:'Vælg mindst én type leads'},400);if(leadModes.includes('tenders')&&limits.plan_code!=='business'&&limits.plan_code!=='internal')return json({error:'Udbudssøgning kræver Business-pakken',code:'PLAN_TENDER_DISABLED'},403);if(employeeMin!=null&&employeeMax!=null&&employeeMin>employeeMax)return json({error:'Minimum ansatte kan ikke være større end maksimum'},400);if(projectMin!=null&&projectMax!=null&&projectMin>projectMax)return json({error:'Minimum projektværdi kan ikke være større end maksimum'},400);if(!['google','microsoft'].includes(mailProvider))return json({error:'Vælg Google/Gmail eller Microsoft 365/Outlook som mailplatform'},400);
  const geographyText=geographyMode==='denmark'?'Danmark':geographyValues.join(', ');if(geographyMode!=='denmark'&&!geographyValues.length)return json({error:'Angiv mindst ét geografisk område'},400);

  if(mailProvider==='microsoft'){
    const {data:ms,error:msError}=await admin.rpc('crm_get_microsoft_status',{p_client_id:clientId});if(msError)throw msError;
    const connectedAccount=String(ms?.account||'').trim().toLowerCase(),scope=String(ms?.scope||''),requiresRead=!!limits?.allow_mail_monitor;
    if(!ms?.ready)return json({error:'Microsoft 365 / Outlook skal forbindes, før onboarding kan afsluttes.',code:'MICROSOFT_NOT_CONNECTED'},412);
    if(connectedAccount!==businessEmail)return json({error:`Den forbundne Microsoft-konto (${connectedAccount||'ingen'}) matcher ikke virksomhedsmailen (${businessEmail}).`,code:'MICROSOFT_ACCOUNT_MISMATCH'},412);
    if(requiresRead&&!scope.includes('Mail.Read'))return json({error:'Denne pakke kræver Mail.Read for at kunne følge mailsvar. Forbind Microsoft igen og godkend læseadgangen.',code:'MICROSOFT_READ_SCOPE_REQUIRED'},412);
    if(!scope.includes('Mail.Send'))return json({error:'Microsoft-forbindelsen mangler Mail.Send. Forbind Microsoft igen og godkend mailafsendelse.',code:'MICROSOFT_SEND_SCOPE_REQUIRED'},412);
  }

  const now=new Date().toISOString(),settings=client.settings||{},combinedCapabilities=uniq([...services,...taskTypes]);
  const searchProfile={version:'lead_search_v2',industries,lead_modes:leadModes,task_types:taskTypes,customer_types:customerTypes,employee_range:{min:employeeMin,max:employeeMax},project_value_dkk:{min:projectMin,max:projectMax},ideal_signals:idealSignals,geography:{mode:geographyMode,values:geographyValues,text:geographyText},exclusions,mail_provider:mailProvider};
  const newSettings={...settings,mail:businessEmail,phone:phone||null,contact_name:contactName||null,company_address:address||null,postcode:postcode||null,city:city||null,mail_provider:mailProvider,customer_types:customerTypes,exclude_types:exclusions,lead_search_profile:searchProfile,default_timezone:settings.default_timezone||'Europe/Copenhagen',saas:{...(settings.saas||{}),onboarding_completed:true,onboarding_completed_at:now,onboarding_version:'saas_v2',onboarding_step:12,onboarding_draft:null,lead_hunter_enabled:true,lead_hunter_started_at:now},capability_profile:{version:'customer_onboarding_v2',configured_at:now,source:'self_service_onboarding',lead_trigger_capabilities:combinedCapabilities,documented_segments:uniq([...industries,...customerTypes]),supporting_capabilities:idealSignals,hard_exclusions:exclusions,search_strategy:searchProfile,verification_policy:'Kundens onboardingprofil er autoritativ. Find kun leads der matcher valgte leadtyper, brancher, geografi, størrelsesgrænser og fravalg. Gæt ikke på medarbejderantal, opgaveværdi eller købssignaler.'}};
  const {data:updated,error:updateError}=await admin.from('crm_clients').update({name:companyName,website:website||null,cvr:cvr||null,geography:geographyText,services,settings:newSettings}).eq('id',clientId).select('*').single();if(updateError)throw updateError;
  await admin.from('crm_activities').insert({client_id:clientId,type:'Onboarding',actor_type:'user',actor_name:user.email,summary:'Selvbetjent onboarding færdiggjort og Lead Hunter-profil aktiveret',metadata:{onboarding_version:'saas_v2',plan_code:limits.plan_code,industries,lead_modes:leadModes,employee_min:employeeMin,employee_max:employeeMax,project_value_min:projectMin,project_value_max:projectMax,mail_provider:mailProvider}});
  await admin.from('crm_agent_requests').insert({client_id:clientId,request_type:'lead_manager_command',request_text:'Onboarding er færdig. Valider kundens Lead Hunter-profil og klargør første leadkørsel uden at ændre kundens kriterier.',status:'queued',payload:{source:'saas_onboarding_v2',action:'validate_onboarding_profile'},created_by:user.email});
  return json({ok:true,client:updated,plan:limits,onboarding_completed:true,search_profile:searchProfile});
 }catch(err){console.error(err);return json({error:err instanceof Error?err.message:String(err),code:'INTERNAL_ERROR'},500)}
});
