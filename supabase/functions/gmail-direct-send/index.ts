import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const trim=(v:unknown,max=10000)=>String(v??'').trim().slice(0,max);
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const uuidOk=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const dateOk=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T12:00:00Z').getTime());
const bytesToB64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const b64url=(s:string)=>bytesToB64(new TextEncoder().encode(s)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const b64header=(s:string)=>'=?UTF-8?B?'+bytesToB64(new TextEncoder().encode(s))+'?=';
const escHtml=(s:string)=>s.replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]||m));
const ymd=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
const senderName=(client:any)=>trim(client?.settings?.mail_sender_name||client?.settings?.contact_name||client?.name||'',120).replace(/[\r\n]+/g,' ');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function refreshAccessToken(mat:any){
  const googleClientId=trim(mat?.client_id,300),googleClientSecret=trim(mat?.client_secret,500),refreshToken=trim(mat?.refresh_token,2000);
  if(!googleClientId||!googleClientSecret||!refreshToken)throw Object.assign(new Error('Gmail direkte afsendelse er ikke færdigforbundet'),{code:'GMAIL_NOT_CONNECTED',status:412});
  const tokenResp=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:googleClientId,client_secret:googleClientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})
  });
  const tokenData=await tokenResp.json().catch(()=>({}));
  if(!tokenResp.ok||!tokenData.access_token){
    const msg=String(tokenData?.error_description||tokenData?.error||'Google kunne ikke forny Gmail-adgangen');
    throw Object.assign(new Error(msg),{code:'GMAIL_TOKEN_ERROR',status:502});
  }
  return String(tokenData.access_token);
}

async function kickPostprocess(supabaseUrl:string,serviceKey:string,jobId:string){
  const p=fetch(`${supabaseUrl}/functions/v1/gmail-send-postprocess`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+serviceKey},
    body:JSON.stringify({job_id:jobId})
  }).then(async r=>{if(!r.ok)console.error('[gmail-direct-send] postprocess kick failed',r.status,await r.text().catch(()=>''))})
    .catch(e=>console.error('[gmail-direct-send] postprocess kick error',e));
  const edgeRuntime=(globalThis as any).EdgeRuntime;
  if(edgeRuntime?.waitUntil)edgeRuntime.waitUntil(p);else void p;
}

async function recoverProviderState(admin:any,job:any,mat:any,supabaseUrl:string,serviceKey:string){
  if(!job?.message_rfc822_id)return {state:'unknown',reason:'missing_message_id'};
  let accessToken='';
  try{accessToken=await refreshAccessToken(mat)}catch(e){return {state:'unknown',reason:'token_error',error:e instanceof Error?e.message:String(e)}}
  const q=new URLSearchParams({q:`rfc822msgid:${job.message_rfc822_id}`,maxResults:'1'});
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q.toString(),{headers:{Authorization:'Bearer '+accessToken}});
  const data=await r.json().catch(()=>({}));
  if(r.status===403)return {state:'unknown',reason:'gmail_search_scope'};
  if(!r.ok)return {state:'unknown',reason:'gmail_search_error',error:String(data?.error?.message||r.status)};
  const found=Array.isArray(data?.messages)&&data.messages[0];
  if(found?.id){
    const now=new Date().toISOString();
    const {data:updated,error}=await admin.from('crm_mail_send_jobs').update({
      status:'sent_pending_postprocess',
      gmail_message_id:String(found.id),
      gmail_thread_id:String(found.threadId||found.id),
      sent_at:job.sent_at||now,
      updated_at:now,
      last_status_check_at:now,
      error_code:null,
      error_message:null
    }).eq('id',job.id).select('id,status,gmail_message_id,gmail_thread_id').single();
    if(error)throw error;
    await kickPostprocess(supabaseUrl,serviceKey,job.id);
    return {state:'sent',job:updated,recovered:true};
  }
  return {state:'not_found'};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return json({error:'Mangler login-token'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
    if(userError||!user?.id||!user?.email)return json({error:'Ugyldigt login'},401);

    const body=await req.json().catch(()=>({}));
    const action=trim(body.action,30)||'send';
    const clientId=trim(body.client_id,80);
    let requestId=trim(body.request_id,80);
    if(action==='send'&&!requestId)requestId=crypto.randomUUID();
    if(!clientId||!requestId||!uuidOk(requestId))return json({error:'Mangler gyldigt klient- eller send-id',code:'SEND_ID_INVALID'},400);

    const {data:membership,error:memberError}=await admin.from('crm_users')
      .select('email,client_id,role,auth_user_id')
      .eq('client_id',clientId).eq('auth_user_id',user.id).eq('active',true).maybeSingle();
    if(memberError)throw memberError;
    if(!membership)return json({error:'Ingen adgang til denne klient'},403);

    let {data:existing,error:existingError}=await admin.from('crm_mail_send_jobs')
      .select('*').eq('client_id',clientId).eq('send_id',requestId).maybeSingle();
    if(existingError)throw existingError;

    if(existing){
      if(['sent','sent_pending_postprocess','postprocessing'].includes(existing.status)){
        if(existing.status!=='sent')await kickPostprocess(supabaseUrl,serviceKey,existing.id);
        return json({ok:true,sent:true,status:existing.status,send_id:requestId,job_id:existing.id,id:existing.gmail_message_id,thread_id:existing.gmail_thread_id,reused:true});
      }
      if(existing.status==='failed'){
        return json({error:existing.error_message||'Det tidligere sendeforsøg fejlede',code:existing.error_code||'SEND_FAILED',status:'failed',send_id:requestId},409);
      }

      const ageMs=Date.now()-new Date(existing.updated_at||existing.created_at).getTime();
      if(ageMs>=12000){
        const {data:mat}=await admin.rpc('get_gmail_oauth_material',{p_client_id:clientId});
        const recovered=await recoverProviderState(admin,existing,mat,supabaseUrl,serviceKey);
        if(recovered.state==='sent'){
          return json({ok:true,sent:true,status:'sent_pending_postprocess',send_id:requestId,job_id:existing.id,id:recovered.job?.gmail_message_id,thread_id:recovered.job?.gmail_thread_id,recovered:true});
        }
        if(recovered.state==='not_found'&&ageMs>=120000){
          const now=new Date().toISOString();
          await admin.from('crm_mail_send_jobs').update({
            status:'failed',error_code:'SEND_INTERRUPTED_NOT_FOUND',
            error_message:'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen efter 2 minutter.',
            updated_at:now,last_status_check_at:now
          }).eq('id',existing.id);
          return json({error:'Afsendelsen blev afbrudt før Gmail kunne bekræfte mailen. Du kan prøve igen.',code:'SEND_INTERRUPTED_NOT_FOUND',status:'failed',send_id:requestId},409);
        }
      }
      return json({ok:false,sent:false,status:existing.status||'sending',send_id:requestId,job_id:existing.id,code:'SEND_IN_PROGRESS'},202);
    }

    if(action==='status')return json({error:'Sendeforsøget blev ikke fundet',code:'SEND_JOB_NOT_FOUND'},404);

    const leadId=trim(body.lead_id,80),offerId=trim(body.offer_id,80),to=trim(body.to,320).toLowerCase(),subject=trim(body.subject,700),mailBody=trim(body.body,12000),aiGenerated=!!body.ai_generated,aiModel=trim(body.ai_model,100)||null;
    let followUpDate=trim(body.follow_up_date,10),followUpAt=trim(body.follow_up_at,60);
    if(!followUpDate){const d=new Date();d.setUTCDate(d.getUTCDate()+7);followUpDate=ymd(d)}
    if(!dateOk(followUpDate))return json({error:'Opfølgningsdatoen er ugyldig',code:'FOLLOWUP_DATE_INVALID'},400);
    if(followUpAt&&Number.isNaN(new Date(followUpAt).getTime()))return json({error:'Opfølgningstidspunktet er ugyldigt',code:'FOLLOWUP_AT_INVALID'},400);
    if(!followUpAt)followUpAt=followUpDate+'T08:00:00.000Z';
    if((!leadId&&!offerId)||!emailOk(to)||!subject||!mailBody)return json({error:'Mangler gyldig kunde/tilbud, modtager, emne eller mailtekst'},400);

    const clientP=admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single();
    const leadP=leadId?admin.from('crm_leads').select('id,company_id,status,priority,planning_type,next_action,next_at').eq('id',leadId).eq('client_id',clientId).maybeSingle():Promise.resolve({data:null,error:null});
    const offerP=offerId?admin.from('crm_offers').select('id,company_id,lead_id,offer_ref,customer_name,contact_person,contact_details,follow_up_owner,status,follow_up_date').eq('id',offerId).eq('client_id',clientId).maybeSingle():Promise.resolve({data:null,error:null});
    const materialP=admin.rpc('get_gmail_oauth_material',{p_client_id:clientId});
    const limitsP=admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle();
    const usageP=admin.rpc('crm_usage_snapshot',{p_client_id:clientId});
    const [clientR,leadR,offerR,materialR,limitsR,usageR]=await Promise.all([clientP,leadP,offerP,materialP,limitsP,usageP]);
    const {data:client,error:clientError}=clientR as any,{data:lead,error:leadError}=leadR as any,{data:offer,error:offerError}=offerR as any,{data:mat,error:matError}=materialR as any,{data:limits}=limitsR as any,{data:usage}=usageR as any;
    if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);
    if(leadError)throw leadError;if(leadId&&!lead)return json({error:'Lead blev ikke fundet'},404);
    if(offerError)throw offerError;if(offerId&&!offer)return json({error:'Tilbuddet blev ikke fundet'},404);
    if(matError)throw matError;
    if(lead&&offer&&lead.company_id&&offer.company_id&&lead.company_id!==offer.company_id)return json({error:'Lead og tilbud peger ikke på samme kunde',code:'ENTITY_MISMATCH'},409);
    const companyId=String(offer?.company_id||lead?.company_id||'');
    if(!companyId)return json({error:'Tilbuddet er ikke koblet til en kunde',code:'OFFER_NO_COMPANY'},412);
    const effectiveLeadId=String(lead?.id||offer?.lead_id||'')||null;

    if(limits&&limits.allow_mail_send===false)return json({error:'Mailafsendelse er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
    const dailyLimit=Number(limits?.daily_mail_send_limit||100),sentToday=Number(usage?.mail_sends_today||0);
    if(sentToday>=dailyLimit)return json({error:'Dagens fair-use grænse for mails er nået',code:'MAIL_DAILY_LIMIT',limit:dailyLimit},429);

    const from=String(client.settings?.mail||mat?.account||'').trim().toLowerCase(),connectedAccount=String(mat?.account||'').trim().toLowerCase(),fromName=senderName(client);
    if(!emailOk(from))return json({error:'Afsendermail mangler i kundeprofilen',code:'FROM_NOT_CONFIGURED'},412);
    if(!connectedAccount||connectedAccount!==from)return json({error:`Den forbundne Gmail-konto (${connectedAccount||'ingen'}) matcher ikke kundens afsendermail (${from})`,code:'FROM_ACCOUNT_MISMATCH'},412);

    const [{data:contactRows,error:contactFindError},{data:companyRow,error:companyFindError}]=await Promise.all([
      admin.from('crm_contacts').select('id,email,verified').eq('client_id',clientId).eq('company_id',companyId),
      admin.from('crm_companies').select('id,email').eq('id',companyId).eq('client_id',clientId).maybeSingle()
    ]);
    if(contactFindError)throw contactFindError;if(companyFindError)throw companyFindError;
    let contact=(contactRows||[]).find((c:any)=>String(c.email||'').trim().toLowerCase()===to);
    const companyEmail=String(companyRow?.email||'').trim().toLowerCase();
    if(!contact&&companyEmail&&companyEmail===to){
      const now=new Date().toISOString();
      const {data:created,error:createContactError}=await admin.from('crm_contacts').insert({
        client_id:clientId,company_id:companyId,full_name:null,email:to,verified:true,verified_at:now,
        source_type:'company_standard_email',source_url:null,confidence:'high',email_is_inferred:false,
        email_verification_method:'company_record',email_verified_at:now
      }).select('id,email,verified').single();
      if(createContactError)throw createContactError;contact=created;
    }
    if(!contact&&offer){
      const now=new Date().toISOString();
      const {data:created,error:createContactError}=await admin.from('crm_contacts').insert({
        client_id:clientId,company_id:companyId,full_name:trim(offer.contact_person,180)||null,email:to,
        verified:true,verified_at:now,source_type:'manual_offer_mail',source_url:null,confidence:'high',
        email_is_inferred:false,email_verification_method:'manual_user_confirmed',email_verified_at:now
      }).select('id,email,verified').single();
      if(createContactError)throw createContactError;contact=created;
    }
    if(!contact)return json({error:'Modtageren matcher hverken en kontaktmail eller virksomhedens standardmail. Kontrollér adressen først.',code:'RECIPIENT_NOT_ON_CUSTOMER'},412);

    const approvalPayload={
      to,subject,body:mailBody,company_id:companyId,offer_id:offer?.id||null,include_signature:true,
      signature_key:'client_default',approved_by:user.email,approval_method:'explicit_send_button',
      follow_up_date:followUpDate,follow_up_at:followUpAt,sender_name:fromName,send_id:requestId
    };
    const {data:approval,error:approvalError}=await admin.from('crm_approvals').insert({
      client_id:clientId,lead_id:effectiveLeadId,action_type:'send_email',status:'approved',
      decided_at:new Date().toISOString(),payload:approvalPayload,ai_generated:aiGenerated,ai_model:aiModel
    }).select('id,status,payload').single();
    if(approvalError)throw approvalError;
    if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret som mulig dobbeltkontakt',code:'DUPLICATE_BLOCKED'},409);

    const sigText=String(client.settings?.mail_signature_text||'').trim(),sigHtml=String(client.settings?.mail_signature_html||'').trim();
    const messageRfc822Id=`<lm-${requestId}@lead-manager.invalid>`;
    const now=new Date().toISOString();
    const {data:job,error:jobError}=await admin.from('crm_mail_send_jobs').insert({
      client_id:clientId,send_id:requestId,user_id:user.id,user_email:user.email,company_id:companyId,
      lead_id:effectiveLeadId,offer_id:offer?.id||null,contact_id:contact.id,approval_id:approval.id,
      to_email:to,subject,body_text:mailBody,follow_up_date:followUpDate,follow_up_at:followUpAt,
      from_email:from,sender_name:fromName,ai_generated:aiGenerated,ai_model:aiModel,
      signature_appended:!!(sigText||sigHtml),message_rfc822_id:messageRfc822Id,status:'prepared'
    }).select('*').single();
    if(jobError)throw jobError;

    await admin.from('crm_mail_send_jobs').update({status:'sending',attempt_count:1,updated_at:new Date().toISOString()}).eq('id',job.id);

    let accessToken='';
    try{accessToken=await refreshAccessToken(mat)}
    catch(e:any){
      const msg=e instanceof Error?e.message:String(e),code=String(e?.code||'GMAIL_TOKEN_ERROR');
      await Promise.all([
        admin.from('crm_mail_send_jobs').update({status:'failed',error_code:code,error_message:msg,updated_at:new Date().toISOString()}).eq('id',job.id),
        admin.from('crm_approvals').update({status:'rejected',payload:{...(approval?.payload||{}),send_error:msg}}).eq('id',approval.id),
        admin.from('crm_integrations').update({last_error:msg,updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','gmail')
      ]);
      return json({error:msg,code},Number(e?.status||502));
    }

    const plain=mailBody+(sigText?'\n\n'+sigText:'');
    const htmlBody='<div style="font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.5">'+escHtml(mailBody).replaceAll('\n','<br>')+'</div>'+(sigHtml?sigHtml:'');
    const boundary='lm_'+crypto.randomUUID().replaceAll('-',''),fromHeader=fromName?`${b64header(fromName)} <${from}>`:from;
    const mime=[
      `Message-ID: ${messageRfc822Id}`,`From: ${fromHeader}`,`To: ${to}`,`Subject: ${b64header(subject)}`,
      'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',
      `--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',plain,'',
      `--${boundary}`,'Content-Type: text/html; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',htmlBody,'',
      `--${boundary}--`,''
    ].join('\r\n');

    const sendResp=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
      method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
      body:JSON.stringify({raw:b64url(mime)})
    });
    const sent=await sendResp.json().catch(()=>({}));
    if(!sendResp.ok||!sent.id){
      const msg=String(sent?.error?.message||`Gmail send fejlede (${sendResp.status})`);
      const failedAt=new Date().toISOString();
      await Promise.all([
        admin.from('crm_mail_send_jobs').update({status:'failed',error_code:'GMAIL_SEND_ERROR',error_message:msg,updated_at:failedAt}).eq('id',job.id),
        admin.from('crm_approvals').update({status:'rejected',payload:{...(approval?.payload||{}),send_error:msg}}).eq('id',approval.id),
        admin.from('crm_integrations').update({last_error:msg,updated_at:failedAt}).eq('client_id',clientId).eq('provider','gmail')
      ]);
      return json({error:msg,code:'GMAIL_SEND_ERROR'},502);
    }

    const sentAt=new Date().toISOString();
    const {error:markError}=await admin.from('crm_mail_send_jobs').update({
      status:'sent_pending_postprocess',gmail_message_id:String(sent.id),gmail_thread_id:String(sent.threadId||sent.id),
      sent_at:sentAt,updated_at:sentAt,error_code:null,error_message:null
    }).eq('id',job.id);
    if(markError)throw markError;

    await kickPostprocess(supabaseUrl,serviceKey,job.id);
    return json({
      ok:true,sent:true,status:'sent_pending_postprocess',send_id:requestId,job_id:job.id,
      id:String(sent.id),thread_id:String(sent.threadId||sent.id),from,from_name:fromName,to,subject,
      follow_up_date:followUpDate,follow_up_at:followUpAt,offer_id:offer?.id||null,lead_id:effectiveLeadId,
      client_name:client.name,provider:'gmail'
    });
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:'Ukendt fejl',code:'MAIL_SEND_INTERNAL_ERROR'},500);
  }
});
