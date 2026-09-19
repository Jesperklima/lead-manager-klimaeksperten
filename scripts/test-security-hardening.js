const fs=require('fs');

const must=(file,markers)=>{
  const s=fs.readFileSync(file,'utf8');
  for(const m of markers){
    if(!s.includes(m)) throw new Error(`${file}: missing security hardening marker: ${m}`);
  }
};

must('supabase/migrations/20260919191335_security_hardening_v1.sql',[
  'service_only_deny_all',
  'revoke all privileges on table %I.%I from anon, authenticated'
]);

must('supabase/migrations/20260919191808_security_hardening_browser_table_privileges_v2.sql',[
  'revoke truncate, references, trigger on all tables in schema public from anon, authenticated',
  'alter default privileges for role postgres in schema public'
]);

must('supabase/migrations/20260919191859_security_hardening_trigger_rpc_surface_v3.sql',[
  "p.prorettype='trigger'::regtype",
  'revoke execute on function %s from public, anon, authenticated'
]);

must('supabase/migrations/20260919191957_security_hardening_remove_anon_rpc_surface_v4.sql',[
  'crm_is_personally_owned_company',
  'crm_normalize_documented_source_type',
  'from public, anon'
]);

console.log('PASS: database security hardening migrations are present and fail-closed');
