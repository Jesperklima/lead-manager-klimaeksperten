import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const REDIRECT_URI='https://ouqhostcsvdyrkjefiya.supabase.co/functions/v1/microsoft-oauth-callback';
const DEFAULT_APP_URL='https://lead-manager-klimaeksperten.vercel.app/';
const safeReturn=(v:unknown)=>{try{const u=new URL(String(v||DEFAULT_APP_URL));return u.protocol==='https:'?u.href:DEFAULT_APP_URL}catch{return DEFAULT_APP_URL}};
const back=(status:string,message:string,returnUrl=DEFAULT_APP_URL)=>{
  const u=new URL(safeReturn(returnUrl));u.searchParams.set('microsoft',status);u.searchParams.set('microsoft_message',String(message||'').slice(0,500));
  return new Response(null,{status:303,headers:{Location:u.href,'Cache-Control':'no-store'}});
};

Deno.serve(async(req:Request)=>{
  const u=new URL(req.url);
  const code=u.searchParams.get('code')||'',state=u.searchParams.get('state')||'',oauthError=u.searchParams.get('error')||'',oauthDesc=u.searchParams.get('error_description')||'';
  let returnUrl=DEFAULT_APP_URL;
  try{
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    let row:any=null;
    if(state){
      const {data:states,error:stateError}=await admin.from('crm_microsoft_oauth_states').select('*').eq('state_token',state).limit(1);if(stateError)throw stateError;
      row=states?.[0]||null;returnUrl=safeReturn(row?.return_url);
    }
    if(oauthError){
      const detail=(oauthDesc||oauthError||'Microsoft afviste godkendelsen').slice(0,1000);
      if(row?.client_id){
        await admin.from('crm_integrations').update({last_error:`Microsoft OAuth: ${oauthError}: ${detail}`.slice(0,1000),updated_at:new Date().toISOString()}).eq('client_id',row.client_id).eq('provider','microsoft');
      }
      return back('error','Microsoft returnerede: '+detail,returnUrl);
    }
    if(!code||!state)return back('error','OAuth-svaret mangler kode eller state.',returnUrl);
    if(!row||row.used_at||new Date(row.expires_at).getTime()<Date.now())return back('error','Forbindelseslinket er udløbet. Start Microsoft-forbindelsen igen i Lead Manager.',returnUrl);
    const {data:material,error:materialError}=await admin.rpc('crm_get_microsoft_oauth_material',{p_client_id:row.client_id});if(materialError)throw materialError;
    const appId=String(material?.client_id||'').trim(),secret=String(material?.client_secret||'').trim();
    if(!appId||!secret)return back('error','Microsoft platformens Application ID/Secret mangler.',returnUrl);
    const tokenResp=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:appId,client_secret:secret,code,redirect_uri:REDIRECT_URI,grant_type:'authorization_code',code_verifier:String(row.code_verifier||''),scope:String(row.requested_scope||'')})
    });
    const tokenData=await tokenResp.json().catch(()=>({}));
    if(!tokenResp.ok){
      const err=String(tokenData?.error||'token_error'),desc=String(tokenData?.error_description||'Microsoft afviste token-kaldet.');
      await admin.from('crm_integrations').update({last_error:`Microsoft OAuth: ${err}: ${desc}`.slice(0,1000),updated_at:new Date().toISOString()}).eq('client_id',row.client_id).eq('provider','microsoft');
      return back('error',`Microsoft OAuth-fejl: ${err}. ${desc}`,returnUrl);
    }
    const accessToken=String(tokenData.access_token||''),refreshToken=String(tokenData.refresh_token||''),scope=String(tokenData.scope||row.requested_scope||'');
    if(!accessToken||!refreshToken)return back('error','Microsoft returnerede ikke en permanent refresh token. Godkend offline adgang og prøv igen.',returnUrl);
    const meResp=await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',{headers:{Authorization:'Bearer '+accessToken}}),me=await meResp.json().catch(()=>({}));
    if(!meResp.ok)return back('error','Kunne ikke verificere den valgte Microsoft-konto.',returnUrl);
    const graphMail=String(me?.mail||'').trim().toLowerCase(),upn=String(me?.userPrincipalName||'').trim().toLowerCase();
    const {data:client}=await admin.from('crm_clients').select('settings').eq('id',row.client_id).single();
    const expected=String(client?.settings?.microsoft_mail||'').trim().toLowerCase();
    if(!expected)return back('error','Der er ikke valgt en Microsoft 365 / Outlook-mailkonto i Lead Manager.',returnUrl);
    if(![graphMail,upn].filter(Boolean).includes(expected))return back('error',`Den valgte Microsoft-konto (${graphMail||upn||'ukendt'}) matcher ikke den Microsoft-mail, der blev valgt i Lead Manager (${expected}).`,returnUrl);
    if(scope.includes('Mail.Read')){
      const mailboxResp=await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id',{headers:{Authorization:'Bearer '+accessToken}});
      if(!mailboxResp.ok){
        const mb=await mailboxResp.json().catch(()=>({}));
        const msg=String(mb?.error?.message||'Kontoen har ikke en tilgængelig Outlook/Exchange-mailbox.');
        await admin.from('crm_integrations').update({last_error:`Microsoft mailbox check: ${msg}`.slice(0,1000),updated_at:new Date().toISOString()}).eq('client_id',row.client_id).eq('provider','microsoft').eq('account',expected);
        return back('error','Microsoft-kontoen kunne logge ind, men der blev ikke fundet en brugbar Outlook/Microsoft 365-mailbox. '+msg,returnUrl);
      }
    }
    const {error:saveError}=await admin.rpc('crm_set_microsoft_refresh_token',{p_client_id:row.client_id,p_refresh_token:refreshToken,p_account:expected,p_scope:scope});
    if(saveError)return back('error',saveError.message||'Microsoft refresh token kunne ikke gemmes.',returnUrl);
    await admin.from('crm_microsoft_oauth_states').update({used_at:new Date().toISOString()}).eq('state_token',state);
    await admin.from('crm_activities').insert({client_id:row.client_id,type:'Integration',actor_type:'user',actor_name:row.user_email,summary:'Microsoft 365 / Outlook forbundet til '+expected,metadata:{provider:'microsoft',graph:true,scope,history_read:scope.includes('Mail.Read')}});
    return back('connected','Microsoft 365 / Outlook er forbundet til '+expected+'.',returnUrl);
  }catch(err){console.error(err);return back('error',err instanceof Error?err.message:'Ukendt fejl',returnUrl)}
});