'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const s=fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8');
const source=s.slice(s.indexOf('function directCustomerRecipientPolicy('),s.indexOf('function minubaPdfScore('));
const policy=vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+';directCustomerRecipientPolicy',{
trim:(v,max=10000)=>String(v??'').trim().slice(0,max),
emailList:v=>(String(v??'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(x=>x.toLowerCase()),
minubaOfferId:o=>o.minuba_offer_id||''
});
const offer={id:'offer-3091',offer_ref:'3091',customer_name:'Bank example',minuba_offer_id:'minuba-id',minuba_raw:{client:{name:'Bank example'},contactAddress:{email:null}}};
let r=policy(offer,'person@bank.example',{email:null,domain:null},[]);assert.equal(r.code,'OFFER_RECIPIENT_CONFIRMATION_REQUIRED');assert(r.blocked);
r=policy(offer,'person@bank.example',{},[],true);assert(!r.blocked);assert.equal(r.recipient_scope,'manual_user_confirmed');
const other={...offer,minuba_raw:{...offer.minuba_raw,deliveryAddress:{email:'endcustomer@other.example'}}};
r=policy(other,'endcustomer@other.example',{},[],true);assert(r.blocked);assert.equal(r.code,'OFFER_RECIPIENT_NOT_DIRECT_CUSTOMER');
r=policy(offer,'person@bank.example',{},[{email:'person@bank.example',verified:true,source_type:'verified_company_contact',email_verification_method:'manual_user_confirmed'}]);assert(!r.blocked);
r=policy(offer,'random@other.example',{},[{email:'person@bank.example',verified:true,email_verification_method:'manual_user_confirmed'}]);assert(r.blocked);
const declaration=s.match(/const manualRecipientConfirmed=([^;]+);/)[1];
const confirmation=(offerId,to,body)=>vm.runInNewContext(declaration,{offerId,to,body,String});
assert(confirmation('a','person@bank.example',{recipient_confirmation:{confirmed:true,offer_id:'a',email:'person@bank.example'}}));
assert(!confirmation('b','person@bank.example',{recipient_confirmation:{confirmed:true,offer_id:'a',email:'person@bank.example'}}));
assert(!confirmation('a','other@bank.example',{recipient_confirmation:{confirmed:true,offer_id:'a',email:'person@bank.example'}}));
assert(!confirmation('a','person@bank.example',{}));
assert(s.indexOf("admin.from('crm_followup_suppressions')")>s.indexOf('directCustomerRecipientPolicy(offer,to'));
assert(s.includes('confirmed_by:user.id'));
const ui=fs.readFileSync('offer-mail-pdf-v1.js','utf8');
assert(ui.includes("window.confirm('Bekræft, at '"));
assert(ui.includes("manualRecipients.clear()"));
assert(ui.includes("recipientKey(o,to)!==recipientKey(offer(),byId('offerMailTo')?.value)"));
assert(ui.includes("recipient_confirmation:recipientConfirmation(o,to)"));
console.log('PASS: missing Minuba email can be explicitly confirmed; exact offer/email binding; known delivery recipients remain blocked; confirmation audited; suppression/PDF/idempotency gates retained');

