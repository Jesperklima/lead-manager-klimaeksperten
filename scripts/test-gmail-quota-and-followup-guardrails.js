'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ui = fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const send = fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const sync = fs.readFileSync('supabase/functions/mail-offer-sync/index.ts','utf8');
const postprocess = fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');

function contains(haystack,needle,label){
  assert(haystack.includes(needle),label || `Missing: ${needle}`);
}
function excludes(haystack,needle,label){
  assert(!haystack.includes(needle),label || `Must not include: ${needle}`);
}

// No optimistic follow-up changes before provider confirmation or while DB postprocess is pending.
const sendStart=ui.indexOf('async function sendWithPdf()');
const sendEnd=ui.indexOf('const sendRequest=callProtectedEdge',sendStart);
assert(sendStart>=0&&sendEnd>sendStart);
excludes(ui.slice(sendStart,sendEnd),'applyFollowDateLocally(o,follow)','Do not change local follow-up before send');
excludes(ui,"if(normalizeFollowDate(local?.follow_up_date)===expected){o.follow_up_date=expected;return true}",'Do not trust local follow-up date');
const finishStart=ui.indexOf('async function finishPdfSend(');
const finishEnd=ui.indexOf('async function',finishStart+10);
excludes(ui.slice(finishStart,finishEnd),'applyFollowDateLocally(o,effectiveFollow)','Do not show success date before DB verification');
contains(ui,'await verifyOfferFollowUp(o,expectedDate)','Verification must reach DB');

// Failed send must not be represented as unknown; manual recovery must preserve original failure.
contains(send,"status:'failed',sent:false,send_id:requestId",'Failed status is explicit');
contains(send,"manual_recovery:true",'Manual resend recognized');
contains(send,"original_failed_send_job_id:existing.id,manual_resend_after_quota:true",'Manual resend tied to failed job');
contains(send,"error_code:quotaExceeded?'GMAIL_QUOTA_EXCEEDED':'GMAIL_SEND_ERROR'",'Persist specific Gmail quota reason');
contains(send,"code: quotaExceeded ? 'GMAIL_QUOTA_EXCEEDED' : 'GMAIL_SEND_ERROR'",'API reports specific Gmail quota reason');
contains(send,'follow_up_applied: false','No false follow-up success on rejected send');
contains(send,'status:\'sending\',attempt_count:1','Single approved send, no implicit retries');

// Partial provider sync must NOT advance last_sync_at; errors must leave checkpoint intact.
contains(sync,"const hasMore=eligible.length>40||!!pageToken",'Detect provider backlog');
contains(sync,"const pending=eligible.slice(0,40)",'Bound Gmail fetch');
contains(sync,"pending.slice(i,i+2).map",'Limit Gmail concurrency');
contains(sync,"if(!r.ok)throw new Error(`Gmail message fetch failed",'A failed fetch must not be silently skipped');
contains(sync,"providersWithBacklog.add(i.provider)",'Remember provider backlog');
contains(sync,"const patch=providersWithBacklog.has(p)?{last_error:",'Preserve integration cursor while backlogged');
contains(sync,"{last_sync_at:now,last_error:null,updated_at:now}",'Advance cursor only after completed sync');

// Unknown jobs are read-only reconciled, throttled and never automatically resent.
contains(postprocess,"last_status_check_at.lt.",'Repeated reconciliation is throttled');
contains(postprocess,".in('status',['prepared','sending','unknown'])",'Only safe statuses auto-reconciled');
excludes(postprocess,'gmailSendMime(','Reconciliation must not initiate new sends');

console.log('PASS: 18 static mail safety checks (provider quota, checkpoint, verified follow-up, idempotency and manual recovery)');
