'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const ui=fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const worker=fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');
const check=fs.readFileSync('supabase/functions/_shared/reconcile-sent-offer-followups.ts','utf8');

// The composer may only close after send acknowledgement, not from a fixed 1.2s timeout.
const send=ui.slice(ui.indexOf('async function sendWithPdf()'),ui.indexOf('  function wire(){'));
assert(send.includes('Promise.race(['),'Existing responsive send flow remains');
const pending=send.slice(send.indexOf("if(result?.__background){"),send.indexOf("if(result?.error)throw",send.indexOf("if(result?.__background){")));
assert(!pending.includes("classList.remove('open')"),'No premature close while Gmail is pending');
assert(!pending.includes("lm:offer-mail-closed"),'No fake mail-closed lifecycle event while Gmail is pending');
assert(pending.includes('currentPdfSendId===requestId'),'Background status checks use same idempotency key');
const final=ui.slice(ui.indexOf('async function finishPdfSend('),ui.indexOf('async function resumePendingOfferSend('));
assert(final.includes("classList.remove('open')"),'Confirmed Gmail send still closes composer');
assert(final.includes('await waitForOfferFollowUp('),'Final send still checks database before success');
assert(!send.includes("Mailen afsendes i baggrunden · du kan arbejde videre"),'Do not describe an unconfirmed send as finished');

// Backstop verifies provider-accepted mail, never sends and does not overwrite later manual decisions.
for(const marker of [
 "status','sent'", "postprocessed_at", "provider_accepted!==true",
 "activeOfferStatuses", "metadata?.manual===true",
 "metadata?.method==='verified_offer_save'", ".eq('client_id',j.client_id)",
 ".eq('follow_up_date',actual)", ".eq('status',o.status)",
 "source:'verified_send_followup_reconciliation'", "seen.add(j.offer_id)",
 "m.metadata?.provider_accepted!==true"
])assert(check.includes(marker),'Missing integrity guard: '+marker);
assert(!check.includes('messages/send'),'Reconciler may never send customer mail');
assert(!check.includes('gmailSendMime('),'Reconciler may never call sender');
const saver=fs.readFileSync('offer-date-save-v1.js','utf8');
assert(saver.includes('const persistedBeforeSave=await readSavedDate(o.id,clientId)'),'Save must read current DB value first');
assert(saver.includes('!dateEditedByUser&&persistedBeforeSave!==requestedDate'),'Do not overwrite a newer mail date with an unchanged stale form');
assert(saver.includes("update.eq('follow_up_date',persistedBeforeSave)"),'Date save must compare-and-swap');
assert(worker.includes("reconcileSentOfferFollowups(admin,Math.min(limit,10))"),'Existing cron must run follow-up verification');
assert(worker.includes("reconcileResolvedFailedJobs(admin,Math.min(limit,10))"),'Previous status recovery unchanged');
console.log('PASS: pending composer stays visible, post-send date consistency preserves manual adjustments');
