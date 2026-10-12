'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const src=fs.readFileSync('supabase/functions/_shared/mail-integrity-watch.ts','utf8');
const runner=fs.readFileSync('supabase/functions/gmail-send-postprocess/index.ts','utf8');
for(const marker of [
  "export async function watchMailIntegrity(",
  "new Date(nowMs-7*86400000)",
  ".in('status',[...statuses])",
  "j.status==='unknown'?20:15",
  "'mail_send_job',j.id,key",
  "rule_key:'mail_integrity'",
  "onConflict:'client_id,fingerprint'",
  "status:'open'",
  "status:'resolved'",
  "manualR.data||[]",
  "a.metadata?.manual===true",
  "a.metadata?.method==='verified_offer_save'",
  "new Date(nowMs-86400000)",
  "nowMs-new Date(j.sent_at).getTime())<15*60000",
  "type:'followup_mismatch'",
  "type:'stuck_send'",
  "timeZone:'Europe/Copenhagen'",
])assert(src.includes(marker),'Missing monitor guard: '+marker);
for(const disallowed of ['gmailSendMime','messages/send','gmail.googleapis','oauth2.googleapis','send_email','sendMail('])
  assert(!src.includes(disallowed),'Passive monitor must never send mail: '+disallowed);
assert(runner.includes('const watch=await watchMailIntegrity(admin)'),'Cron must invoke passive monitor');
assert(runner.includes("reconciliation:'mail_integrity_watch'"),'Findings must be reported as distinct monitoring results');
assert(runner.includes('catch(watchError)'),'Monitor problems must not interrupt send finalization');
const begin=src.indexOf('const localDate=(value:string)=>');
const end=src.indexOf(';',src.indexOf('\n};',begin))+1;
assert(begin>=0&&end>begin,'Missing timezone helper');
const actual=src.slice(begin,end).replace('value:string','value').replace('type:string','type');
const scope={Intl,Date};vm.runInNewContext(actual+'\nthis.localDate=localDate;',scope);
for(const [iso,want] of [
 ['2026-10-12T07:00:00Z','2026-10-12'],
 ['2026-03-29T07:00:00Z','2026-03-29'],
 ['2026-10-25T08:00:00Z','2026-10-25']
])assert.equal(scope.localDate(iso),want,'Copenhagen dates must be DST-safe');
console.log('PASS: passive mail watchdog guardrails and executable timezone checks');
