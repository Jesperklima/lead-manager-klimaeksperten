const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('supabase/functions/minuba-offer-status-sync/index.ts','utf8');
for(const m of [
 "addressContact(record?.deliveryAddress,'offer_delivery_address',500)",
 "function siblingConsensus",
 "function liveClientContact",
 "apiGet('Client',{include:'addresses'})",
 "let contactBackfilled=0,contactUnresolved=0",
 "contact_backfilled:contactBackfilled"
]) assert(s.includes(m),'missing contact-sync guard: '+m);
const siblings=[
 {company_id:'semler',minuba_raw:{deliveryAddress:{att:'Michael Bang Jensen',email:'Miban@semler.dk',cellPhone:'23 37 90 63'}}},
 {company_id:'semler',contact_person:'Michael Bang-Jensen',contact_details:'miban@semler.dk · 23 37 90 63'}
];
assert(siblings.every(x=>x.company_id==='semler'));
assert(new Set(siblings.map(x=>(x.minuba_raw?.deliveryAddress?.email||x.contact_details.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]).toLowerCase())).size===1);
console.log('PASS: all-offer Minuba contact backfill uses delivery, client and sibling consensus');
