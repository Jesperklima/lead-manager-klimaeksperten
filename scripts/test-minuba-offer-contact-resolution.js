const fs=require('fs');
const assert=require('assert');

const ui=fs.readFileSync('offer-mail-v1.js','utf8');
const edge=fs.readFileSync('supabase/functions/minuba-offer-lookup/index.ts','utf8');
const dashboard=fs.readFileSync('executive-dashboard-v1.js','utf8');
const templates=fs.readFileSync('mail-templates-v1.js','utf8');
const sync=fs.readFileSync('supabase/functions/minuba-offer-status-sync/index.ts','utf8');

for(const marker of [
  "push(raw?.contactAddress,'offer_contact_address',180)",
  "push(raw?.billingAddress,'offer_billing_address',160)",
  "function unsafeDeliveryEmails(raw)",
  "safe_for_offer:true",
  "recipient_scope:'direct_customer'",
  "Leverings-/arbejdsstedets kontakt må ikke bruges til tilbud eller priser.",
  "TILBUD BLOKERET – FORKERT MODTAGER"
]) assert(ui.includes(marker),'UI mangler direkte-kunde guard: '+marker);
assert(!ui.includes("push(raw?.deliveryAddress,'offer_delivery_address',120)"),'UI må ikke prioritere leveringsadressen som tilbudsmodtager');

for(const marker of [
  "optionsFromAddress(record?.contactAddress,'offer_contact_address',true)",
  "optionsFromAddress(record?.deliveryAddress,'offer_delivery_address',false)",
  "safe_for_offer:safeForOffer",
  "recipient_scope:safeForOffer?'direct_customer':'delivery_or_end_customer'",
  "delivery_contact_emails:deliveryEmails",
  "direct_customer_emails:contactEmails"
]) assert(edge.includes(marker),'Minuba lookup mangler direkte-kunde guard: '+marker);
assert(!edge.includes("contactOptions.find(x=>x.source==='offer_delivery_address'&&x.name&&x.email)"),'Minuba lookup må ikke vælge DELIVERY som primær tilbudsmodtager');

for(const marker of [
  "function offerContactName(offer,c)",
  "isPersonalMailbox(email)?looksLikePersonName(offer?.customer_name):''",
  "email:firstEmail(offer.contact_details)"
]) assert(templates.includes(marker),'Mail-skabelon mangler sikkert kontakt-navn fallback: '+marker);

for(const marker of [
  "addressContact(record?.contactAddress,'offer_contact_address',520)",
  "addressContact(record?.billingAddress,'offer_billing_address',430)",
  "['CONTACT','BILLING'].includes(String(a?.addressType||'').toUpperCase())",
  "record?.client?.lastUsedContactAddressId",
  "record?.client?.lastUsedBillingAddressId"
]) assert(sync.includes(marker),'Minuba status-sync mangler direkte-kunde guard: '+marker);
assert(!sync.includes("addressContact(record?.deliveryAddress,'offer_delivery_address',500)"),'Status-sync må ikke backfille DELIVERY som tilbudskontakt');
assert(!sync.includes('record?.client?.lastUsedDeliveryAddressId'),'Status-sync må ikke bruge seneste DELIVERY-adresse til tilbudskontakt');

assert(dashboard.includes("/offer-mail-v1.js?v=20260928-6-direct-customer"),'Offer mail cache-version er ikke opdateret');
assert(dashboard.includes("/mail-templates-v1.js?v=20260925-1-contact-name"),'Mail template cache-version er ikke opdateret');

// Regression fixture for offer 2726: I-KLIMA is our direct customer, while Tom/KAB
// belongs to the delivery/work site. Only the I-KLIMA CONTACT emails are eligible.
const raw={
  client:{name:'I-KLIMA A/S',cvr:'27679366'},
  contactAddress:{
    addressType:'CONTACT',
    name:'I-KLIMA A/S',
    email:'mp@iklima.dk, mar@iklima.dk, js@iklima.dk, JAH@iklima.dk'
  },
  deliveryAddress:{
    addressType:'DELIVERY',
    name:'Avedøre Stationsby Syd',
    att:'Tom Christensen',
    email:'tochr@kab-bolig.dk',
    streetAddress:'Trædrejerporten 4',
    postCode:'2650',
    city:'Hvidovre'
  }
};
const emails=v=>[...new Set((String(v||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.toLowerCase()))];
const direct=emails(raw.contactAddress.email);
const delivery=emails(raw.deliveryAddress.email);
assert.deepEqual(direct.sort(),['jah@iklima.dk','js@iklima.dk','mar@iklima.dk','mp@iklima.dk']);
assert.deepEqual(delivery,['tochr@kab-bolig.dk']);
assert(!direct.includes('tochr@kab-bolig.dk'),'Kundens kunde må aldrig være sikker tilbudsmodtager');

// Personal direct customers must still work when their CONTACT/customer email is personal.
const personalMailDomains=new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.dk','outlook.com','outlook.dk','live.com','live.dk','msn.com','icloud.com','me.com','mac.com','yahoo.com','yahoo.dk','proton.me','protonmail.com','mail.dk','ofir.dk','gmx.com','gmx.de']);
const firstEmail=v=>(String(v||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
const looksLikePersonName=value=>{
  const name=String(value||'').trim().replace(/\s+/g,' ');
  if(!name||name.length>100||/[@\d]/.test(name)||/[,&/+]/.test(name)||name===name.toUpperCase())return '';
  if(/\b(?:aps|a\/s|i\/s|ivs|p\/s|amba|holding|kommune|region|service|services|vvs|køl|klima|byg|entreprise|ejendom|ejendomme|hotel|restaurant|skole|center|fonden|forening|group|consult|consulting|solution|solutions|system|systems|bank|forsikring|transport|teknik|auto)\b/i.test(name))return '';
  const parts=name.split(/\s+/).filter(Boolean);
  if(parts.length<2||parts.length>5)return '';
  if(parts.some(part=>!/^[A-Za-zÆØÅæøåÀ-ÖØ-öø-ÿ'’.-]+$/u.test(part)))return '';
  return name;
};
const isPersonalMailbox=value=>{const email=firstEmail(value).toLowerCase(),at=email.lastIndexOf('@');return at>0&&personalMailDomains.has(email.slice(at+1))};
assert.equal(isPersonalMailbox('rytgaard@hotmail.com'),true);
assert.equal(looksLikePersonName('Søren Rytgaard'),'Søren Rytgaard');
assert.equal(looksLikePersonName('I-KLIMA A/S'),'');

console.log('PASS: offer recipients are restricted to the direct Minuba customer; delivery/end-customer contacts are excluded');
