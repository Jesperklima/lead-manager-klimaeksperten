import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const DEFAULT_APP_URL='https://lead-manager-klimaeksperten.vercel.app/';
const REDIRECT_URI='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/gmail-oauth-callback';
const GMAIL_SCOPE='openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify';
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const safeAppUrl=(v:unknown)=>{try{const u=new URL(String(v||DEFAULT_APP_URL));return u.protocol==='https:'?u.href:DEFAULT_APP_URL}catch{return DEFAULT_APP_URL}};
const safeReturnUrl=(v:unknown,fallback:string)=>{try{const base=new URL(fallback),u=new URL(String(v||fallback));return u.protocol==='https:'&&u.origin===base.origin?u.href:fallback}catch{return fallback}};
async function validateGoogleClient(clientId:string,clientSecret:string){const resp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:'lead-manager-credential-validation',client_id:clientId,client_secret:clientSecret,redirect_uri:REDIRECT_URI,grant_type:'authorization_code'})});const data=await resp.json().catch(()=>({}));const err=String(data?.error||''),desc=String(data?.error_description||'');if(err==='invalid_grant')return {ok:true};if(err==='invalid_client')return {ok:false,code:'GOOGLE_INVALID_CLIENT',message:'Google afviser Client Secret til denne Client ID.'};return {ok:false,code:'GOOGLE_CLIENT_VALIDATION_FAILED',message:desc||err||`Google credential check fejlede (${resp.status})`}}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);try{
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)return json({error:'Mangler login-token'},401);
 const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);
 const body=await req.json().catch(()=>({})),clientId=String(body.client_id||'').trim(),action=String(body.action||'status').trim();if(!clientId)return json({error:'Mangler client_id'},400);
 const [{data:membership,error:memberError},{data:client,error:clientError},{data:limits,error:limitsError}]=await Promise.all([
   admin.from('crm_users').select('email,client_id,role,auth_user_id').eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle(),
   admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single(),
   admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle()
 ]);
 if(memberError)throw memberError;if(!membership)return json({error:'Ingen adgang til denne klient'},403);if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);if(limitsError)throw limitsError;if(limits&&limits.allow_mail_send===false)return json({error:'Mailintegration er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
 const plan=String(limits?.plan_code||'start').toLowerCase(),appUrl=safeAppUrl(client.settings?.app_url||DEFAULT_APP_URL);
 const {data:launch,error:launchError}=await admin.rpc('crm_mail_launch_status',{p_client_id:clientId});if(launchError)throw launchError;
 if(action==='platform_status'){const {data:platform,error}=await admin.rpc('crm_get_gmail_platform_app');if(error)throw error;return json({configured:!!(platform?.client_id&&platform?.client_secret),redirect_uri:REDIRECT_URI,client_id_hint:platform?.client_id?String(platform.client_id).slice(0,10)+'…':null,launch:launch?.google||{}})}
 if(action==='save_platform'||action==='save_client'){
   if(plan!=='internal'||!['owner','admin'].includes(String(membership.role||'').toLowerCase()))return json({error:'Kun intern ejer/admin kan konfigurere Google-platformappen'},403);
   const googleClientId=String(body.google_client_id||'').trim(),googleClientSecret=String(body.google_client_secret||'').trim();if(!googleClientId.endsWith('.apps.googleusercontent.com'))return json({error:'Google OAuth Client ID er ikke gyldig.',code:'GOOGLE_CLIENT_ID_INVALID'},400);if(googleClientSecret.length<20)return json({error:'Google OAuth Client Secret er ikke gyldig.',code:'GOOGLE_CLIENT_SECRET_INVALID'},400);
   const check=await validateGoogleClient(googleClientId,googleClientSecret);if(!check.ok)return json({error:check.message,code:check.code},400);
   const {data,error}=await admin.rpc('crm_set_gmail_platform_app',{p_client_id:googleClientId,p_client_secret:googleClientSecret});if(error)throw error;
   return json({...((data||{}) as object),validated_by_google:true});
 }
 if(action==='status'){const [{data,error},{data:integrations}]=await Promise.all([admin.rpc('get_gmail_direct_status',{p_client_id:clientId}),admin.from('crm_integrations').select('config').eq('client_id',clientId).eq('provider','gmail').limit(1)]);if(error)throw error;const scope=String(integrations?.[0]?.config?.direct_send?.scope||'');return json({...((data||{}) as object),history_scope:scope.includes('gmail.readonly')||scope.includes('gmail.modify'),mark_read_scope:scope.includes('gmail.modify'),required_scope:GMAIL_SCOPE,client_name:client.name,launch:launch?.google||{}})}
 if(action==='start'){
   const googleLaunch=launch?.google||{};if(plan!=='internal'&&googleLaunch.public_launch_ready!==true)return json({error:'Google/Gmail er endnu ikke åbnet til bred kundelancering. Vælg Microsoft, One.com/anden mail eller forbind senere.',code:'GOOGLE_LAUNCH_NOT_READY',launch:googleLaunch},423);
   const {data:platform,error:platformError}=await admin.rpc('crm_get_gmail_platform_app');if(platformError)throw platformError;const googleClientId=String(platform?.client_id||'').trim(),googleClientSecret=String(platform?.client_secret||'').trim();if(!googleClientId||!googleClientSecret)return json({error:'Google OAuth-platformappen er ikke konfigureret endnu',code:'GMAIL_PLATFORM_APP_MISSING'},412);
   const check=await validateGoogleClient(googleClientId,googleClientSecret);if(!check.ok)return json({error:check.message,code:check.code},412);
   const account=String(body.account||client.settings?.mail||'').trim().toLowerCase();if(!emailOk(account))return json({error:'Indtast den Google Workspace / Gmail-konto, der skal forbindes.',code:'GMAIL_ACCOUNT_INVALID'},400);
   const settings=client.settings||{};if(String(settings.mail||'').trim().toLowerCase()!==account){const {error:updateError}=await admin.from('crm_clients').update({settings:{...settings,mail:account}}).eq('id',clientId);if(updateError)throw updateError}
   const returnUrl=safeReturnUrl(body.return_url,appUrl),stateToken=crypto.randomUUID()+crypto.randomUUID().replaceAll('-','');const {error:stateError}=await admin.from('crm_gmail_oauth_states').insert({state_token:stateToken,client_id:clientId,user_email:user.email,return_url:returnUrl});if(stateError)throw stateError;
   const {data:existing}=await admin.from('crm_integrations').select('id,config').eq('client_id',clientId).eq('provider','gmail').eq('account',account).limit(1);const config={mode:'gmail_api',direct_send:{status:'needs_authorization',scope:GMAIL_SCOPE,redirect_uri:REDIRECT_URI,expected_account:account,platform_app:true}};
   if(existing?.[0]?.id)await admin.from('crm_integrations').update({status:'needs_authorization',last_error:null,updated_at:new Date().toISOString(),config:{...(existing[0].config||{}),...config}}).eq('id',existing[0].id);else await admin.from('crm_integrations').insert({client_id:clientId,provider:'gmail',account,status:'needs_authorization',config,last_error:null});
   const params=new URLSearchParams({client_id:googleClientId,redirect_uri:REDIRECT_URI,response_type:'code',access_type:'offline',prompt:'consent',include_granted_scopes:'true',login_hint:account,scope:GMAIL_SCOPE,state:stateToken});return json({authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString(),account,scope:GMAIL_SCOPE,return_url:returnUrl,client_name:client.name});
 }
 return json({error:'Ukendt handling'},400)
}catch(err){console.error(err);return json({error:err instanceof Error?err.message:'Ukendt fejl'},500)}});