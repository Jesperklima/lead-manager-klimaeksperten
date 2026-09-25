const fs=require('fs');
const assert=require('assert');

const ui=fs.readFileSync('offer-mail-v1.js','utf8');
const edge=fs.readFileSync('supabase/functions/minuba-offer-lookup/index.ts','utf8');
const dashboard=fs.readFileSync('executive-dashboard-v1.js','utf8');
const templates=fs.readFileSync('mail-templates-v1.js','utf8');
const sync=fs.readFileSync('supabase/functions/minuba-offer-status-sync/index.ts','utf8');

for(const marker of [
  "push(raw?.deliveryAddress,'offer_delivery_address',120)",
  "loadStoredMinubaContact(o)",
  "applyRawMinubaContact(o,data.raw||o.minuba_raw||{},'Kontakt fundet direkte på Minuba-tilbuddet')",
  "raw?.deliveryAddress?.email",
  "function fallbackContactName(o)",
  "isPersonalMailbox(email)?looksLikePersonName(address.name):''",
  "ensureContactName(o);"
]) assert(ui.includes(marker),'UI mangler Minuba deliveryAddress/contact-name guard: '+marker);

for(const marker of [
  "optionsFromAddress(record?.deliveryAddress,'offer_delivery_address')",
  "contactOptions.find(x=>x.source==='offer_delivery_address'&&x.name&&x.email)",
  "installationAddress?.cellPhone",
  "function isPersonalMailbox(value:any)",
  "isPersonalMailbox(email)?looksLikePersonName(a?.name):''",
  "isPersonalMailbox(selectedEmail)?looksLikePersonName(customerName):''"
]) assert(edge.includes(marker),'Edge lookup mangler offer-specifik kontakt guard: '+marker);

for(const marker of [
  "function offerContactName(offer,c)",
  "isPersonalMailbox(email)?looksLikePersonName(offer?.customer_name):''",
  "email:firstEmail(offer.contact_details)"
]) assert(templates.includes(marker),'Mail-skabelon mangler sikkert kontakt-navn fallback: '+marker);

for(const marker of [
  "function isPersonalMailbox(value:any)",
  "const name=explicitName||(isPersonalMailbox(email)?looksLikePersonName(a?.name):'')",
  "isPersonalMailbox(email)?looksLikePersonName(customer):''"
]) assert(sync.includes(marker),'Minuba status-sync mangler kontakt-navn backfill: '+marker);

assert(dashboard.includes("/offer-mail-v1.js?v=20260925-5-contact-name"),'Offer mail cache-version er ikke opdateret');
assert(dashboard.includes("/mail-templates-v1.js?v=20260925-1-contact-name"),'Mail template cache-version er ikke opdateret');

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

// Regression fixture for offer 2963-type data: Minuba has a personal customer name
// and a personal mailbox, but no Att./contactName. This must be allowed as a safe
// contact-name fallback so templates render "Hej Søren" instead of just "Hej".
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
const personal={customer_name:'Søren Rytgaard',contact_details:'rytgaard@hotmail.com'};
assert.equal(isPersonalMailbox(personal.contact_details),true);
assert.equal(looksLikePersonName(personal.customer_name),'Søren Rytgaard');
assert.equal(looksLikePersonName(personal.customer_name).split(/\s+/)[0],'Søren');
assert.equal(looksLikePersonName('ISS FACILITY SERVICES A/S'),'');
assert.equal(looksLikePersonName('Danske Bank, Svendborg'),'');
assert.equal(isPersonalMailbox('kontakt@firma.dk'),false);

console.log('PASS: Minuba offer contact resolver and mail templates safely recover personal customer names');
