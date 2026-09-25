const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}

const ui=fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const send=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const worker=fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260923062500_reliable_offer_pdf_send.sql','utf8');
const identityMigration=fs.readFileSync('supabase/migrations/20260925094500_offer_pdf_identity_cache.sql','utf8');

for(const marker of [
  'currentPdfSendId',
  'request_id:requestId',
  "action:'status'",
  'pollOfferSendStatus',
  'status===546',
  'Kontroller status',
  'genbruger samme send-id',
  'checkPdfStatus',
  "action:'pdf_status'",
  'PDF klar',
  'verificeret PDF',
  'minuba_live_render',
  'genererer den fra tilbudsdata i Minuba',
  'Forbereder PDF og sender',
  'FOLLOWUP_SUPPRESSED',
  "action:'preflight'",
  'MAIL BLOKERET – INGEN OPFØLGNING',
  'Blokeret – ingen opfølgning',
  'Denne mail må ikke sendes til den valgte modtager.',
  'Mailen er ikke sendt.'
]) must(ui.includes(marker),'offer PDF UI reliability marker missing: '+marker);

must(!ui.includes('Kontrollerer den originale PDF'),'offer PDF UI still promises an original PDF even when live Minuba rendering is the safe fallback');

for(const marker of [
  'crm_mail_send_jobs',
  'messageRfc822Id',
  'Message-ID:',
  'sent_pending_postprocess',
  'kickPostprocess',
  'recoverProviderState',
  'rfc822msgid:',
  'attachment_filename:pdfName',
  "contains('payload',{send_id:requestId})",
  'send_id:requestId',
  'resolveOfferPdf',
  'gmailPdfCandidate',
  'minubaPdfCandidate',
  'minubaOfferId',
  'pdfB64Valid',
  'pdf_source_message_id',
  'pdf_source_attachment_id',
  'pdf_source_filename',
  "action==='pdf_status'",
  'OFFER_PDF_NOT_FOUND',
  'PDFDocument',
  'StandardFonts',
  'renderOfferPdf',
  'minubaLiveRenderCandidate',
  'minuba_live_render',
  'File/Download?',
  "admin.from('crm_followup_suppressions')",
  "code:'FOLLOWUP_SUPPRESSED'",
  "'preflight'",
  "blocked:true",
  "message:'MAIL BLOKERET – INGEN OPFØLGNING'",
  "err?.message||err?.error_description||err?.details||err?.hint"
]) must(send.includes(marker),'offer PDF backend reliability marker missing: '+marker);

must(!send.includes('function findAttachmentPart('),'offer PDF resolver regressed to exact-filename-only matching');
must(!send.includes("'File/'+encodeURIComponent(fileId)"),'offer PDF resolver still uses the invalid Minuba File/<id> download path');
must(!send.includes("for(const path of ['File?id='"),'offer PDF resolver still treats Minuba File metadata endpoint as a download endpoint');
must(!send.includes("err instanceof Error?err.message:'Ukendt fejl'"),'offer mail backend can still erase structured database errors as Ukendt fejl');

must(!send.includes("admin.from('crm_mail_messages').insert"),'offer PDF send still writes mail history synchronously');
must(!send.includes("admin.from('crm_tasks').insert"),'offer PDF send still creates follow-up tasks synchronously');
must(!send.includes("admin.from('crm_usage_events').insert"),'offer PDF send still writes usage synchronously');

for(const marker of [
  'finalizeJob',
  'attachment_filename',
  'attachment_source',
  'source_message_id'
]) must(worker.includes(marker),'postprocess attachment marker missing: '+marker);

for(const marker of [
  'add column if not exists attachment_filename',
  'add column if not exists attachment_source',
  'add column if not exists source_message_id',
  'crm_mail_send_jobs_approval_idx'
]) must(migration.includes(marker),'offer PDF migration marker missing: '+marker);

for(const marker of [
  'add column if not exists minuba_offer_id',
  'add column if not exists pdf_source_message_id',
  'add column if not exists pdf_source_attachment_id',
  'add column if not exists pdf_source_filename',
  'add column if not exists pdf_source_kind',
  'add column if not exists pdf_verified_at'
]) must(identityMigration.includes(marker),'offer PDF identity migration marker missing: '+marker);

must(!/update\s+public\.crm_offers/i.test(identityMigration),'offer PDF identity migration must not backfill crm_offers because offer write guards can reject bulk updates');

console.log('PASS: offer PDF send uses stable identity, the documented Minuba File/Download endpoint, Gmail fallback, live Minuba PDF rendering, preflight status and idempotent post-processing');
