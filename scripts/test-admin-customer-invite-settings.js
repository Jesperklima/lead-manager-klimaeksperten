const fs=require('fs');
const assert=require('assert');

const ui=fs.readFileSync('saas-admin-customer-invite-v1.js','utf8');
const bootstrap=fs.readFileSync('access-bootstrap-v1.js','utf8');
const settings=fs.readFileSync('saas-settings-hub-v1.js','utf8');
const onboarding=fs.readFileSync('saas-onboarding-v6.js','utf8');

assert(ui.includes("window.LM_ACCESS?.platform_admin===true"),'customer invite must be platform-admin only');
assert(ui.includes("/functions/v1/saas-admin-invite"),'customer invite must use saas-admin-invite backend');
assert(ui.includes('Invitér ny kunde'),'invite heading missing');
assert(ui.includes('Opret kunde og send invitation'),'invite CTA missing');
assert(ui.includes("data-lmaci-plan=\"start\""),'Start package missing');
assert(ui.includes("data-lmaci-plan=\"pro\""),'Pro package missing');
assert(ui.includes("data-lmaci-plan=\"business\""),'Business package missing');
assert(ui.includes('eget Lead Manager-workspace'),'new-workspace wording missing');
assert(ui.includes('14')||ui.includes('invite_validity_days'),'invite validity handling missing');

assert(bootstrap.includes('/saas-admin-customer-invite-v1.js?v=20260922-1'),'customer invite module not loaded with settings');
assert(settings.includes('window.LMAdminCustomerInvite?.mount?.()'),'account settings do not mount customer invite');
assert(onboarding.includes('function admin(){window.LMAdminCustomerInvite?.mount?.()}'),'legacy onboarding admin UI still active');
assert(!onboarding.includes('<h2 style="margin-top:0">Invitér ny kunde</h2>'),'legacy duplicate invite form still present');

console.log('PASS: platform-admin customer invite lives in Account settings and legacy duplicate is removed');
