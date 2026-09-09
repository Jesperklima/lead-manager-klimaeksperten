const fs=require('fs');
const must=(file,markers)=>{const s=fs.readFileSync(file,'utf8');for(const m of markers){if(!s.includes(m))throw new Error(`${file}: missing regression marker: ${m}`)}};

must('api/app.js',[
  "const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','LUKKET','STATUS UKLAR']",
  'saas-regression-center-v1.js?v=20260909-1',
  '.status.LUKKET'
]);

must('supabase/migrations/20260909120500_feedback_regression_guards_v1.sql',[
  'crm_regression_guards',
  'trg_crm_feedback_create_regression_guard',
  'trg_crm_feedback_require_verified_regression',
  "new.status = 'built'",
  "guard_status is distinct from 'verified'"
]);

must('supabase/functions/customer-feedback/index.ts',[
  "action==='regression_update'",
  'requires_regression_guard',
  "feedbackType==='bug'",
  'implementation_reference',
  'test_reference'
]);

must('supabase/functions/minuba-offer-status-sync/index.ts',[
  "minuba_sync_state:'missing_once'",
  "o.minuba_sync_state==='missing_once'",
  '30*60*1000',
  "patch.status='LUKKET'",
  'to sikre statuskontroller',
  "minuba_sync_state:'converted_to_order'",
  "patch.status='VUNDET'",
  'Genåbnet automatisk'
]);

must('supabase/migrations/20260909121500_minuba_offer_status_sync_hourly_v1.sql',[
  'minuba-offer-status-sync-hourly',
  "'10 * * * *'",
  'minuba-offer-status-sync'
]);

must('saas-regression-center-v1.js',[
  'Fejl der ikke må komme igen',
  'Verificér forebyggelse',
  "action:'regression_update'",
  "status:'built'"
]);

console.log('PASS: regression guards, Minuba closure sync and verified-bug gate');
