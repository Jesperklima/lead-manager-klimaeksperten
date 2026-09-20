const fs=require('fs');

function read(p){return fs.readFileSync(p,'utf8')}
function assert(v,m){if(!v)throw new Error(m)}

const edge=read('supabase/functions/external-crm-sync/index.ts');
const ui=read('saas-crm-integrations-v1.js');
const mig=read('supabase/migrations/20260920083000_external_crm_complete.sql');
const boot=read('access-bootstrap-v1.js');

for(const marker of [
  "connect_hubspot",
  "connect_webhook",
  "action==='resync'",
  "action==='disconnect'",
  "crm_external_crm_get_secret",
  "crm_external_crm_store_secret",
  "crm_claim_external_sync_jobs",
  "crm_apply_external_crm_inbound",
  "X-Lead-Manager-Signature",
  "x-lead-manager-secret",
  "x-external-crm-sync-secret",
  "/crm/v3/objects/companies",
  "/crm/v3/objects/contacts",
  "/crm/v3/pipelines/deals",
  "/crm/v3/objects/",
  "/crm/v4/associations/",
  "batch/read",
  "last_inbound_poll_at",
  "provider:'hubspot'",
  "provider:'crm_webhook'"
]) assert(edge.includes(marker),'missing CRM engine marker: '+marker);

for(const marker of [
  "CRM-forbindelse",
  "HubSpot access token",
  "Andet CRM via webhook/API",
  "Synkronisér alt igen",
  "Frakobl",
  "PENDING"
].filter(Boolean)){
  if(marker==='PENDING')continue;
  assert(ui.includes(marker),'missing CRM UI marker: '+marker);
}
assert(ui.includes("functions/v1/external-crm-sync"),'CRM UI is not wired to edge function');
assert(ui.includes('data-crm-action')&&ui.includes('resync'),'CRM resync button missing');
assert(ui.includes('data-crm-action')&&ui.includes('disconnect'),'CRM disconnect button missing');
assert(ui.includes("setupSecret={url:d.inbound_url,secret:d.inbound_secret}"),'one-time inbound secret flow missing');

for(const marker of [
  "crm_external_crm_store_secret",
  "crm_external_crm_get_secret",
  "crm_external_crm_delete_secret",
  "crm_claim_external_sync_jobs",
  "crm_apply_external_crm_inbound",
  "external-crm-sync-every-5-minutes",
  "*/5 * * * *",
  "app.external_crm_inbound",
  "vault.create_secret",
  "service_role"
]) assert(mig.includes(marker),'missing CRM migration marker: '+marker);

assert(boot.includes("/saas-crm-integrations-v1.js?v=20260920-8"),'CRM settings module is not lazy-loaded');
assert(!mig.includes("grant execute on function public.crm_external_crm_get_secret(uuid) to authenticated"),'secret read was granted to authenticated');
assert(!mig.includes("grant execute on function public.crm_external_crm_store_secret(uuid,jsonb) to authenticated"),'secret write was granted to authenticated');
console.log('PASS: complete external CRM connector guards');
