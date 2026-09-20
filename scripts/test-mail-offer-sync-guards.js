const fs=require('fs');

function assert(v,m){if(!v)throw new Error(m)}
const src=fs.readFileSync('supabase/functions/mail-offer-sync/index.ts','utf8');
const cron=fs.readFileSync('supabase/migrations/20260920055800_schedule_mail_offer_sync.sql','utf8');

for(const marker of [
  'loadStoredPendingMessages',
  "const pending=ids.filter((id:string)=>!known.has(id))",
  'IGNORED_STALE_OFFER_STATUS',
  'IGNORED_CLOSED_OFFER_REOPEN',
  'markMailIgnored',
  'PENDING_APPROVAL',
  "offer_sync_processed:true",
  "mode:'stored_first_closed_guard_pending_v12'",
  "const staleAgainstCurrent=!!matched&&Number.isFinite(statusTime)&&Number.isFinite(mailTime)&&mailTime<=statusTime",
  "closedStatuses.has(matched.status)&&analysis.status==='I GANG'",
  "mode:'stored_first_closed_guard_v10'"
]) assert(src.includes(marker),'missing mail-offer guard: '+marker);

assert(!src.includes('fetchMicrosoftasync function fetchMicrosoft'),'duplicate fetchMicrosoft function marker');
assert((src.match(/async function fetchGmail/g)||[]).length===1,'fetchGmail must exist exactly once');
assert((src.match(/async function fetchMicrosoft/g)||[]).length===1,'fetchMicrosoft must exist exactly once');
assert((src.match(/async function loadStoredPendingMessages/g)||[]).length===1,'stored pending loader must exist exactly once');

for(const marker of [
  "'mail-offer-sync-every-15-minutes'",
  "'8-59/15 * * * *'",
  'mail-offer-sync-runner',
  "name='mail_offer_sync_secret'",
  'timeout_milliseconds := 120000'
]) assert(cron.includes(marker),'missing mail-offer cron guard: '+marker);

console.log('PASS: stored mail offer sync and stale-status guards');
