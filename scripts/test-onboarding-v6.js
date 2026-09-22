const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function must(v,m){if(!v)throw new Error(m)}

const ui=read('saas-onboarding-v6.js');
const invite=read('supabase/functions/saas-invite-claim/index.ts');
const edge=read('supabase/functions/saas-onboarding/index.ts');
const boot=read('access-bootstrap-v1.js');

// 1) Four steps instead of six.
must(ui.includes("Trin ${step} af 4"),'onboarding is not four steps');
must(ui.includes("step===4?'Start Lead Manager'"),'step 4 is not the final start step');
must(!ui.includes('Trin ${step} af 6'),'legacy six-step UI returned');

// 2) Invitation already knows company and e-mail.
for(const marker of ["action:'inspect'","inviteInfo.company_name","inviteInfo.email","readonly"])
  must(ui.includes(marker),'invite prefill UI marker missing: '+marker);
for(const marker of ["action === 'inspect'","email: inviteEmail","company_name: client.name"])
  must(invite.includes(marker),'invite inspect marker missing: '+marker);

// 3) Existing login can be reused.
for(const marker of [
  "inviteInfo.existing_login===true",
  "Fortsæt med dit Lead Manager-login",
  "EXISTING_LOGIN_PASSWORD_REQUIRED",
  "authClient.auth.signInWithPassword",
  "reused_existing_login"
]) must((ui+'\n'+invite).includes(marker),'existing-login reuse marker missing: '+marker);

// 4) Server determines the resume step.
must(edge.includes("resumeStep=version==='saas_v6'?Math.max(1,Math.min(4,rawStep))"),'server resume-step normalization missing');
must(edge.includes("step:resumeStep"),'server does not return normalized resume step');
must(ui.includes("const raw=Number(status?.onboarding?.step||1);"),'UI does not use server resume step');
must(!ui.includes("(localTs>serverTs?local.step:null)"),'local storage can still override server resume step');
must(!ui.includes(");step=3;saveLocal();['microsoft'"),'OAuth return can still override server resume step locally');

// Local draft data may still preserve newer unsaved field values, but not the step.
must(ui.includes("const chosen=localTs>serverTs?local:saved;"),'newer local draft field recovery missing');

// 5) Mail/CRM are optional and cannot block onboarding access.
must(ui.includes("mail_provider:settings.mail_provider_preference||settings.mail_provider||'later'"),'mail does not default to connect-later');
must(ui.includes("Du kan starte Lead Manager nu og forbinde mail senere"),'mail connect-later UX missing');
must(ui.includes("CRM er også valgfrit."),'external CRM is not explicitly optional');
must(ui.includes("uden at forsinke opstarten"),'external CRM can still appear blocking');
const validateBlock=ui.slice(ui.indexOf('function validate()'),ui.indexOf('async function connectOauth'));
must(!validateBlock.includes('step===3'),'integration step still has blocking validation');
must(edge.includes("mailPreference=str(body.mail_provider||'later'"),'server complete does not default mail to later');
must(edge.includes("onboarding_completed:true"),'server does not complete onboarding without integrations');

must(boot.includes("loadLazyScript('/saas-onboarding-v6.js?v=20260922-atomic-2')"),'central loader is not on onboarding v6');
must(!boot.includes("loadLazyScript('/saas-onboarding-v5.js"),'central loader still loads onboarding v5');

console.log('PASS: Onboarding v2 requirements — 4 steps, invite prefill, login reuse, server resume, optional mail/CRM');
