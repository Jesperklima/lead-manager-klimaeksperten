const fs=require('fs');

const read=file=>fs.readFileSync(file,'utf8');
const fail=msg=>{throw new Error(msg)};

const noIntervals=[
  'saas-gmail-platform-ui-v1.js',
  'saas-onboarding-mail-account-sync-v1.js',
  'saas-credit-check-v1.js',
  'saas-irrelevant-learning-v1.js',
  'saas-lead-intake-v1.js',
  'saas-offer-intake-v1.js',
  'date-picker-click-v1.js',
  'mail-templates-v1.js',
  'saas-marketing-connections-v1.js',
  'saas-minuba-v1.js',
  'saas-mail-providers-v1.js',
  'saas-mail-signature-v1.js',
  'saas-mail-sender-name-v1.js'
];
for(const file of noIntervals){
  const s=read(file);
  if(/\bsetInterval\s*\(/.test(s))fail(file+': permanent polling returned');
}

const noGlobalObservers=[
  'saas-credit-check-v1.js',
  'saas-irrelevant-learning-v1.js',
  'saas-offer-search-controls-v2.js',
  'date-picker-click-v1.js',
  'lead-manager-theme-v2.js',
  'saas-compliance-admin-v1.js'
];
for(const file of noGlobalObservers){
  const s=read(file);
  if(/observe\(document\.documentElement/.test(s))fail(file+': global document observer returned');
}

const index=read('index.html');
const app=read('api/app.js');
const access=read('access-bootstrap-v1.js');

if(!index.includes("const BASE_STARTUP_KEYS=['companies','leads','activities','offers','approvals','tasks','mail']"))fail('startup CRM key set changed or expanded');
if(!index.includes("loadAll({startup:true})"))fail('lightweight index startup load missing');
if(!access.includes("loadAll({startup:true})"))fail('lightweight central bootstrap load missing');
if(index.includes('function loadContact()'))fail('duplicate legacy lead contact loader returned');
if(!index.includes('lm:lead-opened'))fail('lead lifecycle event missing');
if(!access.includes('lm:workspace-ready'))fail('workspace-ready event missing');
if(app.includes('saas-microsoft-v1.js'))fail('obsolete standalone Microsoft UI returned');

const indexObserverCount=(index.match(/new\s+MutationObserver/g)||[]).length;
if(indexObserverCount!==0)fail('index MutationObserver count regressed: '+indexObserverCount);
if(!index.includes("function openMailModal()")||!index.includes("function closeMailModal()"))fail('mail modal lifecycle helpers missing');
const impersonation=read('saas-impersonation-v1.js');
const adminUsers=read('saas-admin-users-v1.js');
if(/\bsetInterval\s*\(/.test(impersonation))fail('impersonation polling returned');
if(/new\s+MutationObserver/.test(impersonation))fail('impersonation MutationObserver returned');
if(!impersonation.includes('lm:admin-users-rendered'))fail('impersonation admin-users event wiring missing');
if(!adminUsers.includes('lm:admin-users-rendered'))fail('admin-users rendered lifecycle event missing');
const offerMail=read('offer-mail-v1.js');
const mailTemplates=read('mail-templates-v1.js');
const offerPdf=read('offer-mail-pdf-v1.js');
if(/new\s+MutationObserver/.test(mailTemplates))fail('mail templates MutationObserver returned');
if(/new\s+MutationObserver/.test(offerPdf))fail('offer PDF MutationObserver returned');
if(!offerMail.includes('lm:offer-mail-opened')||!offerMail.includes('lm:offer-mail-ready'))fail('offer mail lifecycle events missing');
if(!mailTemplates.includes('lm:offer-mail-opened'))fail('mail templates offer-mail lifecycle wiring missing');
if(!offerPdf.includes('lm:offer-mail-ready'))fail('offer PDF lifecycle wiring missing');
const feedback=read('saas-feedback-v1.js');
const regression=read('saas-regression-center-v1.js');
if(/new\s+MutationObserver/.test(regression))fail('regression center MutationObserver returned');
if(!feedback.includes('lm:feedback-rendered'))fail('feedback rendered lifecycle event missing');
if(!regression.includes('lm:feedback-rendered'))fail('regression center lifecycle wiring missing');
const settingsHub=read('saas-settings-hub-v1.js');
if(/new\s+MutationObserver/.test(settingsHub))fail('settings hub MutationObserver returned');
if(!settingsHub.includes('function runMountPasses()'))fail('settings deterministic mount passes missing');
if((index.match(/lm:mail-opened/g)||[]).length<4)fail('mail-opened lifecycle wiring regressed');

console.log('PASS: performance guards, event-driven UI and lightweight startup');
