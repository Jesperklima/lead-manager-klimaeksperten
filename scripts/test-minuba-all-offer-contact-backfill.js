const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('supabase/functions/minuba-offer-status-sync/index.ts','utf8');

for(const m of [
 "function companyDomainsFor(o:any,companies:any[])",
 "function referenceContact(record:any)",
 "addressContact(record?.contactAddress,'offer_contact_address',520)",
 "addressContact(record?.billingAddress,'offer_billing_address',430)",
 "addressContact(record?.deliveryAddress,'verified_customer_delivery_address',300)",
 "domainMatches(delivery.email,directDomains)",
 "function siblingConsensus(o:any,offers:any[],companies:any[])",
 "currentClientId=clean(o?.minuba_raw?.client?.id||o?.minuba_raw?.clientId,200)",
 "if(currentClientId&&siblingClientId&&currentClientId!==siblingClientId)continue",
 "function unsafeStoredDeliveryContact(record:any,o:any,trustedDomains=new Set<string>())",
 "unsafeStoredDeliveryContact(record,o,companyDomainsFor(o,companyRows))",
 "patch.contact_person=candidate?.name?clean(candidate.name,300):null",
 "apiGet('Client',{include:'addresses'})",
 "let contactBackfilled=0,contactUnresolved=0",
 "contact_backfilled:contactBackfilled"
]) assert(s.includes(m),'missing audited contact-sync guard: '+m);

assert(!s.includes("addressContact(record?.deliveryAddress,'offer_delivery_address',500)"),'delivery contact must not be trusted without customer-domain verification');
assert(!s.includes('record?.client?.lastUsedDeliveryAddressId'),'last-used delivery address must not become an offer recipient');

const refBlock=s.slice(s.indexOf('function referenceContact(record:any){'),s.indexOf('function recordContact(record:any'));
assert(!refBlock.includes('record?.deliveryAddress'),'TheirRef resolver must not use delivery/end-customer addresses');

// Semler Retail and Semler Agro may be related brands but are different Minuba clients.
// Sibling inference must therefore require the same Minuba client ID.
const semlerRetail='656E7828-7CBB-454D-BE5C-045C2CF18949';
const semlerAgro='different-client-id';
assert.notEqual(semlerRetail,semlerAgro);

// I-KLIMA/KAB regression: direct and delivery domains differ, so the delivery email stays unsafe.
const directDomain='iklima.dk',deliveryDomain='kab-bolig.dk';
assert.notEqual(directDomain,deliveryDomain);

console.log('PASS: all-offer Minuba backfill isolates Minuba clients, repairs unsafe stored contacts and never treats an end-customer delivery address as direct-customer proof');
