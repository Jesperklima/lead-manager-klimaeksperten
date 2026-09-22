import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
const str=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const PROD='https://lead-manager-klimaeksperten.vercel.app';
const INVITE_VALIDITY_DAYS=14;
const LEGAL_MODELS=['self_service_processor','managed_processor','managed_controller_to_controller','joint_controller','hybrid'];
function safeInviteOrigin(v:string){try{const u=new URL(v);if(u.protocol!=='https:')return PROD;if(u.origin===PROD)return PROD;if(/^lead-manager-klimaeksperten-[a-z0-9-]+\.vercel\.app$/i.test(u.hostname))return u.origin;return PROD}catch{return PROD}}
const b64url=(bytes:Uint8Array)=>{let bin='';for(const x of bytes)bin+=String.fromCharCode(x);return btoa(bin).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
const sha256=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const encodedWord=(value:string)=>{const bytes=new TextEncoder().encode(value);let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return '=?UTF-8?B?'+btoa(bin)+'?='};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let createdClientId='',mailSent=false;
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)return json({error:'Mangler login'},401);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ud,error:ue}=await admin.auth.getUser(token);const user=ud?.user;if(ue||!user?.id||!user.email)return json({error:'Ugyldigt login'},401);
  const {data:members,error:me}=await admin.from('crm_users').select('client_id,role,email').eq('auth_user_id',user.id).eq('active',true);if(me)throw me;
  let internal:any=null;for(const m of members||[]){const {data:l}=await admin.from('crm_usage_limits').select('plan_code').eq('client_id',m.client_id).maybeSingle();if(l?.plan_code==='internal'&&['owner','admin'].includes(String(m.role||'').toLowerCase())){internal=m;break}}
  if(!internal)return json({error:'Kun intern ejer/admin kan invitere kunder',code:'ADMIN_ONLY'},403);
  const body=await req.json().catch(()=>({}));
  if(body.action==='reissue'){
    const clientId=str(body.client_id,100),email=str(body.email,320).toLowerCase();
    if(!clientId||!emailOk(email))return json({error:'Vælg virksomhed og e-mail'},400);
    const rawToken=b64url(crypto.getRandomValues(new Uint8Array(32)));
    const result=await admin.rpc('crm_issue_onboarding_invite',{p_client_id:clientId,p_email:email,p_token_hash:await sha256(rawToken),p_expires_at:new Date(Date.now()+INVITE_VALIDITY_DAYS*86400000).toISOString(),p_actor_id:user.id,p_actor_email:user.email});
    if(result.error)throw result.error;
    return json({ok:true,...result.data,sent:false,invite_link:PROD+'/api/app?onboarding='+encodeURIComponent(rawToken)});
  }
  const companyName=str(body.company_name,240),recipientName=str(body.recipient_name,240),email=str(body.email,320).toLowerCase(),plan=str(body.plan_code||'start',20).toLowerCase(),serviceModel='self_service_processor';
  if(companyName.length<2)return json({error:'Virksomhedsnavn mangler'},400);
  if(!emailOk(email))return json({error:'Ugyldig e-mail'},400);
  if(!['start','pro','business'].includes(plan))return json({error:'Ugyldig pakke'},400);
  const {data:legalDef,error:ldErr}=await admin.rpc('crm_legal_model_definition',{p_service_model:serviceModel});if(ldErr||!legalDef)throw ldErr||new Error('Servicemodellen kunne ikke klassificeres');
  const {data:existing}=await admin.from('crm_users').select('client_id,email,active').ilike('email',email).eq('active',true).limit(1);if(existing?.length)return json({error:'Denne e-mail er allerede knyttet til en aktiv Lead Manager-konto.',code:'EMAIL_EXISTS'},409);
  const now=new Date(),expires=new Date(now.getTime()+INVITE_VALIDITY_DAYS*86400000),inviteOrigin=safeInviteOrigin(req.headers.get('Origin')||'');
  const {data:client,error:ce}=await admin.from('crm_clients').insert({name:companyName,geography:null,services:[],settings:{mail:email,contact_name:recipientName||null,default_timezone:'Europe/Copenhagen',mail_provider:null,mail_provider_preference:'later',saas:{onboarding_completed:false,onboarding_version:'saas_v6',invited_at:now.toISOString(),invited_email:email,invited_by:user.email,account_mode:'self_service_paid',legal_service_model:serviceModel}}}).select('*').single();if(ce||!client)throw ce||new Error('Kunde kunne ikke oprettes');createdClientId=client.id;
  const requiresReview=legalDef.requires_legal_review===true;
  const {error:lpErr}=await admin.from('crm_client_legal_profiles').insert({
    client_id:client.id,service_model:serviceModel,legal_status:requiresReview?'review_required':'draft',
    customer_role:legalDef.customer_role||null,platform_role:legalDef.platform_role||null,agreement_type:legalDef.agreement_type||null,
    article13_owner:legalDef.article13_owner||null,article14_owner:legalDef.article14_owner||null,privacy_process:legalDef.privacy_process||null,
    requires_legal_review:requiresReview,agreement_status:'pending',classification_source:'admin_invite',
    classified_by_email:user.email,classified_at:now.toISOString(),notes:'Standard betalende Lead Manager-konto: kunden styrer selv workspace, målgrupper, kriterier og opfølgning.'
  });if(lpErr)throw lpErr;
  await admin.from('crm_client_legal_profile_audit').insert({client_id:client.id,actor_email:user.email,actor_type:'platform_admin',event_type:'classified_on_invite',new_service_model:serviceModel,new_legal_status:requiresReview?'review_required':'draft',metadata:{definition:legalDef}});
  const {error:ue2}=await admin.from('crm_users').insert({client_id:client.id,email,role:'owner',active:true,auth_user_id:null});if(ue2)throw ue2;
  const p=await admin.rpc('crm_apply_plan',{p_client_id:client.id,p_plan_code:plan});if(p.error)throw p.error;
  const aiClone=await admin.rpc('clone_openai_api_for_service',{p_source_client_id:internal.client_id,p_target_client_id:client.id});if(aiClone.error)throw new Error('AI-motoren kunne ikke provisioneres: '+aiClone.error.message);
  const gmailClone=await admin.rpc('clone_gmail_oauth_client_for_service',{p_source_client_id:internal.client_id,p_target_client_id:client.id});if(gmailClone.error)console.warn('Google OAuth platform client clone failed',gmailClone.error.message);
  const rawBytes=crypto.getRandomValues(new Uint8Array(32)),rawToken=b64url(rawBytes),tokenHash=await sha256(rawToken),inviteLink=`${inviteOrigin}/api/app?onboarding=${encodeURIComponent(rawToken)}`;
  const {data:invite,error:ie}=await admin.from('crm_onboarding_invites').insert({client_id:client.id,email,token_hash:tokenHash,plan_code:plan,status:'created',expires_at:expires.toISOString(),created_by_user_id:user.id,created_by_email:user.email,metadata:{company_name:companyName,recipient_name:recipientName||null,platform_ai:true,google_oauth_client_ready:!gmailClone.error,onboarding_version:'saas_v6',invite_origin:inviteOrigin,service_model:serviceModel,agreement_type:legalDef.agreement_type||null}}).select('*').single();if(ie||!invite)throw ie||new Error('Invitation kunne ikke oprettes');
  const {data:mat,error:matErr}=await admin.rpc('get_gmail_oauth_material',{p_client_id:internal.client_id});if(matErr)throw matErr;
  const gClient=String(mat?.client_id||''),gSecret=String(mat?.client_secret||''),refresh=String(mat?.refresh_token||''),from=String(mat?.account||user.email||'');if(!gClient||!gSecret||!refresh)throw new Error('Den interne Gmail-forbindelse mangler OAuth-materiale');
  const tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:gClient,client_secret:gSecret,refresh_token:refresh,grant_type:'refresh_token'})}),td=await tr.json().catch(()=>({}));if(!tr.ok||!td.access_token)throw new Error(String(td?.error_description||td?.error||'Google kunne ikke forny adgang'));
  const legalLabel=String(legalDef.label||serviceModel);
  const hello=recipientName?`Hej ${recipientName}`:'Hej';const plain=`${hello}\n\nDu er inviteret til Lead Manager for ${companyName}.\n\nKlik på linket nedenfor. Her opretter du dit eget password og gennemfører opsætningen. Kontoen er selvbetjent, så I styrer selv jeres Lead Manager, målgrupper og opfølgning.\n\n${inviteLink}\n\nLinket er aktivt i ${INVITE_VALIDITY_DAYS} dage og udløber ${expires.toLocaleDateString('da-DK')}.\n\nMed venlig hilsen\nLead Manager`;
  const mime=[`From: ${from}`,`To: ${email}`,`Subject: ${encodedWord('Velkommen til Lead Manager – opsæt din konto')}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','',plain].join('\r\n');const raw=b64url(new TextEncoder().encode(mime));
  const sr=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+td.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw})}),sd=await sr.json().catch(()=>({}));if(!sr.ok)throw new Error(String(sd?.error?.message||'Invitationen kunne ikke sendes via Gmail'));
  mailSent=true;
  await admin.from('crm_onboarding_invites').update({status:'sent',sent_at:new Date().toISOString(),metadata:{...(invite.metadata||{}),gmail_message_id:sd.id||null}}).eq('id',invite.id);
  await admin.from('crm_activities').insert({client_id:internal.client_id,type:'SaaS invitation',actor_type:'user',actor_name:user.email,summary:`Onboarding-invitation sendt til ${email} (${companyName})`,metadata:{invited_client_id:client.id,plan_code:plan,platform_ai:true,onboarding_version:'saas_v6',invite_origin:inviteOrigin,invite_validity_days:INVITE_VALIDITY_DAYS,service_model:serviceModel,agreement_type:legalDef.agreement_type||null}});
  return json({ok:true,client_id:client.id,email,company_name:companyName,plan_code:plan,service_model:serviceModel,legal_definition:legalDef,expires_at:expires.toISOString(),invite_validity_days:INVITE_VALIDITY_DAYS,sent:true,platform_ai:true,google_oauth_client_ready:!gmailClone.error,invite_origin:inviteOrigin});
 }catch(err){console.error(err);if(createdClientId&&!mailSent){try{const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,a=createClient(url,key,{auth:{persistSession:false}});await a.from('crm_onboarding_invites').delete().eq('client_id',createdClientId);await a.from('crm_usage_limits').delete().eq('client_id',createdClientId);await a.from('crm_users').delete().eq('client_id',createdClientId);await a.from('crm_integrations').delete().eq('client_id',createdClientId);await a.from('crm_clients').delete().eq('id',createdClientId)}catch(e){console.error('cleanup failed',e)}}return json({error:err instanceof Error?err.message:String(err),code:'INVITE_FAILED'},500)}
});
