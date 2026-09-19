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
if(feedback.includes("lm:workspace-ready',()=>setTimeout(()=>boot(false)"))fail('feedback context fetch returned to workspace startup');
if(feedback.includes("lm:client-data-ready',()=>setTimeout(()=>boot(false)"))fail('feedback context fetch returned to client-data startup');
if(!feedback.includes('function mountWithoutNetwork()'))fail('feedback no-network mount missing');
if(!app.includes('saas-feedback-v1.js?v=20260919-4'))fail('feedback cache version not bumped');
if(!regression.includes('lm:feedback-rendered'))fail('regression center lifecycle wiring missing');
const settingsHub=read('saas-settings-hub-v1.js');
if(/new\s+MutationObserver/.test(settingsHub))fail('settings hub MutationObserver returned');
if(!settingsHub.includes('function runMountPasses()'))fail('settings deterministic mount passes missing');
const onboardingMailSync=read('saas-onboarding-mail-account-sync-v1.js');
if(/new\s+MutationObserver/.test(onboardingMailSync))fail('onboarding mail sync MutationObserver returned');
if(!onboardingMailSync.includes('const delays=[0,100,250,500,1000,2000,4000,7000,11000]'))fail('onboarding deterministic retry schedule missing');
if((index.match(/lm:mail-opened/g)||[]).length<4)fail('mail-opened lifecycle wiring regressed');

const activeRuntime=new Set();
for(const source of [index,app]){
  for(const m of source.matchAll(/<script[^>]+src=["']\/([^"'?]+\.js)(?:\?[^"']*)?["']/g))activeRuntime.add(m[1]);
}
const executive=read('executive-dashboard-v1.js');
activeRuntime.add('executive-dashboard-v1.js');
for(const m of executive.matchAll(/\.src=['"]\/([^"'?]+\.js)(?:\?[^"']*)?['"]/g))activeRuntime.add(m[1]);
const lazyRuntime=['saas-onboarding-v5.js','saas-platform-admin-v1.js','saas-compliance-admin-v1.js','saas-admin-client-switcher-v1.js','saas-admin-users-v1.js','saas-impersonation-v1.js'];
for(const file of lazyRuntime)activeRuntime.add(file);

const intervalAllow=new Set(['executive-dashboard-v1.js']);
for(const file of [...activeRuntime].sort()){
  if(!fs.existsSync(file))fail('active runtime script missing from repository: '+file);
  const src=read(file);
  if(/new\s+MutationObserver/.test(src))fail(file+': active runtime MutationObserver returned');
  if(/\bsetInterval\s*\(/.test(src)&&!intervalAllow.has(file))fail(file+': active runtime polling returned');
  if(/observe\(document\.documentElement/.test(src))fail(file+': active runtime global document observer returned');
}
if(activeRuntime.size<25)fail('active runtime script audit unexpectedly small: '+activeRuntime.size);

for(const file of [...activeRuntime].sort()){
  const src=read(file);
  try{new Function(src)}catch(e){fail(file+': active runtime syntax error: '+e.message)}
}
let inlineCount=0;
for(const m of index.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(/\bsrc\s*=/.test(m[1]))continue;
  const src=m[2].trim();if(!src)continue;
  inlineCount++;
  try{new Function(src)}catch(e){fail('index inline script '+inlineCount+' syntax error: '+e.message)}
}
if(inlineCount<10)fail('inline runtime syntax audit unexpectedly small: '+inlineCount);
const perf=read('performance-v1.js');
if(!perf.includes("select('id',{count:'exact',head:true})"))fail('startup mail count-only query missing');
if(!perf.includes(".eq('status','pending').order('created_at'"))fail('startup approvals pending-only query missing');
if(!perf.includes("window.__LM_MAIL_COUNT"))fail('mail count cache missing');
if(!index.includes("Number.isFinite(window.__LM_MAIL_COUNT)"))fail('dashboard mail count cache wiring missing');
if(!perf.includes("partialStartupKeys=new Set(['activities','mail','approvals','offers'])"))fail('offers not marked partial at startup');
if(!perf.includes("minuba_sync_state':'*'"))fail('light offer column list missing');
if(/select\(light\?'[^']*minuba_raw/.test(perf))fail('heavy minuba_raw returned to startup offers query');
if(!perf.includes("Date.now()-45*86400000"))fail('recent activity startup window missing');
const executiveDashboard=read('executive-dashboard-v1.js');
if(!executiveDashboard.includes("selectedPeriod==='all'&&partialActivities"))fail('dashboard all-period full activity reload missing');
if(!perf.includes("crm_companies').select('id,client_id,name,cvr,domain,phone,address,stoplisted,created_at,relationship_status,do_not_contact,do_not_contact_reason,industry,website_url,employee_size_text,company_summary,research_updated_at,minuba_relationship_status,minuba_relationship_summary,minuba_exact_match,minuba_chain_match,minuba_order_count,minuba_latest_order_date,minuba_latest_order_number,minuba_latest_order_address,minuba_related_locations,minuba_checked_at,legal_form,advertising_protected,robinson_check_required,robinson_checked_at,robinson_blocked,contact_compliance_status')"))fail('trimmed company performance query missing');
if(!index.includes("crm_companies').select('id,client_id,name,cvr,domain,phone,address,stoplisted,created_at,relationship_status,do_not_contact,do_not_contact_reason,industry,website_url,employee_size_text,company_summary,research_updated_at,minuba_relationship_status,minuba_relationship_summary,minuba_exact_match,minuba_chain_match,minuba_order_count,minuba_latest_order_date,minuba_latest_order_number,minuba_latest_order_address,minuba_related_locations,minuba_checked_at,legal_form,advertising_protected,robinson_check_required,robinson_checked_at,robinson_blocked,contact_compliance_status')"))fail('trimmed company base query missing');
if(perf.includes("case 'companies': return supabase.from('crm_companies').select('*')")||index.includes("if(key==='companies')return supabase.from('crm_companies').select('*')"))fail('heavy base company select-star returned');
if(!app.includes('performance-v1.js?v=20260919-5'))fail('performance cache version not bumped');
const onboarding=read('saas-onboarding-v5.js');
if(onboarding.includes('setTimeout(boot,0);setTimeout(boot,500);setTimeout(boot,1500)'))fail('onboarding startup retry burst returned');
if(onboarding.includes("if(ev==='SIGNED_IN'&&s){setTimeout(boot,0)"))fail('onboarding SIGNED_IN retry burst returned');
if(!onboarding.includes("lm:central-onboarding-required"))fail('central onboarding trigger missing');
if(app.includes('<script src="/saas-onboarding-v5.js'))fail('onboarding bundle returned to static startup');
if(!onboarding.includes('window.__LM_ONBOARDING_V5=true'))fail('onboarding lazy-load guard missing');
if(!onboarding.includes('window.__LM_ONBOARDING_CLAIM_PROMISE=claim()'))fail('onboarding invite claim promise missing');
try{new Function(onboarding)}catch(e){fail('lazy onboarding syntax error: '+e.message)}
const platformAdmin=read('saas-platform-admin-v1.js');
if(platformAdmin.includes("supabase.rpc('crm_is_platform_admin'"))fail('platform-admin permission RPC returned');
if(platformAdmin.includes('style();await loadSettings()'))fail('platform system-mail status returned to startup');
if(!platformAdmin.includes('lm:access-ready'))fail('platform admin access event wiring missing');
if(adminUsers.includes('async function probe()')||adminUsers.includes('probe()'))fail('admin users startup probe returned');
if(!adminUsers.includes('ensureCard();updateSummary()'))fail('admin users lazy card mount missing');
const legalAgreement=read('legal-agreement-v1.js');
if(legalAgreement.includes('setTimeout(refresh,1400);setTimeout(refresh,4000)'))fail('duplicate legal startup refresh returned');
if(!legalAgreement.includes('function scheduleRefresh(delay=0)'))fail('legal refresh coalescer missing');
if(!legalAgreement.includes('if(refreshPromise)return refreshPromise'))fail('legal in-flight coalescing missing');
if(!app.includes('legal-agreement-v1.js?v=20260919-3'))fail('legal agreement cache version not bumped');
const customerControls=read('saas-customer-controls-v1.js');
if(!customerControls.includes('function accessPlan()'))fail('customer controls access-plan helper missing');
if(!customerControls.includes('function hydrateFromAccess()'))fail('customer controls bootstrap-plan hydration missing');
if(!customerControls.includes("const local=hydrateFromAccess();if(local)return local"))fail('customer controls still require onboarding status at startup');
if(!app.includes('saas-customer-controls-v1.js?v=20260919-3'))fail('customer controls cache version not bumped');
const sessionPlanMigration=read('supabase/migrations/20260919150500_session_bootstrap_plan_context.sql');
if(!sessionPlanMigration.includes("'plan',plan_ctx"))fail('session bootstrap plan context migration missing');
const accessBootstrap=read('access-bootstrap-v1.js');
if(!accessBootstrap.includes("supabase.rpc('crm_session_bootstrap')"))fail('direct session bootstrap RPC missing');
if(accessBootstrap.includes('/functions/v1/session-bootstrap'))fail('session bootstrap Edge Function returned to startup');
if(accessBootstrap.includes("supabase.from('crm_users')"))fail('crm_users startup query returned');
if(!accessBootstrap.includes('access.client&&String(access.client.id)===String(clientId)'))fail('bootstrap client reuse missing');
const sessionClientMigration=read('supabase/migrations/20260919152500_session_bootstrap_client_context.sql');
if(!sessionClientMigration.includes("'client',m.client_ctx"))fail('session bootstrap client context missing');
if(!sessionClientMigration.includes("'membership',jsonb_build_object"))fail('session bootstrap membership context missing');
if(!app.includes('access-bootstrap-v1.js?v=20260919-7'))fail('access bootstrap cache version not bumped');
if(!accessBootstrap.includes("script.src='/saas-onboarding-v5.js?v=20260919-5'"))fail('lazy onboarding loader missing');
if(!accessBootstrap.includes('await ensureOnboardingScript()'))fail('central onboarding does not await lazy bundle');
if(!accessBootstrap.includes('await window.__LM_ONBOARDING_CLAIM_PROMISE'))fail('invite onboarding claim is not awaited');
if(!accessBootstrap.includes('if(bootPromise)return null'))fail('rescue can race active bootstrap');
if(!accessBootstrap.includes("['onboarding','denied','login'].includes(window.LM_ACCESS?.next_route||'')"))fail('rescue route guard missing');
const adminLazyFiles=['saas-platform-admin-v1.js','saas-compliance-admin-v1.js','saas-admin-client-switcher-v1.js','saas-admin-users-v1.js','saas-impersonation-v1.js'];
for(const file of adminLazyFiles)if(app.includes('<script src="/'+file))fail(file+' returned to static startup');
for(const file of adminLazyFiles)if(!accessBootstrap.includes('/'+file+'?v='))fail(file+' missing from admin lazy loader');
if(!accessBootstrap.includes('/saas-platform-admin-v1.js?v=20260919-4'))fail('platform admin lazy cache version missing');
if(!accessBootstrap.includes('/saas-admin-users-v1.js?v=20260919-3'))fail('admin users lazy cache version missing');
if(!accessBootstrap.includes('if(access.platform_admin)await ensureAdminBundles()'))fail('platform admin lazy-bundle gate missing');
if(!accessBootstrap.includes('loadAdmin:ensureAdminBundles'))fail('admin lazy loader is not exposed for recovery');
const startupSnapshotMigration=read('supabase/migrations/20260919154500_startup_snapshot_rpc.sql');
if(!startupSnapshotMigration.includes('crm_startup_snapshot(p_client_id uuid)'))fail('startup snapshot RPC migration missing');
if(!startupSnapshotMigration.includes('crm_has_client_access(p_client_id)'))fail('startup snapshot access guard missing');
if(!perf.includes("supabase.rpc('crm_startup_snapshot',{p_client_id:cid})"))fail('startup snapshot RPC not used');
if(!perf.includes("mode:'startup_snapshot'"))fail('startup snapshot refresh mode missing');
if(!perf.includes("requestedView==='dashboard'"))fail('startup snapshot dashboard guard missing');

console.log('PASS: performance guards, event-driven UI and lightweight startup · audited '+activeRuntime.size+' runtime scripts + '+inlineCount+' inline scripts');
