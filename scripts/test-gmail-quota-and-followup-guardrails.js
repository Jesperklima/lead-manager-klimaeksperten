'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ui = fs.readFileSync('offer-mail-pdf-v1.js','utf8');
const send = fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const sync = fs.readFileSync('supabase/functions/mail-offer-sync/index.ts','utf8');

// A send attempt must not advance the local offer/task before provider acknowledgement.
const sendStart = ui.indexOf('async function sendWithPdf()');
const sendEnd = ui.indexOf('const sendRequest=callProtectedEdge',sendStart);
assert(sendStart >= 0 && sendEnd > sendStart);
assert(!ui.slice(sendStart,sendEnd).includes('applyFollowDateLocally(o,follow)'));
assert(ui.includes('Næste opfølgning ændres først, når Gmail har bekræftet afsendelsen'));
assert(!ui.includes("if(normalizeFollowDate(local?.follow_up_date)===expected){o.follow_up_date=expected;return true}"));

// Failed quota sends remain failed; never advance server follow-up or auto-resubmit.
assert(send.includes("quotaExceeded ? 'GMAIL_QUOTA_EXCEEDED' : 'GMAIL_SEND_ERROR'"));
assert(send.includes('follow_up_applied: false'));
assert(send.includes('quotaExceeded ? 429 : 502'));
assert(send.includes("status:'failed',error_code:'GMAIL_SEND_ERROR'"));
assert(!send.includes('retryFailedOfferJob(admin,job,supabaseUrl,serviceKey){\n  await gmailSendMime'));

// Gmail full-message fetch is limited per sync run; missed messages remain eligible.
assert(sync.includes("ids.filter((id:string)=>!known.has(id)||legacyReinspect.has(id)).slice(0,40)"));
assert(sync.includes('for(let i=0;i<pending.length;i+=2)'));
assert(sync.includes('pending.slice(i,i+2).map'));

console.log('PASS: Gmail quota guardrails, no optimistic follow-up and bounded sync');