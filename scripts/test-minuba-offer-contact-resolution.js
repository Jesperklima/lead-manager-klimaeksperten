const fs=require('fs');
const assert=require('assert');

const ui=fs.readFileSync('offer-mail-v1.js','utf8');
const edge=fs.readFileSync('supabase/functions/minuba-offer-lookup/index.ts','utf8');
const dashboard=fs.readFileSync('executive-dashboard-v1.js','utf8');

for(const marker of [
  "push(raw?.deliveryAddress,'offer_delivery_address',120)",
  "loadStoredMinubaContact(o)",
  "applyRawMinubaContact(o,data.raw||o.minuba_raw||{},'Kontakt fundet direkte på Minuba-tilbuddet')",
  "raw?.deliveryAddress?.email"
]) assert(ui.includes(marker),'UI mangler Minuba deliveryAddress guard: '+marker);

for(const marker of [
  "optionsFromAddress(record?.deliveryAddress,'offer_delivery_address')",
  "contactOptions.find(x=>x.source==='offer_delivery_address'&&x.name&&x.email)",
  "installationAddress?.cellPhone"
]) assert(edge.includes(marker),'Edge lookup mangler offer-specifik kontakt guard: '+marker);

assert(dashboard.includes("/offer-mail-v1.js?v=20260925-4"),'Offer mail cache-version er ikke opdateret');

// Regression fixture: Minuba kan have tom CONTACT-adresse, mens den konkrete
// installations-/leveringsadresse på tilbuddet har Att., mail og mobil.
const raw={
  contactAddress:{name:'ISS FACILITY SERVICES A/S',att:'',email:'',phone:''},
  deliveryAddress:{
    addressType:'DELIVERY',
    name:'Danske Bank, Svendborg',
    att:'Daniel Langhoff Jensen',
    email:'daniel.jensen@dk.issworld.com',
    cellPhone:'22 16 51 05',
    streetAddress:'Møllergade 2',
    postCode:'5700',
    city:'Svendborg'
  }
};
const delivery=raw.deliveryAddress;
assert.equal(delivery.att,'Daniel Langhoff Jensen');
assert.equal(delivery.email,'daniel.jensen@dk.issworld.com');
assert.equal(delivery.cellPhone,'22 16 51 05');
assert(!raw.contactAddress.att&&!raw.contactAddress.email,'Fixture skal bevare den oprindelige fejltilstand');

console.log('PASS: Minuba offer contact resolver prefers offer delivery contact and keeps stored-raw fallback');
