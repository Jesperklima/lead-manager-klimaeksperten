import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
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
const fromB64Url=(s:string)=>{let x=String(s||'').replaceAll('-','+').replaceAll('_','/');while(x.length%4)x+='=';return x};
const wrap76=(s:string)=>s.match(/.{1,76}/g)?.join('\r\n')||s;

function findAttachmentPart(payload:any,target:string):any{
  if(!payload)return null;
  const filename=String(payload.filename||'').trim();
  if(filename&&filename.toLowerCase()===target.toLowerCase()&&String(payload.mimeType||'').toLowerCase()==='application/pdf')return payload;
  for(const p of payload.parts||[]){const found=findAttachmentPart(p,target);if(found)return found}
  return null;
}

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
  }).then(async r=>{if(!r.ok)console.error('[gmail-offer-send] postprocess kick failed',r.status,await r.text().catch(()=>''))})
    .catch(e=>console.error('[gmail-offer-send] postprocess kick error',e));
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
    }).eq('id',job.id).select('*').single();
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
        return json({
          ok:true,sent:true,status:existing.status,send_id:requestId,job_id:existing.id,
          id:existing.gmail_message_id,thread_id:existing.gmail_thread_id,reused:true,
          attachment:existing.attachment_filename?{filename:existing.attachment_filename,source:existing.attachment_source}:null
        });
      }
      if(existing.status==='failed'){
        return json({error:existing.error_message||'Det tidligere sendeforsøg fejlede',code:existing.error_code||'SEND_FAILED',status:'failed',send_id:requestId},409);
      }

      const ageMs=Date.now()-new Date(existing.updated_at||existing.created_at).getTime();
      if(ageMs>=12000){
        const {data:mat}=await admin.rpc('get_gmail_oauth_material',{p_client_id:clientId});
        const recovered=await recoverProviderState(admin,existing,mat,supabaseUrl,serviceKey);
        if(recovered.state==='sent'){
          return json({
            ok:true,sent:true,status:'sent_pending_postprocess',send_id:requestId,job_id:existing.id,
            id:recovered.job?.gmail_message_id,thread_id:recovered.job?.gmail_thread_id,recovered:true,
            attachment:existing.attachment_filename?{filename:existing.attachment_filename,source:existing.attachment_source}:null
          });
        }
        if(recovered.state==='not_found'&&ageMs>=120000){
          const now=new Date().toISOString();
          await admin.from('crm_mail_send_jobs').update({
            status:'failed',error_code:'SEND_INTERRUPTED_NOT_FOUND',
            error_message:'Afsendelsen blev afbrudt, og Gmail kunne ikke finde mailen efter 2 minutter.',
            updated_at:now,last_status_check_at:now
          }).eq('id',existing.id);
          if(existing.approval_id){
            const {data:oldApproval}=await admin.from('crm_approvals').select('payload').eq('id',existing.approval_id).maybeSingle();
            await admin.from('crm_approvals').update({
              status:'rejected',payload:{...(oldApproval?.payload||{}),send_error:'Afsendelsen blev afbrudt før Gmail kunne bekræfte mailen.'}
            }).eq('id',existing.approval_id);
          }
          return json({error:'Afsendelsen blev afbrudt før Gmail kunne bekræfte mailen. Du kan prøve igen.',code:'SEND_INTERRUPTED_NOT_FOUND',status:'failed',send_id:requestId},409);
        }
      }
      return json({ok:false,sent:false,status:existing.status||'sending',send_id:requestId,job_id:existing.id,code:'SEND_IN_PROGRESS'},202);
    }

    if(action==='status')return json({error:'Sendeforsøget blev ikke fundet',code:'SEND_JOB_NOT_FOUND'},404);

    const offerId=trim(body.offer_id,80),leadId=trim(body.lead_id,80),to=trim(body.to,320).toLowerCase(),subject=trim(body.subject,700),mailBody=trim(body.body,12000);
    let followUpDate=trim(body.follow_up_date,10),followUpAt=trim(body.follow_up_at,60);
    if(!followUpDate){const d=new Date();d.setUTCDate(d.getUTCDate()+7);followUpDate=ymd(d)}
    if(!dateOk(followUpDate))return json({error:'Opfølgningsdatoen er ugyldig',code:'FOLLOWUP_DATE_INVALID'},400);
    if(followUpAt&&Number.isNaN(new Date(followUpAt).getTime()))return json({error:'Opfølgningstidspunktet er ugyldigt',code:'FOLLOWUP_AT_INVALID'},400);
    if(!followUpAt)followUpAt=followUpDate+'T08:00:00.000Z';
    if(!offerId||!emailOk(to)||!subject||!mailBody)return json({error:'Mangler gyldigt tilbud, modtager, emne eller mailtekst'},400);

    const [clientR,offerR,materialR,limitsR,usageR]=await Promise.all([
      admin.from('crm_clients').select('id,name,settings').eq('id',clientId).single(),
      admin.from('crm_offers').select('id,company_id,lead_id,offer_ref,customer_name,contact_person,contact_details,follow_up_owner,status,follow_up_date').eq('id',offerId).eq('client_id',clientId).maybeSingle(),
      admin.rpc('get_gmail_oauth_material',{p_client_id:clientId}),
      admin.from('crm_usage_limits').select('*').eq('client_id',clientId).maybeSingle(),
      admin.rpc('crm_usage_snapshot',{p_client_id:clientId})
    ]);
    const {data:client,error:clientError}=clientR as any,{data:offer,error:offerError}=offerR as any,{data:mat,error:matError}=materialR as any,{data:limits}=limitsR as any,{data:usage}=usageR as any;
    if(clientError||!client)return json({error:'Kundeprofil blev ikke fundet'},404);
    if(offerError)throw offerError;if(!offer)return json({error:'Tilbuddet blev ikke fundet'},404);
    if(matError)throw matError;

    const companyId=String(offer.company_id||'');if(!companyId)return json({error:'Tilbuddet er ikke koblet til en kunde',code:'OFFER_NO_COMPANY'},412);
    const effectiveLeadId=String(leadId||offer.lead_id||'')||null;
    const offerRef=trim(offer.offer_ref,160);if(!offerRef)return json({error:'Tilbudsnummer mangler, så den rigtige PDF kan ikke findes',code:'OFFER_REF_MISSING'},412);

    if(limits&&limits.allow_mail_send===false)return json({error:'Mailafsendelse er ikke inkluderet i denne pakke',code:'PLAN_MAIL_DISABLED'},403);
    const dailyLimit=Number(limits?.daily_mail_send_limit||100),sentToday=Number(usage?.mail_sends_today||0);
    if(sentToday>=dailyLimit)return json({error:'Dagens fair-use grænse for mails er nået',code:'MAIL_DAILY_LIMIT',limit:dailyLimit},429);

    const from=String(client.settings?.mail||mat?.account||'').trim().toLowerCase(),connectedAccount=String(mat?.account||'').trim().toLowerCase(),fromName=senderName(client);
    if(!emailOk(from))return json({error:'Afsendermail mangler i kundeprofilen',code:'FROM_NOT_CONFIGURED'},412);
    if(!connectedAccount||connectedAccount!==from)return json({error:`Den forbundne Gmail-konto (${connectedAccount||'ingen'}) matcher ikke kundens afsendermail (${from})`,code:'FROM_ACCOUNT_MISMATCH'},412);

    let accessToken='';
    try{accessToken=await refreshAccessToken(mat)}
    catch(e:any){
      const msg=e instanceof Error?e.message:String(e);
      await admin.from('crm_integrations').update({last_error:msg,updated_at:new Date().toISOString()}).eq('client_id',clientId).eq('provider','gmail');
      return json({error:msg,code:String(e?.code||'GMAIL_TOKEN_ERROR')},Number(e?.status||502));
    }

    const pdfName=`Tilbud ${offerRef}.pdf`;
    const searchQ=`filename:"${pdfName.replaceAll('\\','').replaceAll('"','')}"`;
    const searchResp=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q='+encodeURIComponent(searchQ),{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
    const searchData=await searchResp.json().catch(()=>({}));
    if(!searchResp.ok)return json({error:'Kunne ikke søge efter den oprindelige Minuba-PDF i mailen',code:'OFFER_PDF_SEARCH_ERROR'},502);

    let attachmentB64='',sourceMessageId='';
    for(const m of searchData.messages||[]){
      const mid=String(m.id||'');if(!mid)continue;
      const mr=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mid)}?format=full`,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
      if(!mr.ok)continue;
      const msg=await mr.json().catch(()=>({}));
      const part=findAttachmentPart(msg.payload,pdfName);if(!part)continue;
      if(part.body?.data){attachmentB64=fromB64Url(part.body.data);sourceMessageId=mid;break}
      const aid=String(part.body?.attachmentId||'');if(!aid)continue;
      const ar=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mid)}/attachments/${encodeURIComponent(aid)}`,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}});
      if(!ar.ok)continue;
      const ad=await ar.json().catch(()=>({}));
      if(ad?.data){attachmentB64=fromB64Url(ad.data);sourceMessageId=mid;break}
    }
    if(!attachmentB64)return json({error:`Den originale ${pdfName} blev ikke fundet. Mailen er ikke sendt uden tilbuddet vedhæftet.`,code:'OFFER_PDF_NOT_FOUND',offer_ref:offerRef,expected_filename:pdfName},412);
    if(!attachmentB64.startsWith('JVBERi0'))return json({error:`Filen ${pdfName} blev fundet, men den er ikke en gyldig PDF. Mailen er ikke sendt.`,code:'OFFER_PDF_INVALID'},412);

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
    if(!contact){
      const now=new Date().toISOString();
      const {data:created,error:createContactError}=await admin.from('crm_contacts').insert({
        client_id:clientId,company_id:companyId,full_name:trim(offer.contact_person,180)||null,email:to,
        verified:true,verified_at:now,source_type:'manual_offer_mail',source_url:null,confidence:'high',
        email_is_inferred:false,email_verification_method:'manual_user_confirmed',email_verified_at:now
      }).select('id,email,verified').single();
      if(createContactError)throw createContactError;contact=created;
    }

    let approval:any=null;
    const {data:sameApprovals,error:sameApprovalError}=await admin.from('crm_approvals')
      .select('id,status,payload,created_at')
      .eq('client_id',clientId).eq('action_type','send_email')
      .contains('payload',{send_id:requestId})
      .order('created_at',{ascending:false}).limit(1);
    if(sameApprovalError)throw sameApprovalError;
    approval=sameApprovals?.[0]||null;

    if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret',code:'DUPLICATE_BLOCKED'},409);
    if(approval?.status==='rejected')return json({error:approval.payload?.send_error||'Det tidligere sendeforsøg blev afvist',code:'SEND_APPROVAL_REJECTED'},409);

    if(!approval){
      const approvalPayload={
        to,subject,body:mailBody,company_id:companyId,offer_id:offer.id,offer_ref:offerRef,
        customer_name:offer.customer_name||null,include_signature:true,signature_key:'client_default',
        approved_by:user.email,approval_method:'explicit_send_button',follow_up_date:followUpDate,
        follow_up_at:followUpAt,sender_name:fromName,send_id:requestId,
        attachment:{filename:pdfName,source:'minuba_original_mail',source_message_id:sourceMessageId}
      };
      const {data:createdApproval,error:approvalError}=await admin.from('crm_approvals').insert({
        client_id:clientId,lead_id:effectiveLeadId,action_type:'send_email',status:'approved',
        decided_at:new Date().toISOString(),payload:approvalPayload,ai_generated:false,ai_model:null
      }).select('id,status,payload').single();
      if(approvalError)throw approvalError;
      approval=createdApproval;
      if(approval?.status==='blocked')return json({error:approval.payload?.block_reason||'Mailen blev blokeret som mulig dobbeltkontakt',code:'DUPLICATE_BLOCKED'},409);
    }

    const sigText=String(client.settings?.mail_signature_text||'').trim(),sigHtml=String(client.settings?.mail_signature_html||'').trim();
    const messageRfc822Id=`<lm-${requestId}@lead-manager.invalid>`;

    const {data:job,error:jobError}=await admin.from('crm_mail_send_jobs').insert({
      client_id:clientId,send_id:requestId,user_id:user.id,user_email:user.email,company_id:companyId,
      lead_id:effectiveLeadId,offer_id:offer.id,contact_id:contact.id,approval_id:approval.id,
      to_email:to,subject,body_text:mailBody,follow_up_date:followUpDate,follow_up_at:followUpAt,
      from_email:from,sender_name:fromName,ai_generated:false,ai_model:null,
      signature_appended:!!(sigText||sigHtml),message_rfc822_id:messageRfc822Id,status:'sending',attempt_count:1,
      attachment_filename:pdfName,attachment_source:'minuba_original_mail',source_message_id:sourceMessageId
    }).select('*').single();
    if(jobError){
      if(String(jobError.code||'')==='23505'){
        const {data:raceJob,error:raceError}=await admin.from('crm_mail_send_jobs').select('*').eq('client_id',clientId).eq('send_id',requestId).single();
        if(raceError)throw raceError;
        return json({ok:false,sent:false,status:raceJob.status,send_id:requestId,job_id:raceJob.id,code:'SEND_IN_PROGRESS'},202);
      }
      throw jobError;
    }

    const plain=mailBody+(sigText?'\n\n'+sigText:'');
    const htmlBody='<div style="font-family:Arial,sans-serif;font-size:10.5pt;line-height:1.5">'+escHtml(mailBody).replaceAll('\n','<br>')+'</div>'+(sigHtml?sigHtml:'');
    const mixed='lm_mix_'+crypto.randomUUID().replaceAll('-',''),alt='lm_alt_'+crypto.randomUUID().replaceAll('-',''),fromHeader=fromName?`${b64header(fromName)} <${from}>`:from;
    const mime=[
      `Message-ID: ${messageRfc822Id}`,`From: ${fromHeader}`,`To: ${to}`,`Subject: ${b64header(subject)}`,
      'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${mixed}"`,'',
      `--${mixed}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',
      `--${alt}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',plain,'',
      `--${alt}`,'Content-Type: text/html; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',htmlBody,'',`--${alt}--`,'',
      `--${mixed}`,`Content-Type: application/pdf; name="${pdfName}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${pdfName}"`,'',wrap76(attachmentB64),'',`--${mixed}--`,''
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
      follow_up_date:followUpDate,offer_id:offer.id,lead_id:effectiveLeadId,client_name:client.name,
      provider:'gmail',attachment:{filename:pdfName,source:'minuba_original_mail'}
    });
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:'Ukendt fejl',code:'OFFER_MAIL_SEND_INTERNAL_ERROR'},500);
  }
});
