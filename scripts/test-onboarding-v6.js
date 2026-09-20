const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function must(v,m){if(!v)throw new Error(m)}
const ui=read('saas-onboarding-v6.js');
const invite=read('supabase/functions/saas-invite-claim/index.ts');
const edge=read('supabase/functions/saas-onboarding/index.ts');
const boot=read('access-bootstrap-v1.js');

for(const marker of [
  "action:'inspect'",
  "inviteInfo.existing_login===true",
  "readonly",
  "reused_existing_login",
  "lm_ob6_",
  "Trin ${step} af 4",
  "step===4?'Start Lead Manager'",
  "Hvilke leads vil I have?",
  "3. Integrationer",
  "Eksternt CRM",
  "serverTs",
  "localTs>serverTs"
]) must(ui.includes(marker),'missing onboarding v6 UI marker: '+marker);

for(const marker of [
  "action==='inspect'",
  "EXISTING_LOGIN_PASSWORD_REQUIRED",
  "authClient.auth.signInWithPassword",
  "reused_existing_login"
]) must(invite.includes(marker),'missing invite v3 marker: '+marker);

for(const marker of [
  "onboarding_version:'saas_v6'",
  "Math.min(4",
  "onboarding:{version:",
  "source:'customer_onboarding_v6'"
]) must(edge.includes(marker),'missing onboarding edge marker: '+marker);

must(boot.includes("loadLazyScript('/saas-onboarding-v6.js?v=20260920-7')"),'central loader is not on onboarding v6');
must(!boot.includes("loadLazyScript('/saas-onboarding-v5.js"),'central loader still loads onboarding v5');
console.log('PASS: onboarding v6 invitation, resume and four-step guards');
