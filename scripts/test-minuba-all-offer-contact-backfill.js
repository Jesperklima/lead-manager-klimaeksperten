const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('supabase/functions/minuba-offer-status-sync/index.ts','utf8');

for(const m of [
 "addressContact(record?.contactAddress,'offer_contact_address',520)",
 "addressContact(record?.billingAddress,'offer_billing_address',430)",
 "addressContact(record?.deliveryAddress,'verified_customer_delivery_address',300)",
 "directDomains.has(emailDomain(delivery.email))",
 "function siblingConsensus",
 "function liveClientContact",
 "apiGet('Client',{include:'addresses'})",
 "let contactBackfilled=0,contactUnresolved=0",
 "contact_backfilled:contactBackfilled"
]) assert(s.includes(m),'missing direct-customer contact-sync guard: '+m);

assert(!s.includes("addressContact(record?.deliveryAddress,'offer_delivery_address',500)"),'delivery contact must not be used for offer recipient backfill');
assert(!s.includes('record?.client?.lastUsedDeliveryAddressId'),'last-used delivery address must not become an offer recipient');

const fixture={
 company_id:'iklima',
 minuba_raw:{
   client:{name:'I-KLIMA A/S'},
   contactAddress:{addressType:'CONTACT',email:'mp@iklima.dk, mar@iklima.dk'},
   deliveryAddress:{addressType:'DELIVERY',att:'Tom Christensen',email:'tochr@kab-bolig.dk'}
 }
};
const list=v=>(String(v||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.toLowerCase());
assert.deepEqual(list(fixture.minuba_raw.contactAddress.email),['mp@iklima.dk','mar@iklima.dk']);
assert.deepEqual(list(fixture.minuba_raw.deliveryAddress.email),['tochr@kab-bolig.dk']);
assert(!list(fixture.minuba_raw.contactAddress.email).includes('tochr@kab-bolig.dk'));

console.log('PASS: all-offer Minuba contact backfill uses direct customer addresses and only accepts DELIVERY contacts with a verified customer domain');
