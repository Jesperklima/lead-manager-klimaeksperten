'use strict';
const fs=require('fs');

const active=[
  'lead-manager-theme-v2.js','executive-dashboard-v1.js','performance-v1.js','tenant-isolation-v1.js',
  'saas-platform-admin-v1.js','saas-compliance-admin-v1.js','legal-agreement-v1.js','saas-onboarding-v5.js',
  'access-bootstrap-v1.js','saas-onboarding-mail-account-sync-v1.js','saas-customer-controls-v1.js',
  'saas-admin-client-switcher-v1.js','saas-admin-users-v1.js','saas-impersonation-v1.js',
  'saas-lead-intake-v1.js','saas-offer-intake-v1.js','saas-offer-search-controls-v2.js',
  'saas-response-panel-v1.js','saas-feedback-v1.js','saas-regression-center-v1.js',
  'saas-irrelevant-learning-v1.js','saas-microsoft-v1.js','saas-mail-providers-v1.js',
  'saas-gmail-platform-ui-v1.js','saas-mail-sender-name-v1.js','saas-mail-signature-v1.js',
  'saas-minuba-v1.js','saas-credit-check-v1.js','saas-marketing-connections-v1.js',
  'offer-date-save-v1.js','date-picker-click-v1.js','offer-mail-pdf-v1.js',
  'offer-reconciliation-v1.js','mail-sales-signal-v1.js','saas-settings-hub-v1.js',
  'source-transparency-v1.js','approval-center-v2.js','offer-mail-v1.js','mail-templates-v1.js'
];

const intervalAllow={
  'executive-dashboard-v1.js':/setInterval\(syncServerClock,30\*60\*1000\)/,
  'saas-impersonation-v1.js':/setInterval\(\(\)=>\{if\(isExpired\(\)\)stop\(true\);else ensureBanner\(\)\},30000\)/
};

for(const file of active){
  if(!fs.existsSync(file))throw new Error('Missing active runtime: '+file);
  const s=fs.readFileSync(file,'utf8');
  const intervals=(s.match(/setInterval\s*\(/g)||[]).length;
  if(intervals){
    const allowed=intervalAllow[file];
    if(!allowed||intervals!==1||!allowed.test(s))throw new Error('Unexpected polling interval in '+file);
  }
  if(/\.observe\(document\.(?:documentElement|body)/.test(s))throw new Error('Document-wide MutationObserver in '+file);
  if(/new MutationObserver\([^\n]*\)\.observe\(document\./.test(s))throw new Error('Inline document-wide observer in '+file);
}
for(const [file,pattern] of Object.entries({
  'saas-gmail-platform-ui-v1.js':/setInterval\([^)]*render/,
  'saas-credit-check-v1.js':/setInterval\([^)]*watchLead/,
  'saas-irrelevant-learning-v1.js':/setInterval\([^)]*install/,
  'saas-lead-intake-v1.js':/setInterval\([^)]*installButton/,
  'saas-offer-intake-v1.js':/setInterval/,
  'mail-templates-v1.js':/setInterval\([^)]*watch/
})){
  const s=fs.readFileSync(file,'utf8');
  if(pattern.test(s))throw new Error('Aggressive legacy polling returned in '+file);
}

const read=file=>fs.readFileSync(file,'utf8');
const index=read('index.html');
const fail=m=>{throw new Error(m)};

if(/setInterval\s*\(/.test(index))fail('unexpected permanent interval in index.html');
if(!index.includes('window.__LM_FULL_CUSTOMER_V4=true'))fail('authoritative lead drawer runtime marker missing');
if(index.includes("setTimeout(()=>renderFull(name,true),800)"))fail('duplicate lead drawer fallback render returned');
if(!index.includes("state?.companies||[]"))fail('lead drawer no longer reuses loaded company state');

const customerControls=read('saas-customer-controls-v1.js');
if(!customerControls.includes('__LM_CUSTOMER_CONTEXT'))fail('shared customer context cache missing');
if(!customerControls.includes('bootPromise'))fail('shared customer context request dedupe missing');
if(/functions\/v1\/saas-onboarding/.test(read('saas-feedback-v1.js')))fail('feedback performs duplicate onboarding status request');
if(/functions\/v1\/saas-onboarding/.test(read('saas-regression-center-v1.js')))fail('regression center performs duplicate onboarding status request');
if(read('saas-onboarding-v5.js').includes('setTimeout(boot,1500)'))fail('onboarding legacy startup retries returned');
if(!read('saas-settings-hub-v1.js').includes('if(settingsActive())loadBilling(false)'))fail('billing is no longer lazy');
if(!read('saas-compliance-admin-v1.js').includes('lm:system-opened'))fail('compliance is no longer lazy to System view');
if(!read('saas-platform-admin-v1.js').includes('status hentes i System'))fail('platform system status is no longer lazy');
if(!read('saas-mail-providers-v1.js').includes('settingsActive()'))fail('mail provider settings startup is no longer lazy');
if(!read('saas-minuba-v1.js').includes('settingsActive()'))fail('Minuba settings startup is no longer lazy');
if(!read('saas-gmail-platform-ui-v1.js').includes('activeSettings()'))fail('Gmail status startup is no longer lazy');

console.log('PASS: active runtime is event-driven; only intentional low-frequency timers remain');
