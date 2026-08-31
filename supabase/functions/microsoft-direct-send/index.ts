import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const trim=(v:unknown,max=10000)=>String(v??'').trim().slice(0,max);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const dateOk=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T12:00:00Z').getTime());
const escHtml=(s:string)=>s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m));
const ymd=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;

async function accessToken(admin:any,clientId:string,material:any){
  const appId=String(material?.client_id||'').trim(),secret=String(material?.client_secret||'').trim(),refreshToken=String(material?.refresh_token||'').trim(),scope=String(material?.scope||'').trim();
  if(!appId||!secret||!refreshToken)throw Object.assign(new Error('Microsoft 365 er ikke færdigforbundet'),{code:'MICROSOFT_NOT_CONNECTED'});
  const body:any={client_id:appId,client_secret:secret,refresh_token:refreshToken,grant_type:'refresh_token'};if(scope)body.scope=scope;
  const resp=await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok||!data.access_token)throw Object.assign(new Error(String(data?.error_description||data?.error||'Microsoft kunne ikke forny mailadgangen')),{code:'MICROSOFT_TOKEN_ERROR'});
  const rotated=String(data.refresh_token||'').trim(),nextScope=String(data.scope||scope).trim(),account=String(material?.account||'').trim().toLowerCase();
  if(rotated&&rotated!==refreshToken){const r=await admin.rpc('crm_set_microsoft_refresh_token',{p_client_id:clientId,p_refresh_token:rotated,p_account:account,p_scope:nextScope});if(r.error)throw r.error}
  return {token:String(data.access_token),scope:nextScope};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)return json({error:'Mangler login-token'},401);
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);
    const body=await req.json().catch(()=>({}));const clientId=trim(body.client_id,80),leadId=trim(body.lead_id,80),to=trim(body.to,320).toLowerCase(),subject=trim(body.subject,700),mailBody=trim(body.body,12000),aiGenerated=!!body.ai_generated,aiModel=trim(body.ai_model,100)||null;
    let followUpDate=trim(body.follow_up_date,10),followUpAt=trim(body.follow_up_at,60);if(!followUpDate){const d=new Date();d.setUTCDate(d.getUTCDate()+7);followUpDate=ymd(d)}if(!dateOk(followUpDate))return json({error:'Opfølgningsdatoen er ugyldig',code:'FOLLOWUP_DATE_INVALID'},400);if(followUpAt&&Number.isNaN(new Date(followUpAt).getTime()))return json({error:'Opfølgningstidspunktet er ugyldigt',code:'FOLLOWUP_AT_INVALID'},400);if(!followUpAt)followUpAt=followUpDate+'T08:00:00.000Z';
    if(!clientId||!leadId||!emailOk(to)||!subject||!mailBody)return json({error:'Mangler gyldig modtager, emne eller mailtekst'},400);
    const [{data:membership,error:memberError},{data:client,error:clientError},{data:lead,error:leadError},{data:material,error:materialError},{data:limits},{data:usage}]=await Promise.all([
      admin.from('crm_users').select('email,client_id,role,auth_user_id').eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle(),
      admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single(),
      admin.from('crm_leads').select('id,company_id,status,priority,planning_type,next_action,next_at').eq('id',leadId).eq('client_id',clientId).single(),
      admin.rpc('crm_get_microsoft_oauth_material',{p_client_id:clientId}),
      admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle(),
      admin.rpc('crm_usage_snapshot',{p_client_id:clientId})
    ]);
    if(memberError)throw memberError;if(!membership)return json({error:'Ingen adgang til denne klient'},403);if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);if(leadError||!lead)return json({error:'Lead blev ikke fundet'},404);if(materialError)throw materialError;
    if(String(client.settings?.mail_provider||'').toLowerCase()!=='microsoft')return json({error:'Kunden bruger ikke Microsoft som mailplatform',code:'WRONG_MAIL_PROVIDER'},409);
    if(limits&&limits.allow_mail_send===false)return json({error:'Mailafsendelse er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
    const dailyLimit=Number(limits?.daily_mail_send_limit||100),sentToday=Number(usage?.mail_sends_today||0);if(sentToday>=dailyLimit)return json({error:'Dagens fair-use grænse for mails er nået',code:'MAIL_DAILY_LIMIT',limit:dailyLimit},429);
    const from=String(client.settings?.mail||'').trim().toLowerCase(),connectedAccount=String(material?.account||'').trim().toLowerCase();if(!emailOk(from))return json({error:'Afsendermail mangler i kundeprofilen',code:'FROM_NOT_CONFIGURED'},412);if(!connectedAccount||connectedAccount!==from)return json({error:`Den forbundne Microsoft-konto (${connectedAccount||'ingen'}) matcher ikke kundens afsendermail (${from})`,code:'FROM_ACCOUNT_MISMATCH'},412);
    const {data:contactRows}=await admin.from('crm_contacts').select('id,email,verified').eq('client_id',clientId).eq('company_id',lead.company_id),contact=(contactRows||[]).find((c:any)=>String(c.email||'').trim().toLowerCase()===to);if(!contact)return json({error:'Modtageren er ikke registreret som kontakt på denne kunde. Tilføj/verificér adressen først.',code:'RECIPIENT_NOT_ON_CUSTOMER'},412);
    const {data:approval,error:approvalError}=await admin.from('crm_approvals').insert({client_id:clientId,lead_id:leadId,action_type:'send_email',status:'approved',decided_at:new Date().toISOString(),payload:{to,subject,body:mailBody,company_id:lead.company_id,include_signature:true,signature_key:'client_default',approved_by:user.email,approval_method:'explicit_send_button',follow_up_date:followUpDate,follow_up_at:followUpAt},ai_generated:aiGenerated,ai_model:aiModel}).select('id,status,payload').single();if(approvalError)throw approvalError;if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret som mulig dobbeltkontakt',code:'DUPLICATE_BLOCKED'},409);
    let auth;try{auth=await accessToken(admin,clientId,material)}catch(e:any){await admin.from('crm_approvals').update({status:'rejected',payload:{...(approval?.payload||{}),send_error:e?.message||String(e)}}).eq('id',approval.id);await admin.from('crm_integrations').update({last_error:e?.message||String(e),updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','microsoft');return json({error:e?.message||String(e),code:e?.code||'MICROSOFT_TOKEN_ERROR'},502)}
    const sigText=String(client.settings?.mail_signature_text||'').trim(),sigHtml=String(client.settings?.mail_signature_html||'').trim(),htmlBody='<div style="font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.5">'+escHtml(mailBody).replaceAll('\n','<br>')+'</div>'+(sigHtml?sigHtml:(sigText?'<br><br>'+escHtml(sigText).replaceAll('\n','<br>'):''));
    const sendResp=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({message:{subject,body:{contentType:'HTML',content:htmlBody},toRecipients:[{emailAddress:{address:to}}]},saveToSentItems:true})});
    if(sendResp.status!==202){const sent=await sendResp.json().catch(()=>({})),msg=String(sent?.error?.message||`Microsoft Graph sendMail fejlede (${sendResp.status})`);await admin.from('crm_approvals').update({status:'rejected',payload:{...(approval?.payload||{}),send_error:msg}}).eq('id',approval.id);await admin.from('crm_integrations').update({last_error:msg,updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','microsoft');return json({error:msg,code:'MICROSOFT_SEND_ERROR'},502)}
    const now=new Date().toISOString(),externalId='ms-'+crypto.randomUUID(),nextAction=trim(`Følg op på mail: ${subject}`,180);
    await admin.from('crm_mail_messages').insert({client_id:clientId,company_id:lead.company_id,lead_id:leadId,contact_id:contact.id,provider:'microsoft',external_message_id:externalId,external_thread_id:null,direction:'outbound',from_email:from,to_emails:[to],cc_emails:[],subject,body_text:mailBody,message_at:now,metadata:{direct_send:true,approved_by:user.email,approval_id:approval.id,ai_generated:aiGenerated,ai_model:aiModel,signature_appended:!!(sigText||sigHtml),signature_version:'client_default',follow_up_date:followUpDate,follow_up_at:followUpAt}});
    await admin.from('crm_activities').insert({client_id:clientId,company_id:lead.company_id,lead_id:leadId,contact_id:contact.id,type:'Udgående mail',actor_type:'user',actor_name:user.email,summary:`Mail sendt fra ${from}: ${subject}`,metadata:{provider:'microsoft',to,approval_id:approval.id,ai_generated:aiGenerated,signature_version:'client_default',follow_up_date:followUpDate,follow_up_at:followUpAt}});
    await admin.from('crm_usage_events').insert({client_id:clientId,event_type:'mail_send',quantity:1,metadata:{lead_id:leadId,provider:'microsoft',explicit_send_button:true}});
    const leadUpdate=await admin.from('crm_leads').update({next_action:nextAction,next_at:followUpAt,planning_type:'flexible',updated_at:now}).eq('id',leadId).eq('client_id',clientId);if(leadUpdate.error)throw leadUpdate.error;
    const {data:openTasks,error:taskFindError}=await admin.from('crm_tasks').select('id').eq('client_id',clientId).eq('lead_id',leadId).eq('task_type','lead_followup').eq('status','open').order('created_at',{ascending:false}).limit(1);if(taskFindError)throw taskFindError;
    const assignedTo=String(client.settings?.default_owner_name||user.email),taskPayload={client_id:clientId,lead_id:leadId,company_id:lead.company_id,title:nextAction,task_type:'lead_followup',scheduled_at:followUpAt,planning_type:'flexible',status:'open',priority:lead.priority||null,assigned_to:assignedTo,calendar_sync_status:'none',sync_origin:'lead_manager_mail'};
    if(openTasks?.[0]?.id){const r=await admin.from('crm_tasks').update(taskPayload).eq('id',openTasks[0].id);if(r.error)throw r.error}else{const r=await admin.from('crm_tasks').insert(taskPayload);if(r.error)throw r.error}
    await admin.from('crm_activities').insert({client_id:clientId,company_id:lead.company_id,lead_id:leadId,contact_id:contact.id,type:'Planlægning',actor_type:'user',actor_name:user.email,summary:`Opfølgning efter sendt mail sat til ${followUpDate}`,metadata:{source:'direct_email_send',provider:'microsoft',follow_up_date:followUpDate,follow_up_at:followUpAt,subject}});
    await admin.from('crm_integrations').update({status:'connected',last_sync_at:now,last_error:null,updated_at:now}).eq('client_id',clientId).eq('provider','microsoft');
    return json({ok:true,id:externalId,from,to,subject,follow_up_date:followUpDate,follow_up_at:followUpAt,next_action:nextAction,client_name:client.name,provider:'microsoft'});
  }catch(err){console.error(err);return json({error:err instanceof Error?err.message:'Ukendt fejl'},500)}
});
