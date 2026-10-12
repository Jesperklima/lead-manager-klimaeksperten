// Only provider-confirmed deliveries may repair a failed job's *current* status.
// No function in this module sends or resends a message.
const norm=(value:unknown)=>String(value??'').trim().toLowerCase();
const uuid=(s:unknown)=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(s||''));
const text=(v:unknown,max=1000)=>String(v??'').slice(0,max);

type Recovery = {provider_message_id:string;provider_thread_id:string;sent_at:string;source:string;later_job_id?:string};

async function verifiedManualResend(admin:any,job:any,tokenCache:Map<string,string>):Promise<Recovery|null>{
  if(job.provider!=='gmail'||!job.offer_id)return null;
  const {data:rows,error}=await admin.from('crm_mail_messages')
    .select('id,client_id,offer_id,external_message_id,external_thread_id,to_emails,subject,message_at,metadata')
    .eq('client_id',job.client_id).eq('offer_id',job.offer_id).eq('provider','gmail').eq('direction','outbound')
    .contains('metadata',{original_failed_send_job_id:job.id,manual_resend_after_quota:true,provider_accepted:true})
    .order('message_at',{ascending:false}).limit(1);
  if(error)throw error;
  const m=rows?.[0],meta=m?.metadata||{};
  if(!m||!m.external_message_id||!m.message_at||new Date(m.message_at)<=new Date(job.created_at))return null;
  if(norm(m.subject)!==norm(job.subject)||!Array.isArray(m.to_emails)||!m.to_emails.some((v:string)=>norm(v)===norm(job.to_email)))return null;
  if(meta.source!=='manual_gmail_resend_verified'||meta.delivery_confirmed===true&&meta.provider_accepted!==true)return null;
  // A database annotation alone does not prove delivery. Confirm the actual Gmail Sent record.
  let token=tokenCache.get(job.client_id);
  if(!token){
    const material=await admin.rpc('get_gmail_oauth_material',{p_client_id:job.client_id});
    if(material.error)throw material.error;
    const auth=material.data||{};
    if(!auth.client_id||!auth.client_secret||!auth.refresh_token)throw Error('GMAIL_RECOVERY_NOT_CONNECTED');
    const resp=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:auth.client_id,client_secret:auth.client_secret,refresh_token:auth.refresh_token,grant_type:'refresh_token'})
    });
    const body=await resp.json().catch(()=>({}));
    if(!resp.ok||!body.access_token)throw Error('GMAIL_RECOVERY_TOKEN_ERROR');
    token=String(body.access_token);tokenCache.set(job.client_id,token);
  }
  const resp=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(m.external_message_id)+'?format=metadata&metadataHeaders=To&metadataHeaders=Subject',{
    headers:{Authorization:'Bearer '+token}
  });
  if(resp.status===404)return null;
  if(!resp.ok)throw Error('GMAIL_RECOVERY_PROVIDER_ERROR:'+resp.status);
  const msg=await resp.json().catch(()=>({}));
  const header=(name:string)=>String((msg?.payload?.headers||[]).find((h:any)=>norm(h.name)===norm(name))?.value||'');
  if(!Array.isArray(msg.labelIds)||!msg.labelIds.includes('SENT'))return null;
  if(!norm(header('To')).includes(norm(job.to_email))||norm(header('Subject'))!==norm(job.subject))return null;
  return {provider_message_id:String(msg.id),provider_thread_id:String(msg.threadId||msg.id),sent_at:m.message_at,source:'verified_manual_gmail_resend'};
}

async function verifiedLaterSend(admin:any,job:any):Promise<Recovery|null>{
  if(!job.offer_id&&!job.lead_id)return null;
  const cutoff=new Date(new Date(job.created_at).getTime()+48*3600000).toISOString();
  let q=admin.from('crm_mail_send_jobs')
    .select('id,provider_message_id,provider_thread_id,gmail_message_id,gmail_thread_id,sent_at,postprocessed_at')
    .eq('client_id',job.client_id).eq('provider',job.provider)
    .eq('to_email',job.to_email).eq('subject',job.subject)
    .eq('follow_up_date',job.follow_up_date).eq('status','sent')
    .gt('created_at',job.created_at).lte('created_at',cutoff)
    .not('sent_at','is',null).not('postprocessed_at','is',null)
    .order('created_at',{ascending:true}).limit(1);
  q=job.offer_id?q.eq('offer_id',job.offer_id):q.eq('lead_id',job.lead_id).is('offer_id',null);
  const {data,error}=await q;
  if(error)throw error;
  const next=data?.[0];
  const msg=String(next?.provider_message_id||next?.gmail_message_id||'');
  if(!msg)return null;
  return {provider_message_id:msg,provider_thread_id:String(next.provider_thread_id||next.gmail_thread_id||msg),sent_at:String(next.sent_at),source:'later_confirmed_crm_send',later_job_id:next.id};
}

async function fixConfirmedJob(admin:any,job:any,evidence:Recovery){
  const now=new Date().toISOString();
  // Atomic status guard prevents multiple cron workers from resolving the same attempt.
  const {data:changed,error:changeError}=await admin.from('crm_mail_send_jobs')
    .update({status:'sent',gmail_message_id:job.provider==='gmail'?evidence.provider_message_id:job.gmail_message_id,
      gmail_thread_id:job.provider==='gmail'?evidence.provider_thread_id:job.gmail_thread_id,
      provider_message_id:evidence.provider_message_id,provider_thread_id:evidence.provider_thread_id,
      sent_at:evidence.sent_at,postprocessed_at:now,last_status_check_at:now,
      error_code:null,error_message:null,updated_at:now})
    .eq('id',job.id).eq('client_id',job.client_id).eq('status','failed')
    .select('id').maybeSingle();
  if(changeError)throw changeError;
  if(!changed)return {job_id:job.id,status:'already_resolved'};

  // Preserve the original error in the immutable activity trail, without claiming two sends.
  const {error:activityError}=await admin.from('crm_activities').insert({
    client_id:job.client_id,company_id:job.company_id,lead_id:job.lead_id,offer_id:job.offer_id,contact_id:job.contact_id,
    type:'Statuskorrektion',actor_type:'agent',actor_name:'Lead Manager',
    summary:'Mailstatus rettet til Sendt efter verificeret afsendelse: '+job.subject,
    metadata:{source:'confirmed_send_status_recovery',status_recovery_job_id:job.id,
      previous_status:'failed',previous_error_code:job.error_code,previous_error_message:text(job.error_message),
      provider:job.provider,provider_message_id:evidence.provider_message_id,
      evidence_source:evidence.source,later_sent_job_id:evidence.later_job_id||null,
      corrected_at:now,recipient:job.to_email}
  });
  if(activityError)console.error('[mail-status-recovery] audit insert failed',job.id,activityError.message);

  if(job.approval_id){
    const {data:approval,error:approvalError}=await admin.from('crm_approvals')
      .select('id,status,payload').eq('id',job.approval_id).eq('client_id',job.client_id).maybeSingle();
    if(approvalError)throw approvalError;
    if(['rejected','blocked'].includes(approval?.status)){
      // Approval records describe the original authorization attempt. Changing a rejected
      // attempt back to "approved" would correctly trigger the duplicate-send safety guard.
      // Preserve its historical status; annotate the resolved error instead. The send JOB,
      // which is authoritative for delivery, has already been set to "sent".
      const payload={...(approval.payload||{})};
      payload.original_send_error=payload.original_send_error||payload.send_error||job.error_message||null;
      delete payload.send_error;
      payload.send_error_resolved=true;
      payload.corrected_at=now;
      payload.recovery_source=evidence.source;
      payload.verified_provider_message_id=evidence.provider_message_id;
      const {error:approveError}=await admin.from('crm_approvals')
        .update({payload})
        .eq('id',approval.id).eq('client_id',job.client_id);
      if(approveError)throw approveError;
    }
  }
  return {job_id:job.id,status:'sent',source:evidence.source};
}

export async function reconcileResolvedFailedJobs(admin:any,limit=10){
  const checkBefore=new Date(Date.now()-60*60000).toISOString();
  const from=new Date(Date.now()-30*86400000).toISOString();
  const {data:jobs,error}=await admin.from('crm_mail_send_jobs').select('*')
    .eq('status','failed').gte('created_at',from)
    .or('last_status_check_at.is.null,last_status_check_at.lt.'+checkBefore)
    .order('created_at',{ascending:false}).limit(Math.max(1,Math.min(limit,20)));
  if(error)throw error;
  const results:any[]=[],tokens=new Map<string,string>();
  for(const job of jobs||[]){
    try{
      const recovery=await verifiedLaterSend(admin,job)||await verifiedManualResend(admin,job,tokens);
      if(recovery)results.push(await fixConfirmedJob(admin,job,recovery));
      else{
        await admin.from('crm_mail_send_jobs').update({last_status_check_at:new Date().toISOString()})
          .eq('id',job.id).eq('client_id',job.client_id).eq('status','failed');
        results.push({job_id:job.id,status:'failed',recovered:false});
      }
    }catch(e){
      const msg=e instanceof Error?e.message:String(e);
      await admin.from('crm_mail_send_jobs').update({last_status_check_at:new Date().toISOString()})
        .eq('id',job.id).eq('client_id',job.client_id).eq('status','failed');
      results.push({job_id:job.id,status:'failed',error:msg});
    }
  }
  return results;
}
