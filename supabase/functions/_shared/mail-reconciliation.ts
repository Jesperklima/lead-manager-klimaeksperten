// Reconciliation reads the provider's Sent folder. It never submits or retries a mail.
export async function reconcileMailJob(admin:any,job:any){
 const now=new Date().toISOString();
 let patch:any={status:'unknown',last_status_check_at:now,updated_at:now,error_code:'SEND_OUTCOME_UNKNOWN',error_message:'Afsendelsen er ikke bekræftet. Kontrollér Sendt-mappen før en ny afsendelse.'};
 if(job.provider==='gmail'){
  const material=await admin.rpc('get_gmail_oauth_material',{p_client_id:job.client_id});
  if(material.error)throw material.error;
  const m=material.data||{};
  if(!m.client_id||!m.client_secret||!m.refresh_token)throw new Error('GMAIL_RECONCILIATION_NOT_CONNECTED');
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:m.client_id,client_secret:m.client_secret,refresh_token:m.refresh_token,grant_type:'refresh_token'})});
  const token=await tokenResponse.json().catch(()=>({}));
  if(!tokenResponse.ok||!token.access_token)throw new Error('GMAIL_RECONCILIATION_TOKEN_ERROR');
  const params=new URLSearchParams({q:'in:sent rfc822msgid:'+job.message_rfc822_id,maxResults:'1'});
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+params,{headers:{Authorization:'Bearer '+token.access_token}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('GMAIL_RECONCILIATION_SEARCH_ERROR:'+response.status);
  const found=data.messages?.[0];
  if(found?.id)patch={status:'sent_pending_postprocess',gmail_message_id:String(found.id),gmail_thread_id:String(found.threadId||found.id),sent_at:job.sent_at||now,last_status_check_at:now,updated_at:now,error_code:null,error_message:null};
 }
 const updated=await admin.from('crm_mail_send_jobs').update(patch).eq('id',job.id).in('status',['prepared','sending','unknown']).select('id,status').maybeSingle();
 if(updated.error)throw updated.error;
 if(updated.data?.status==='sent_pending_postprocess'){
  const final=await admin.rpc('crm_finalize_mail_send_job',{p_job_id:job.id});
  if(final.error)throw final.error;
  return {job_id:job.id,status:'sent',recovered:true};
 }
 return{job_id:job.id,status:updated.data?.status||job.status,recovered:false};
}
