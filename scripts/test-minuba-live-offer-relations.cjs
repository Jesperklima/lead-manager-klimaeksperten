const fs = require('node:fs');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/gmail-offer-send/index.ts', 'utf8');
const candidateSource = source.slice(source.indexOf('async function minubaLiveRenderCandidate('), source.indexOf('async function gmailReadJson('));
const tenant = '9b6b08bd-e9ce-40c3-8ffa-aa18e859d3af';
let requests = [], rendered = 0, wrongIdentity = false, missingRelations = false;
const context = {
  URLSearchParams,
  console,
  trim: value => String(value || '').trim(),
  refNorm: value => String(value || '').toLowerCase(),
  minubaOfferId: offer => offer.minuba_offer_id,
  minubaAccessToken: async () => ({ token: 'test-token' }),
  bytesToB64: () => 'validated-pdf',
  pdfB64Valid: value => value === 'validated-pdf',
  fetch: async url => {
    requests.push(url);
    const query = new URL(url).searchParams;
    assert.equal(query.get('id'), 'order-id');
    const expanded = query.get('include') === 'client,addresses' && !missingRelations;
    return new Response(JSON.stringify({
      id: wrongIdentity ? 'another-order' : 'order-id', orderNumber: '3058',
      proposal: true, proposalText: '<p>Offer</p>',
      ...(expanded ? { client: { clientNumber: '709' }, contactAddress: { streetAddress: 'Testvej 1' } } : {})
    }));
  },
  renderOfferPdf: async raw => {
    assert(raw.client?.clientNumber && raw.contactAddress?.streetAddress, 'Kundeoplysninger mangler i Minuba');
    rendered++;
    return new Uint8Array([37, 80, 68, 70]);
  }
};
const candidate = new Function(...Object.keys(context), stripTypeScriptTypes(candidateSource, { mode: 'transform' }) + ';return minubaLiveRenderCandidate;')(...Object.values(context));
(async () => {
  const offer = { minuba_offer_id: 'order-id' };
  const result = await candidate({}, tenant, offer, '3058');
  assert.equal(result?.source, 'minuba_live_render');
  assert.equal(rendered, 1);
  assert.equal(requests.length, 1);
  wrongIdentity = true;
  assert.equal(await candidate({}, tenant, offer, '3058'), null);
  assert.equal(rendered, 1);
  wrongIdentity = false;
  missingRelations = true;
  assert.equal(await candidate({}, tenant, offer, '3058'), null);
  assert.equal(rendered, 1);
  requests = [];
  assert.equal(await candidate({}, 'another-tenant', offer, '3058'), null);
  assert.equal(requests.length, 0);
  console.log('PASS: live order expands customer/address relations; wrong identity, incomplete records and other tenants remain blocked; no mail sent');
})().catch(error => { console.error(error); process.exitCode = 1; });

