const fs=require('fs');

const ui=fs.readFileSync('saas-customer-controls-v1.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260919193601_lead_pool_ui_backend_v1.sql','utf8');

for(const marker of [
  'crm_set_new_lead_pool_limit',
  'data-lm-pool-limit="10"',
  'data-lm-pool-limit="20"',
  'data-lm-pool-limit="30"',
  'Nye leads i puljen',
  'currentLeadPoolLimit',
  'saveLeadPoolLimit'
]){
  if(!ui.includes(marker))throw new Error('Lead-pool UI marker missing: '+marker);
}

for(const marker of [
  'p_limit not in (10,20,30)',
  "lower(coalesce(u.role,'')) in ('owner','admin')",
  "coalesce(lead_pool,'standard')='standard'",
  'dispatch_autonomous_lead_hunter_v3_for_client',
  'if v_new_limit>v_old_limit then'
]){
  if(!migration.includes(marker))throw new Error('Lead-pool backend marker missing: '+marker);
}

if(migration.includes('dispatch_autonomous_lead_hunter_v2_for_client')){
  throw new Error('Lead-pool refill must not dispatch Lead Hunter v2');
}

console.log('PASS: lead-pool UI 10/20/30 and v3 refill backend are wired');
