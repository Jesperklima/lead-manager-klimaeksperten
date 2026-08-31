import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const DEFAULT_APP_URL='https://lead-manager-klimaeksperten.vercel.app/';
const REDIRECT_URI='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback';
const BASE_SCOPE='openid profile email offline_access User.Read Mail.Send';
const READ_SCOPE='Mail.Read';
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const safeAppUrl=(v:unknown)=>{try{const u=new URL(String(v||DEFAULT_APP_URL));return u.protocol==='https:'?u.href:DEFAULT_APP_URL}catch{return DEFAULT_APP_URL}};
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
const verifier=()=>{const bytes=new Uint8Array(48);crypto.getRandomValues(bytes);return b64url(bytes)};
const challenge=async(v:string)=>b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))));

async function validateMicrosoftClient(clientId:string,clientSecret:string){
  const resp=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code:'lead-manager-credential-validation',redirect_uri:REDIRECT_URI,grant_type:'authorization_code',code_verifier:'lead-manager-credential-validation'})
  });
  const data=await resp.json().catch(()=>({}));
  const err=String(data?.error||'');
  const desc=String(data?.error_description||'');
  if(err==='invalid_grant') return {ok:true};
  if(err==='invalid_client'||/7000215|700016|client secret|application.*not found/i.test(desc)) return {ok:false,code:'MICROSOFT_INVALID_CLIENT',message:'Microsoft afviser Application ID eller Client Secret.'};
  // Microsoft can return tenant/consent related errors for otherwise valid credentials.
  if(resp.status>=400&&/AADSTS/i.test(desc)&&!/7000215|700016/i.test(desc)) return {ok:true,warning:desc.slice(0,400)};
  return {ok:false,code:'MICROSOFT_CLIENT_VALIDATION_FAILED',message:desc||err||`Microsoft credential check fejlede (${resp.status})`};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token'},401);
    const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
    if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'status').trim();
    const requestedClientId=String(body.client_id||'').trim();
    const {data:members,error:memberError}=await admin.from('crm_users').select('client_id,email,role,active,auth_user_id').eq('auth_user_id',user.id).eq('active',true);
    if(memberError)throw memberError;
    const membership=(members||[]).find((m:any)=>!requestedClientId||m.client_id===requestedClientId) || members?.[0];
    if(!membership)return json({error:'Ingen adgang til denne klient'},403);
    const clientId=requestedClientId||membership.client_id;
    if(membership.client_id!==clientId)return json({error:'Ingen adgang til denne klient'},403);
    const [{data:client,error:clientError},{data:limits,error:limitsError}]=await Promise.all([
      admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single(),
      admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle()
    ]);
    if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);
    if(limitsError)throw limitsError;
    if(limits&&limits.allow_mail_send===false)return json({error:'Mailintegration er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
    const plan=String(limits?.plan_code||'start').toLowerCase();
    const scope=BASE_SCOPE+(limits?.allow_mail_monitor?' '+READ_SCOPE:'');
    const appUrl=safeAppUrl(client.settings?.app_url||DEFAULT_APP_URL);

    if(action==='platform_status'){
      const {data:platform,error}=await admin.rpc('crm_get_microsoft_platform_app');if(error)throw error;
      return json({configured:!!(platform?.client_id&&platform?.client_secret),redirect_uri:REDIRECT_URI,tenant:'common',client_id_hint:platform?.client_id?String(platform.client_id).slice(0,8)+'…':null});
    }

    if(action==='save_platform'){
      if(plan!=='internal'||!['owner','admin'].includes(String(membership.role||'').toLowerCase()))return json({error:'Kun intern ejer/admin kan konfigurere Microsoft-platformappen'},403);
      const appId=String(body.microsoft_client_id||'').trim(),secret=String(body.microsoft_client_secret||'').trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId))return json({error:'Application (client) ID er ikke gyldig'},400);
      if(secret.length<8)return json({error:'Client Secret mangler eller er for kort'},400);
      const check=await validateMicrosoftClient(appId,secret);if(!check.ok)return json({error:check.message,code:check.code},400);
      const {data,error}=await admin.rpc('crm_set_microsoft_platform_app',{p_app_id:appId,p_client_secret:secret});if(error)throw error;
      await admin.from('crm_activities').insert({client_id:clientId,type:'Integration',actor_type:'user',actor_name:user.email,summary:'Microsoft OAuth platform-app konfigureret',metadata:{provider:'microsoft',redirect_uri:REDIRECT_URI}});
      return json({...((data||{}) as object),validated_by_microsoft:true,validation_warning:check.warning||null});
    }

    if(action==='status'){
      const {data,error}=await admin.rpc('crm_get_microsoft_status',{p_client_id:clientId});if(error)throw error;
      const storedScope=String(data?.scope||'');
      const requiredRead=!!limits?.allow_mail_monitor;
      const hasRead=!requiredRead||storedScope.includes('Mail.Read');
      return json({...((data||{}) as object),ready:!!data?.ready&&hasRead,required_scope:scope,read_scope_required:requiredRead,read_scope_ok:hasRead,client_name:client.name,plan_code:plan});
    }

    if(action==='start'){
      const {data:platform,error:platformError}=await admin.rpc('crm_get_microsoft_platform_app');if(platformError)throw platformError;
      const appId=String(platform?.client_id||'').trim(),secret=String(platform?.client_secret||'').trim();
      if(!appId||!secret)return json({error:'Microsoft OAuth-platformappen er ikke konfigureret endnu',code:'MICROSOFT_PLATFORM_APP_MISSING'},412);
      const account=String(body.account||client.settings?.mail||user.email||'').trim().toLowerCase();
      if(!emailOk(account))return json({error:'Virksomhedsmailen er ugyldig',code:'MICROSOFT_ACCOUNT_INVALID'},400);
      // The account selected during onboarding becomes the tenant's expected sender address.
      const settings=client.settings||{};
      if(String(settings.mail||'').trim().toLowerCase()!==account){
        const {error:updateError}=await admin.from('crm_clients').update({settings:{...settings,mail:account,mail_provider:'microsoft'}}).eq('id',clientId);if(updateError)throw updateError;
      }
      const stateToken=crypto.randomUUID()+crypto.randomUUID().replaceAll('-','');
      const codeVerifier=verifier(),codeChallenge=await challenge(codeVerifier);
      const {error:stateError}=await admin.from('crm_microsoft_oauth_states').insert({state_token:stateToken,client_id:clientId,user_email:user.email,return_url:appUrl,requested_scope:scope,code_verifier:codeVerifier});if(stateError)throw stateError;
      const {data:existing}=await admin.from('crm_integrations').select('id,config').eq('client_id',clientId).eq('provider','microsoft').eq('account',account).limit(1);
      if(existing?.[0]?.id){
        await admin.from('crm_integrations').update({status:'needs_authorization',last_error:null,updated_at:new Date().toISOString(),config:{...(existing[0].config||{}),mode:'microsoft_graph',oauth:{...((existing[0].config||{}).oauth||{}),status:'needs_authorization',scope,redirect_uri:REDIRECT_URI,expected_account:account}}}).eq('id',existing[0].id);
      }else{
        await admin.from('crm_integrations').insert({client_id:clientId,provider:'microsoft',account,status:'needs_authorization',config:{mode:'microsoft_graph',oauth:{status:'needs_authorization',scope,redirect_uri:REDIRECT_URI,expected_account:account}},last_error:null});
      }
      const params=new URLSearchParams({client_id:appId,response_type:'code',redirect_uri:REDIRECT_URI,response_mode:'query',scope,state:stateToken,login_hint:account,prompt:'select_account',code_challenge:codeChallenge,code_challenge_method:'S256'});
      return json({authorize_url:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?'+params.toString(),account,scope,redirect_uri:REDIRECT_URI,client_name:client.name});
    }

    return json({error:'Ukendt handling'},400);
  }catch(err){console.error(err);return json({error:err instanceof Error?err.message:'Ukendt fejl'},500)}
});
