const fs=require('fs');
const p='supabase/migrations/20260920054500_external_crm_sync_foundation.sql';
const s=fs.readFileSync(p,'utf8');
const fail=m=>{throw new Error(m)};
for(const table of ['crm_external_entity_links','crm_external_sync_queue','crm_external_sync_log']){
  if(!s.includes('create table if not exists public.'+table))fail('missing '+table);
  if(!s.includes('alter table public.'+table+' enable row level security'))fail('RLS missing for '+table);
}
for(const marker of [
  "where status='queued'",
  "crm_enqueue_external_sync_internal",
  "crm_external_sync_trigger",
  "crm_request_external_sync",
  "crm_external_sync_status",
  "'crm_webhook'",
  "'hubspot'",
  "'pipedrive'",
  "'dynamics365'",
  "'salesforce'",
  "revoke all on table public.crm_external_sync_queue from anon, authenticated",
  "grant select on table public.crm_external_sync_queue to authenticated",
  "revoke all on function public.crm_enqueue_external_sync_internal(uuid,text,uuid,text,jsonb) from public, anon, authenticated"
]) if(!s.includes(marker))fail('missing CRM foundation guard: '+marker);

for(const table of ['crm_companies','crm_contacts','crm_leads']){
  if(!s.includes('create trigger '+table.replace('crm_','crm_')+'_external_sync') && !s.includes('on public.'+table)) {
    fail('external CRM trigger missing for '+table);
  }
}
console.log('PASS: external CRM provider-neutral sync foundation');
