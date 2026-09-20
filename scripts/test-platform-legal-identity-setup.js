const fs=require('fs');
const ui=fs.readFileSync('legal-agreement-v1.js','utf8');
const edge=fs.readFileSync('supabase/functions/legal-agreement/index.ts','utf8');
const app=fs.readFileSync('api/app.js','utf8');
function must(v,m){if(!v)throw new Error(m)}

for(const marker of [
  "Udfyld juridiske oplysninger",
  "save_provider_identity",
  "provider_identity_status",
  "Jeg bekræfter, at oplysningerne er korrekte",
  "Gem og verificér"
]) must(ui.includes(marker),'missing legal identity UI marker: '+marker);

for(const marker of [
  "action==='provider_identity_status'||action==='save_provider_identity'",
  "PLATFORM_ADMIN_REQUIRED",
  "IDENTITY_CONFIRM_REQUIRED",
  "INVALID_CVR",
  "INVALID_PRIVACY_EMAIL",
  "crm_refresh_platform_legal_identity_check",
  "platform_admin:isPlatformAdmin",
  "evidence_source:'platform_owner_verified_in_app'"
]) must(edge.includes(marker),'missing legal identity edge marker: '+marker);

must(app.includes('legal-agreement-v1.js?v=20260920-4'),'legal agreement cache version not bumped');
console.log('PASS: platform legal identity setup guards');
