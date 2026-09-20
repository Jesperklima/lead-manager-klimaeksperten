const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v)throw new Error(m)}

const webUi=read('saas-website-intake-v1.js');
const intUi=read('saas-integrations-overview-v2.js');
const opsUi=read('saas-admin-ops-v2.js');
const boot=read('access-bootstrap-v1.js');
const webSql=read('supabase/migrations/20260920091500_website_intake_self_service.sql');
const opsSql=read('supabase/migrations/20260920094500_platform_ops_snapshot_v2.sql');
const hook=read('supabase/functions/marketing-webhook/index.ts');

for(const marker of [
  'crm_website_intake_setup',
  'crm_website_intake_rotate',
  'crm_website_intake_qualify_business',
  'crm_website_intake_promote',
  'crm_website_intake_reject',
  "v_type<>'business'",
  "platform='website'",
  'crm_can_manage_workspace'
]) assert(webSql.includes(marker),'missing website intake SQL marker: '+marker);

assert(webSql.includes("revoke all on function public.crm_website_intake_setup(uuid,text) from public,anon"),'website setup is not revoked from anon');
assert(webSql.includes("grant execute on function public.crm_website_intake_setup(uuid,text) to authenticated,service_role"),'website setup authenticated grant missing');

for(const marker of [
  "platform==='website'?'unknown':'private'",
  "conn.platform==='website'&&intakeType==='private'",
  "Private website inquiry excluded by B2B policy"
]) assert(hook.includes(marker),'missing website webhook B2B marker: '+marker);

for(const marker of [
  'Hjemmeside',
  'x-lead-manager-key',
  'crm_website_intake_setup',
  'crm_website_intake_rotate',
  'crm_website_intake_qualify_business',
  'crm_website_intake_promote',
  'crm_website_intake_reject',
  'Private'
]) assert(webUi.includes(marker),'missing website UI marker: '+marker);

for(const marker of [
  'Integrationer · overblik',
  "'Mail'",
  "'Minuba'",
  "'Website'",
  "'CRM'",
  "'Marketing'",
  'needs_authorization',
  'needs_reconnect',
  'needs_credentials'
]) assert(intUi.includes(marker),'missing integrations overview marker: '+marker);

for(const marker of [
  'crm_platform_ops_snapshot_v2',
  'crm_is_platform_admin()',
  'crm_mfa_satisfied()',
  'auth.users',
  'last_sign_in_at',
  'queue_issues',
  'cron_failures_24h',
  'ai_usage_30d',
  'mail_usage_30d'
]) assert(opsSql.includes(marker),'missing platform ops SQL marker: '+marker);
assert(opsSql.includes("revoke all on function public.crm_platform_ops_snapshot_v2() from public,anon"),'ops snapshot is not revoked from anon');

for(const marker of [
  'Driftsovervågning',
  'crm_platform_ops_snapshot_v2',
  'Kræver handling',
  'Integrationsfejl',
  'Køproblemer',
  'Cron-fejl 24t'
]) assert(opsUi.includes(marker),'missing admin ops UI marker: '+marker);

for(const marker of [
  '/saas-website-intake-v1.js?v=20260920-1',
  '/saas-integrations-overview-v2.js?v=20260920-1',
  '/saas-admin-ops-v2.js?v=20260920-1'
]) assert(boot.includes(marker),'new bundle is not lazy-loaded: '+marker);

console.log('PASS: website intake, integrations center v2 and admin ops v2 guards');
