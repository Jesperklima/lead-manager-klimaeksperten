const fs=require('node:fs');
const p='supabase/migrations/20260918193000_full_system_integrity_hardening.sql';
const s=fs.readFileSync(p,'utf8');
for(const marker of [
  'crm_guard_same_client_reference',
  'trg_tenant_leads_company',
  'trg_tenant_contacts_company',
  'trg_tenant_mail_thread',
  'trg_tenant_activities_company',
  'crm_offers_status_check',
  'crm_leads_status_check',
  'crm_contacts_email_shape_check',
  'crm-agent-run-watchdog',
  "status='LUKKET'"
]) if(!s.includes(marker))throw new Error('missing integrity hardening marker: '+marker);
console.log('PASS: full-system data integrity hardening migration is present');
