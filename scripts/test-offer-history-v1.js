
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('offer-history-v1.js','utf8');
const app = fs.readFileSync('api/app.js','utf8');
const sandbox = { window: {}, Intl, Date, Set };
vm.runInNewContext(source, sandbox, { filename: 'offer-history-v1.js' });
const { buildHistory, dateKey } = sandbox.window.LMOfferHistoryV1;
assert.ok(app.includes('/offer-history-v1.js?v=20261026-refresh-1'), 'versioned offer history asset must be loaded');
assert.ok(source.includes(".eq('client_id', clientId).eq('offer_id', o.id)"), 'history queries must enforce tenant and offer');
assert.ok(!source.includes("crm_mail_send_jobs"), 'private send job table is never queried in browser');
assert.equal(dateKey('2026-10-19T07:11:01Z'), '2026-10-19');

const customer = { sent_date: '2026-10-14', contact_details: 'msc@5rpeople.com · 87 46 90 00' };
const internalForward = {
  external_message_id: 'gmail-original-forward', direction: 'outbound',
  from_email: 'mail@klimaeksperten.dk',
  to_emails: ['ph@klimaeksperten.dk', 'js@klimaeksperten.dk'],
  message_at: '2026-10-14T15:07:51Z',
  subject: 'Fwd: Tilbud vedrørende: Tilbud på udskiftning af Fujitsu klimaanlæg'
};
const originalCustomerSend = {
  ...internalForward, external_message_id: 'gmail-original-to-customer',
  to_emails: ['msc@5rpeople.com'], subject: 'Tilbud 3059'
};
const followup = {
  external_message_id: 'gmail-followup', direction: 'outbound',
  from_email: 'js@klimaeksperten.dk',
  to_emails: ['msc@5rpeople.com'], message_at: '2026-10-19T07:11:01Z',
  subject: 'Tilbud 3059'
};
const duplicateActivity = {
  type: 'Udgående mail', created_at: '2026-10-19T07:11:01Z',
  actor_name: 'js@klimaeksperten.dk',
  metadata: { external_message_id: 'gmail-followup', to: 'msc@5rpeople.com', subject: 'Tilbud 3059' }
};
const observed3059 = buildHistory(customer, [], [internalForward, followup], [duplicateActivity]);
assert.equal(observed3059.first.at, '2026-10-14');
assert.equal(observed3059.first.verified, false, 'internal Minuba forward is NOT proof of customer delivery');
assert.equal(observed3059.followups.length, 1, '19 October is the only documented customer send after the recorded first date');
assert.equal(observed3059.followups[0].at, followup.message_at);
assert.equal(observed3059.mailEvents, 1, 'internal forward must not be counted as customer contact or as a duplicate');

const verified = buildHistory(customer, [], [originalCustomerSend, followup], [duplicateActivity]);
assert.equal(verified.first.verified, true, 'direct customer send can verify original date');
assert.equal(verified.first.at, originalCustomerSend.message_at);
assert.equal(verified.followups.length, 1, 'followup email and activity deduplicate by provider ID');

const wrongCustomer = {
  ...originalCustomerSend, external_message_id: 'different-recipient',
  to_emails: ['other@unrelated-company.dk']
};
assert.equal(buildHistory(customer, [], [wrongCustomer, followup], []).followups.length, 1,
  'messages to a different company cannot count as offer followups');

const incoming = { ...followup, external_message_id: 'incoming', direction: 'inbound' };
assert.equal(buildHistory(customer, [], [originalCustomerSend, followup, incoming], []).followups.length, 1,
  'incoming replies are not outbound followups');
const earlier = buildHistory({ ...customer, sent_date: '2026-10-10' }, [], [originalCustomerSend, followup], []);
assert.equal(earlier.first.verified, false, 'earlier CRM date must not be falsely confirmed');
assert.equal(earlier.followups.length, 2, 'later customer sends must remain visible');
const imported = buildHistory({ sent_date: null }, [{ sent_date: '2026-09-30' }], [], []);
assert.equal(imported.first.at, '2026-09-30', 'historical original send date preserved');
assert.equal(imported.followups.length, 0);
const unlogged = buildHistory({ sent_date: null }, [], [], [{ type: 'Planlægning', created_at: '2026-10-19T07:12:00Z' }]);
assert.equal(unlogged.first, null);
assert.equal(unlogged.followups.length, 0, 'scheduled date is NOT completed followup');
const draft = buildHistory({ sent_date: null }, [], [{ ...originalCustomerSend, direction: 'draft' }], []);
assert.equal(draft.first, null, 'draft is not evidence of sending');
assert.equal(draft.followups.length, 0);
const unlinked = buildHistory({ sent_date: '2026-10-14' }, [], [internalForward, followup], []);
assert.equal(unlinked.followups.length, 1, 'current outbound customer email still found when activity is missing');
assert.ok(fs.readFileSync('index.html','utf8').includes("window.dispatchEvent(new CustomEvent('lm:offer-opened'"), 'opening an offer must refresh history');
assert.ok(source.includes("window.addEventListener('lm:offer-mail-sent', scheduleLoad)"), 'confirmed mail send must refresh history');
assert.ok(source.includes("cachedForOffer('activities', o.id, clientId)"), 'per-offer history reads tenant-scoped cached evidence');
assert.ok(fs.readFileSync('offer-mail-v1.js','utf8').includes("window.dispatchEvent(new CustomEvent('lm:offer-mail-sent'"), 'composer notifies history of confirmed send');
console.log('PASS: evidence-only offer send history, customer recipient validation and no internal forwards');
