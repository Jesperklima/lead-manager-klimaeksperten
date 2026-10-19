
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('offer-history-v1.js','utf8');
const app = fs.readFileSync('api/app.js','utf8');
const sandbox = { window: {}, Intl, Date, Set };
vm.runInNewContext(source, sandbox, { filename: 'offer-history-v1.js' });
const { buildHistory, dateKey } = sandbox.window.LMOfferHistoryV1;
assert.ok(app.includes('/offer-history-v1.js?v=20261019-1'), 'offer history asset must be loaded in actual app');
assert.ok(source.includes(".eq('client_id', clientId).eq('offer_id', o.id)"), 'all history queries must enforce workspace and offer');
assert.ok(!source.includes("crm_mail_send_jobs"), 'private send job table must not be exposed directly');
assert.equal(dateKey('2026-10-19T07:11:01Z'), '2026-10-19');

const original = {
  id: 'first', external_message_id: 'gmail-original', direction: 'outbound',
  message_at: '2026-10-14T15:07:51Z', subject: 'Fwd: Tilbud 3059'
};
const reply = {
  id: 'second', external_message_id: 'gmail-follow-up', direction: 'outbound',
  message_at: '2026-10-19T07:11:01Z', subject: 'Tilbud 3059'
};
const duplicateActivity = {
  id: 'activity-1', type: 'Udgående mail', created_at: '2026-10-19T07:11:01Z',
  metadata: { external_message_id: 'gmail-follow-up', subject: 'Tilbud 3059' }
};
const sent = buildHistory({ sent_date: '2026-10-14' }, [], [original, reply], [duplicateActivity]);
assert.equal(sent.first.verified, true, 'original should be provider-evidenced');
assert.equal(sent.first.at, original.message_at);
assert.equal(sent.followups.length, 1, 'CRM mail event and its activity should count once');
assert.equal(sent.followups[0].id, reply.external_message_id);

const incoming = {
  id: 'third', external_message_id: 'reply-from-customer', direction: 'inbound',
  message_at: '2026-10-20T12:00:00Z', subject: 'Re: Tilbud 3059'
};
assert.equal(buildHistory({ sent_date: '2026-10-14' }, [], [original, reply, incoming], []).followups.length, 1,
  'incoming replies must never count as sent followups');
const earlier = buildHistory({ sent_date: '2026-10-10' }, [], [original, reply], []);
assert.equal(earlier.first.verified, false, 'a CRM registered date earlier than email must not be misrepresented as provider-confirmed');
assert.equal(earlier.followups.length, 2, 'later documented mails remain visible after historical registered first send');
const archived = buildHistory({ sent_date: null }, [{ sent_date: '2026-09-30' }], [], []);
assert.equal(archived.first.at, '2026-09-30', 'imported historic date must be preserved');
assert.equal(archived.followups.length, 0);
const noProof = buildHistory({ sent_date: null }, [], [], [{ type: 'Planlægning', created_at: '2026-10-19T07:12:00Z' }]);
assert.equal(noProof.first, null, 'planned task is not evidence of an original send');
assert.equal(noProof.followups.length, 0, 'planned followup must not count as completed');
const failed = buildHistory({ sent_date: null }, [], [{ ...original, direction: 'draft' }], []);
assert.equal(failed.followups.length, 0);
assert.equal(failed.first, null, 'unconfirmed draft must not be counted');
console.log('PASS: first send, all evidenced followups, deduplication, tenant scoping and unknown-history guards');
