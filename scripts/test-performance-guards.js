const fs=require('node:fs');

const read=file=>fs.readFileSync(file,'utf8');
const fail=(msg)=>{throw new Error(msg)};

const noIntervals=[
  'saas-gmail-platform-ui-v1.js',
  'saas-onboarding-mail-account-sync-v1.js',
  'saas-irrelevant-learning-v1.js',
  'saas-credit-check-v1.js',
  'saas-compliance-admin-v1.js',
  'saas-lead-intake-v1.js',
  'saas-offer-intake-v1.js',
  'saas-offer-search-controls-v2.js',
  'saas-marketing-connections-v1.js',
  'offer-mail-pdf-v1.js',
  'date-picker-click-v1.js',
  'mail-templates-v1.js'
];
for(const file of noIntervals){
  if(/setInterval\s*\(/.test(read(file)))fail(file+': persistent polling returned');
}

const noGlobalObservers=[
  'saas-gmail-platform-ui-v1.js',
  'saas-onboarding-mail-account-sync-v1.js',
  'saas-irrelevant-learning-v1.js',
  'saas-credit-check-v1.js',
  'saas-compliance-admin-v1.js',
  'saas-offer-search-controls-v2.js',
  'offer-mail-v1.js',
  'offer-mail-pdf-v1.js',
  'offer-date-save-v1.js',
  'date-picker-click-v1.js',
  'mail-templates-v1.js',
  'saas-impersonation-v1.js'
];
for(const file of noGlobalObservers){
  const s=read(file);
  if(/observe\(document\.(?:documentElement|body)/.test(s))fail(file+': whole-document MutationObserver returned');
}

const index=read('index.html');
if(index.includes("setTimeout(()=>renderFull(name,true),800)"))fail('lead drawer duplicate forced refresh returned');
if(index.includes("if(busy&&!force||!name)return"))fail('lead drawer allows forced concurrent refreshes');
if(!index.includes("if(busy||!name)return"))fail('lead drawer in-flight dedupe guard missing');
if(!index.includes("state?.companies||[]"))fail('lead drawer no longer reuses in-memory company data');

const customerControls=read('saas-customer-controls-v1.js');
if(!customerControls.includes('__LM_CUSTOMER_CONTEXT'))fail('shared customer context cache missing');
if(!customerControls.includes('bootPromise'))fail('customer context request dedupe missing');
if(/functions\/v1\/saas-onboarding/.test(read('saas-feedback-v1.js')))fail('feedback performs duplicate onboarding status request');
if(/functions\/v1\/saas-onboarding/.test(read('saas-regression-center-v1.js')))fail('regression center performs duplicate onboarding status request');
if(!read('saas-settings-hub-v1.js').includes('if(settingsActive())loadBilling(false)'))fail('billing is no longer lazy');
if(!read('saas-compliance-admin-v1.js').includes('lm:system-opened'))fail('compliance is no longer lazy to System view');
if(!read('saas-gmail-platform-ui-v1.js').includes('setTimeout(()=>refresh(true),500)'))fail('Gmail status startup lazy guard missing');

const app=read('api/app.js');
for(const file of [
  'saas-gmail-platform-ui-v1.js','saas-credit-check-v1.js','saas-mail-providers-v1.js',
  'saas-minuba-v1.js','saas-microsoft-v1.js','saas-marketing-connections-v1.js',
  'offer-date-save-v1.js','date-picker-click-v1.js','offer-mail-pdf-v1.js','saas-platform-admin-v1.js',
  'legal-agreement-v1.js','saas-customer-controls-v1.js','saas-feedback-v1.js','saas-regression-center-v1.js','saas-settings-hub-v1.js'
]){
  if(!app.includes('/'+file+'?v=20260919-opt2'))fail(file+': optimized cache version missing from app shell');
}

console.log('PASS: event-driven UI guards and lead-drawer request dedupe');
