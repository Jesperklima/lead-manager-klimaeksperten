const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v)throw new Error(m)}

const html=read('index.html');
const access=read('access-bootstrap-v1.js');
const settings=read('saas-settings-hub-v1.js');
const feedback=read('saas-feedback-v1.js');
const credit=read('saas-credit-check-v1.js');

const navViews=[...html.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
for(const view of navViews)assert(new RegExp('<section\\s+id="'+view+'"(?:\\s|>)').test(html),`navigation target missing section: ${view}`);
assert(navViews.includes('leadmanager')&&navViews.includes('feedback')&&navViews.includes('creditcheck'),'settings/feedback/creditcheck navigation missing');
assert(!html.includes('</section>\\n<section id="leadmanager"'),'literal \\n text node returned between navigation views');
assert(feedback.includes("#feedback .lmfb-card,#feedback .lmfb-item{background:linear-gradient"),'feedback dark-theme contrast override missing');
assert(settings.includes("#leadmanager #lmSettingsIntro{background:linear-gradient"),'settings dark-theme contrast override missing');

assert(access.includes("'/saas-settings-hub-v1.js?v=20260920-16'"),'settings hub is not loaded for platform-admin workspace context');
assert(!access.includes("if(window.LM_ACCESS?.platform_admin!==true)scripts.unshift('/saas-settings-hub-v1.js"),'platform admins are still excluded from settings hub');
assert(access.includes('function markNavIntent(view)'), 'navigation epoch tracker missing');
assert(access.includes("navIntentMatches('feedback',intent.epoch)"),'feedback lazy navigation race guard missing');
assert(access.includes("navIntentMatches('creditcheck',intent.epoch)"),'credit-check lazy navigation race guard missing');
assert(access.includes("detail:{nav_epoch:intent.epoch}"),'lazy navigation request epoch is not propagated');

assert(settings.includes("function isCustomer(){return window.LM_ACCESS?.authenticated===true&&typeof state!=='undefined'&&!!state?.client}"),'settings still block platform admin workspace context');
assert(settings.includes("if(!isCustomer()||isPlatformAdmin())return;"),'platform admin customer controls are hidden incorrectly');
assert(settings.includes("if(isPlatformAdmin()){billingLoading=false;billingError='';billingState=null;renderAccount();return}"),'platform admin settings can still trigger customer billing mutations');
assert(settings.includes("platformAdmin?'Platform owner'"),'platform admin role is not represented safely in settings');

assert(feedback.includes("if(!navIntentMatches('feedback',epoch))return"),'feedback can reopen after the user navigates elsewhere');
assert(credit.includes("!window.LMNavigation.matches('creditcheck',epoch)"),'credit check can reopen after the user navigates elsewhere');

console.log('PASS: navigation targets, platform-admin settings access and lazy-view race guards');
