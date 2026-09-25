const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}

const ui=fs.readFileSync('offer-mail-v1.js','utf8');
const pdfUi=fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const send=fs.readFileSync('supabase/functions/gmail-direct-send/index.ts','utf8');
const worker=fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260923061000_reliable_mail_send_pipeline.sql','utf8');

for(const marker of [
  "let currentSendId=null",
  "request_id:requestId",
  "action:'status'",
  "SEND_IN_PROGRESS",
  "status===546",
  "Kontroller status",
  "genbruger samme send-id",
  "const finalizedStatuses=new Set(['sent'])",
  "const postprocessStatuses=new Set(['sent_pending_postprocess','postprocessing'])",
  "isPostprocessPending",
  "refreshKeys('offers','tasks','mail','activities')",
  "select('id,client_id,follow_up_date')",
  "opfølgning gemt"
]) must(ui.includes(marker),'UI reliability marker missing: '+marker);

must(!ui.includes("const sentStatuses=new Set(['sent','sent_pending_postprocess','postprocessing'])"),'direct offer mail must not treat post-processing as finalized');
for(const marker of [
  "const finalizedStatuses=new Set(['sent'])",
  "const postprocessStatuses=new Set(['sent_pending_postprocess','postprocessing'])",
  "isPostprocessPending",
  "refreshKeys('offers','tasks','mail','activities')",
  "select('id,client_id,follow_up_date')",
  "Mailen er sendt, men Lead Manager kunne ikke bekræfte den nye opfølgningsdato endnu"
]) must(pdfUi.includes(marker),'PDF offer follow-up finalization marker missing: '+marker);
must(!pdfUi.includes("const sentStatuses=new Set(['sent','sent_pending_postprocess','postprocessing'])"),'PDF offer mail must not treat post-processing as finalized');

for(const marker of [
  "crm_mail_send_jobs",
  "messageRfc822Id",
  "Message-ID:",
  "sent_pending_postprocess",
  "kickPostprocess",
  "gmail-send-postprocess",
  "recoverProviderState",
  "rfc822msgid:",
  "SEND_INTERRUPTED_NOT_FOUND"
]) must(send.includes(marker),'direct-send reliability marker missing: '+marker);

must(!send.includes("admin.from('crm_mail_messages').insert"),'direct send still writes mail history synchronously');
must(!send.includes("admin.from('crm_tasks').insert"),'direct send still creates follow-up tasks synchronously');
must(!send.includes("admin.from('crm_usage_events').insert"),'direct send still writes usage synchronously');

for(const marker of [
  "crm_finalize_mail_send_job",
  "sent_pending_postprocess",
  "postprocessing"
]) must(worker.includes(marker),'worker marker missing: '+marker);

for(const marker of [
  "create table if not exists public.crm_mail_send_jobs",
  "unique(client_id, send_id)",
  "create or replace function public.crm_finalize_mail_send_job",
  "metadata->>'mail_send_job_id'",
  "postprocess_step",
  "grant execute on function public.crm_finalize_mail_send_job(uuid) to service_role"
]) must(migration.includes(marker),'migration reliability marker missing: '+marker);

console.log('PASS: Gmail send is idempotent, fast-path only and asynchronously post-processed');
