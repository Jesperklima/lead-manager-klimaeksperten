const fs=require('fs');

const ui=fs.readFileSync('saas-customer-controls-v1.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260919193601_lead_pool_ui_backend_v1.sql','utf8');
const settingsMigration=fs.readFileSync('supabase/migrations/20260921080500_lead_settings_workspace_rpc.sql','utf8');

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

for(const marker of [
  "if(window.LM_ACCESS?.platform_admin===true)return true",
  "b.onclick=()=>saveLeadPoolLimit",
  "edit.onclick=()=>",
  "crm_update_lead_search_profile"
]){
  if(!ui.includes(marker))throw new Error('Lead settings Platform Owner marker missing: '+marker);
}
for(const marker of [
  'crm_update_lead_search_profile',
  'crm_can_manage_workspace',
  'Platform Owner'
]){
  if(!settingsMigration.includes(marker))throw new Error('Lead settings workspace RPC marker missing: '+marker);
}
for(const marker of [
  '#lmLeadSettingsModal .lmcc{width:min(920px,96vw);max-height:92vh;overflow:auto;background:#081923;color:#eaf4fb',
  '#lmLeadSettingsModal label{display:block;font-size:12px;font-weight:750;color:#c7d7e3',
  'background:#132733;color:#f4fbff',
  '.chip.on{border-color:rgba(77,224,176,.55);background:rgba(77,224,176,.14);color:#7cf0c7}',
  '.choice.on{border-color:rgba(77,224,176,.55);background:rgba(77,224,176,.14);color:#7cf0c7}',
  '#lmLeadSettingsModal .btn.primary{background:#4de0b0;color:#06261d'
]){
  if(!ui.includes(marker))throw new Error('Lead settings dark-theme marker missing: '+marker);
}
if(ui.includes('#lmLeadSettingsModal .lmcc{width:min(920px,96vw);max-height:92vh;overflow:auto;background:#fff')){
  throw new Error('Lead settings modal light background returned');
}
console.log('PASS: lead-pool UI 10/20/30, Platform Owner edit access, secure workspace save, dark settings modal and v3 refill backend are wired');
