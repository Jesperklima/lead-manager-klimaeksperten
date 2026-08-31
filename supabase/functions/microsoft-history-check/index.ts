import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const lower=(v:unknown)=>String(v??'').trim().toLowerCase();

async function accessToken(admin:any,clientId:string,material:any){
  const appId=String(material?.client_id||'').trim(),secret=String(material?.client_secret||'').trim(),refreshToken=String(material?.refresh_token||'').trim(),scope=String(material?.scope||'').trim(),account=lower(material?.account);
  if(!appId||!secret||!refreshToken)throw Object.assign(new Error('Microsoft 365 er ikke færdigforbundet'),{code:'MICROSOFT_NOT_CONNECTED'});
  if(!scope.includes('Mail.Read'))throw Object.assign(new Error('Microsoft-forbindelsen mangler læseadgang. Forbind kontoen igen.'),{code:'MICROSOFT_READ_SCOPE_REQUIRED'});
  const payload:any={client_id:appId,client_secret:secret,refresh_token:refreshToken,grant_type:'refresh_token',scope};
  const resp=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(payload)}),data=await resp.json().catch(()=>({}));
  if(!resp.ok||!data.access_token)throw Object.assign(new Error(String(data?.error_description||data?.error||'Microsoft kunne ikke forny mailadgangen')),{code:'MICROSOFT_TOKEN_ERROR'});
  const rotated=String(data.refresh_token||'').trim(),nextScope=String(data.scope||scope).trim();
  if(rotated&&rotated!==refreshToken){const r=await admin.rpc('crm_set_microsoft_refresh_token',{p_client_id:clientId,p_refresh_token:rotated,p_account:account,p_scope:nextScope});if(r.error)throw r.error}
  return String(data.access_token);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)return json({error:'Mangler login-token'},401);
    const url=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);
    const body=await req.json().catch(()=>({})),clientId=String(body.client_id||'').trim(),leadId=String(body.lead_id||'').trim();if(!clientId||!leadId)return json({error:'Mangler client_id eller lead_id'},400);
    const [{data:membership,error:memberError},{data:client,error:clientError},{data:lead,error:leadError},{data:limits},{data:material,error:materialError}]=await Promise.all([
      admin.from('crm_users').select('client_id,auth_user_id').eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle(),
      admin.from('crm_clients').select('id,settings').eq('id',clientId).single(),
      admin.from('crm_leads').select('id,company_id').eq('id',leadId).eq('client_id',clientId).single(),
      admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle(),
      admin.rpc('crm_get_microsoft_oauth_material',{p_client_id:clientId})
    ]);
    if(memberError)throw memberError;if(!membership)return json({error:'Ingen adgang til denne klient'},403);if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);if(leadError||!lead)return json({error:'Lead blev ikke fundet'},404);if(materialError)throw materialError;
    if(String(client.settings?.mail_provider||'').toLowerCase()!=='microsoft')return json({error:'Kunden bruger ikke Microsoft som mailplatform',code:'WRONG_MAIL_PROVIDER'},409);
    if(!limits?.allow_mail_monitor)return json({error:'Mailhistorik er inkluderet fra Pro-pakken',code:'PLAN_MAIL_MONITOR_DISABLED'},403);
    const {data:contacts,error:contactError}=await admin.from('crm_contacts').select('email').eq('client_id',clientId).eq('company_id',lead.company_id);if(contactError)throw contactError;
    const targetEmails=[...new Set((contacts||[]).map((c:any)=>lower(c.email)).filter(Boolean))];if(!targetEmails.length)return json({ok:true,messages:[],provider:'microsoft',reason:'no_contact_emails'});
    let access;try{access=await accessToken(admin,clientId,material)}catch(e:any){return json({error:e?.message||String(e),code:e?.code||'MICROSOFT_TOKEN_ERROR'},412)}
    const params=new URLSearchParams({'$top':'100','$select':'id,subject,sentDateTime,toRecipients,bodyPreview,webLink,conversationId','$orderby':'sentDateTime desc'});
    const graph=await fetch('https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?'+params.toString(),{headers:{Authorization:'Bearer '+access,'Prefer':'outlook.body-content-type="text"'}}),data=await graph.json().catch(()=>({}));
    if(!graph.ok)return json({error:String(data?.error?.message||`Microsoft Graph historik fejlede (${graph.status})`),code:'MICROSOFT_HISTORY_ERROR'},502);
    const messages=(Array.isArray(data?.value)?data.value:[]).filter((m:any)=>{
      const tos=(m.toRecipients||[]).map((r:any)=>lower(r?.emailAddress?.address));return tos.some((e:string)=>targetEmails.includes(e));
    }).slice(0,20).map((m:any)=>({
      id:String(m.id||''),subject:String(m.subject||''),message_at:m.sentDateTime||null,
      to:(m.toRecipients||[]).map((r:any)=>lower(r?.emailAddress?.address)).filter(Boolean),
      body_text:String(m.bodyPreview||''),web_url:String(m.webLink||''),conversation_id:String(m.conversationId||'')
    }));
    await admin.from('crm_integrations').update({status:'connected',last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','microsoft');
    return json({ok:true,messages,provider:'microsoft',account:lower(material?.account),matched_contacts:targetEmails.length});
  }catch(err){console.error(err);return json({error:err instanceof Error?err.message:'Ukendt fejl'},500)}
});
