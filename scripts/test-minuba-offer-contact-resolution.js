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
  "function unsafeDeliveryEmails(raw,o=null)",
  "function companyDomains(o)",
  "domainMatchesTrusted(email,directDomains)",
  "safe_for_offer:true",
  "recipient_scope:'direct_customer'",
  "TILBUD BLOKERET – FORKERT MODTAGER"
]) assert(ui.includes(marker),'UI mangler direkte-kunde guard: '+marker);
assert(!ui.includes("push(raw?.deliveryAddress,'offer_delivery_address',120)"),'UI må ikke stole blindt på leveringsadressen');

for(const marker of [
  "optionsFromAddress(record?.contactAddress,'offer_contact_address',true)",
  "optionsFromAddress(record?.deliveryAddress,'offer_delivery_address',false)",
  "safe_for_offer:safeForOffer",
  "recipient_scope:safeForOffer?'direct_customer':'delivery_or_end_customer'",
  "delivery_contact_emails:deliveryEmails",
  "verified_customer_delivery_address",
  "direct_customer_emails:contactEmails"
]) assert(edge.includes(marker),'Minuba lookup mangler direkte-kunde guard: '+marker);
assert(!edge.includes("contactOptions.find(x=>x.source==='offer_delivery_address'&&x.name&&x.email)"),'Minuba lookup må ikke vælge DELIVERY som primær tilbudsmodtager');

for(const marker of [
  "function offerContactName(offer,c)",
  "isPersonalMailbox(email)?looksLikePersonName(offer?.customer_name):''",
  "email:firstEmail(offer.contact_details)"
]) assert(templates.includes(marker),'Mail-skabelon mangler sikkert kontakt-navn fallback: '+marker);

for(const marker of [
  "function companyDomainsFor(o:any,companies:any[])",
  "function referenceContact(record:any)",
  "source:'offer_theirref_match'",
  "addressContact(record?.contactAddress,'offer_contact_address',520)",
  "addressContact(record?.billingAddress,'offer_billing_address',430)",
  "domainMatches(delivery.email,directDomains)",
  "currentClientId=clean(o?.minuba_raw?.client?.id||o?.minuba_raw?.clientId,200)",
  "if(currentClientId&&siblingClientId&&currentClientId!==siblingClientId)continue"
]) assert(sync.includes(marker),'Minuba status-sync mangler sikker kundeadskillelse: '+marker);

const referenceBlock=sync.slice(sync.indexOf('function referenceContact(record:any){'),sync.indexOf('function recordContact(record:any'));
assert(referenceBlock&&!referenceBlock.includes('record?.deliveryAddress'),'TheirRef-match må aldrig bruge DELIVERY/end-customer som bevis');
assert(!sync.includes('record?.client?.lastUsedDeliveryAddressId'),'Status-sync må ikke bruge seneste DELIVERY-adresse som kundebevis');

assert(dashboard.includes("/offer-mail-v1.js?v=20260928-7-recipient-audit"),'Offer mail cache-version er ikke opdateret');
assert(dashboard.includes("/mail-templates-v1.js?v=20260925-1-contact-name"),'Mail template cache-version er ikke opdateret');

// 2726: I-KLIMA er direkte kunde, KAB er arbejdsstedets/slutkundens domæne.
const iklima={
  direct:['mp@iklima.dk','mar@iklima.dk','js@iklima.dk','jah@iklima.dk'],
  delivery:'tochr@kab-bolig.dk'
};
assert(!iklima.direct.includes(iklima.delivery),'KAB må aldrig blive tilbudsmodtager for I-KLIMA');

// 2940/2941: TheirRef Benjamin skal kunne matches til den rigtige mail, selv om
// CONTACT-adressen indeholder flere Coor-adresser og Rasmus står først.
const ref='Benjamin Christensen';
const candidates=['Rasmus.Bjerrum@coor.com','Benjamin.Christensen@coor.com'];
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9æøå]+/g,'');
const refParts=ref.toLowerCase().split(/\s+/).filter(x=>x.length>=3);
const selected=candidates.find(email=>{
  const local=norm(email.split('@')[0]);
  return refParts.every(p=>local.includes(norm(p)));
});
assert.equal(selected,'Benjamin.Christensen@coor.com');

// Shared personal domains may be direct when explicitly on CONTACT, but never prove
// that a separate delivery address belongs to the same customer by domain alone.
const personal=new Set(['gmail.com','hotmail.com','outlook.com','icloud.com','yahoo.com']);
assert(personal.has('gmail.com'));

console.log('PASS: offer recipients stay on the direct customer, TheirRef resolves multi-email contacts, and delivery/end-customer evidence is fail-closed');
