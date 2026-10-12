'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const recovery=fs.readFileSync('supabase/functions/_shared/mail-status-recovery.ts','utf8');
const worker=fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');
const offerSend=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
for(const marker of [
 "metadata',{original_failed_send_job_id:job.id,manual_resend_after_quota:true,provider_accepted:true}",
 "msg.labelIds.includes('SENT')",
 "norm(header('To')).includes(norm(job.to_email))",
 "norm(header('Subject'))!==norm(job.subject)",
 ".eq('client_id',job.client_id).eq('status','failed')",
 "previous_status:'failed',previous_error_code:job.error_code",
 "status:'sent'",
 "error_code:null,error_message:null",
 "payload.send_error_resolved=true",
 "payload.original_send_error=",
 "if(!job.offer_id&&!job.lead_id)return null",
 ".eq('to_email',job.to_email).eq('subject',job.subject)",
 ".eq('follow_up_date',job.follow_up_date).eq('status','sent')",
 ".not('sent_at','is',null).not('postprocessed_at','is',null)",
 "new Date(job.created_at).getTime()+48*3600000",
 "last_status_check_at.lt.",
 "return results;"
])assert(recovery.includes(marker),'Missing send-status recovery guard: '+marker);
assert(!recovery.includes(".update({status:'approved'"),'A corrected send must not re-approve an already attempted mail');
assert(recovery.includes(".update({payload})"),'Resolution is recorded as approval metadata only');
assert(!recovery.includes('/messages/send'),'Recovery must not send mails');
assert(!recovery.includes('gmailSendMime('),'Recovery must not send MIME');
assert(!recovery.includes("status:'sent',sent_at:now"),'Recovery must use verified provider time');
assert(worker.includes('reconcileResolvedFailedJobs(admin,Math.min(limit,10))'),'Existing cron must invoke status reconciliation');
assert(worker.includes("if(jobId){"),'Explicit postprocess must remain available');
assert(offerSend.includes("status:'sent_pending_postprocess'"),'Normal provider-confirmed jobs must still transition through postprocessing');
console.log('PASS: confirmed resend changes job and approval to sent/approved, preserves error audit, forbids unsafe or duplicate resends');
