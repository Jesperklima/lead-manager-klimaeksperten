const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function assert(cond,msg){if(!cond)throw new Error(msg)}

const gate=read('mfa-gate-v1.js');
for(const marker of [
  "factors/'+encodeURIComponent(factorId)+'/challenge",
  "factors/'+encodeURIComponent(factorId)+'/verify",
  "factor_type:'totp'",
  "friendly_name:'Lead Manager'",
  "localStorage.setItem(STORAGE,JSON.stringify(next))",
  "verifiedTotp",
  "location.reload()"
]) assert(gate.includes(marker),'missing MFA gate marker: '+marker);

assert(gate.includes("if(!session?.access_token)throw new Error('Login-session mangler')"),'MFA calls must require a real session');
assert(gate.includes("status==='verified'"),'MFA login must only trust verified factors');

const bootstrap=read('access-bootstrap-v1.js');
assert(bootstrap.includes("access.next_route==='mfa'"),'access bootstrap does not handle MFA route');
assert(bootstrap.includes("access.mfa_required===true&&access.mfa_satisfied!==true"),'MFA requirement fallback missing');
assert(bootstrap.includes("loadLazyScript('/mfa-gate-v1.js?v=20260920-1')"),'MFA gate is not lazy-loaded');

const migration=read('supabase/migrations/20260920053500_privileged_mfa_aal2.sql');
for(const marker of [
  'crm_privileged_mfa_required',
  'crm_mfa_satisfied',
  "coalesce(auth.jwt()->>'aal','aal1') = 'aal2'",
  "'next_route','mfa'",
  'public.crm_mfa_satisfied()'
]) assert(migration.includes(marker),'missing MFA migration marker: '+marker);

console.log('PASS: privileged MFA AAL2 guards');
