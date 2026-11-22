// Static regression guards for the November 2026 audit fixes.
// Run: node scripts/test-audit-followup-security-20261121.js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8');
const sync = read('supabase/functions/mail-offer-sync/index.ts');
const sender = read('supabase/functions/gmail-offer-send/index.ts');
const webhook = read('supabase/functions/marketing-webhook/index.ts');
const lookup = read('supabase/functions/minuba-offer-lookup/index.ts');
const composer = read('offer-mail-v1.js');
const pdf = read('offer-mail-pdf-v1.js');
assert.match(sync, /client_id:approval\.client_id/, 'approval payload must be pinned to tenant');
assert.match(sync, /APPROVAL_TENANT_MISMATCH/, 'approval foreign references must fail closed');
assert.doesNotMatch(sync, /if\(hardWon\|\|\(softWon&&!negotiation\)\)/, 'conditional acceptance must not auto-win');
assert.match(sender, /code:'OFFER_CLOSED'/, 'server must block closed offers');
assert.match(webhook, /\^\[A-Za-z0-9-\]\{8,128\}\$/, 'challenge input must be restricted');
assert.match(lookup, /code:'MINUBA_UNAVAILABLE'/, 'Minuba HTTP error must not appear as not found');
assert.match(composer, /Minuba-forbindelsen skal genetableres/, 'Minuba OAuth failures must block follow-up');
assert.doesNotMatch(pdf, /status===546\|\|code==='SEND_IN_PROGRESS'\|\|\(status>=500&&status<600\)/, '5xx errors must be shown');
console.log('PASS: static audit guards');
