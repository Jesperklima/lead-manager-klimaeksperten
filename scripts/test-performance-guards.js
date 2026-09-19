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
console.log('PASS: active runtime is event-driven; only intentional low-frequency timers remain');
