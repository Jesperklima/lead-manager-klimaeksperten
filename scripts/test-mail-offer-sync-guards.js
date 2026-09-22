const fs=require('fs');

function assert(v,m){if(!v)throw new Error(m)}
const src=fs.readFileSync('supabase/functions/mail-offer-sync/index.ts','utf8');
const cron=fs.readFileSync('supabase/migrations/20260920055800_schedule_mail_offer_sync.sql','utf8');

for(const marker of [
  'loadStoredPendingMessages',
  "const pending=ids.filter((id:string)=>!known.has(id))",
  'IGNORED_STALE_OFFER_STATUS',
  'IGNORED_CLOSED_OFFER_REOPEN',
  'IGNORED_CLOSED_STATUS_CONFLICT',
  'markMailIgnored',
  'PENDING_APPROVAL',
  "offer_sync_processed:true",
  "const allowDecisiveOverrideOpen=!!matched&&decisiveInbound&&!closedStatuses.has(matched.status)",
  "matchType='mail_thread_offer'",
  'threadOfferByKey',
  'decision_excerpt:decisionExcerpt(m.body)',
  'needs_review:!!analysis.needsReview',
  'Godkendt via mail – afventer ordreoprettelse i Minuba.',
  "mode:'mail_decision_v2_thread_context_v13'"
]) assert(src.includes(marker),'missing mail-offer guard: '+marker);

assert(!src.includes('fetchMicrosoftasync function fetchMicrosoft'),'duplicate fetchMicrosoft function marker');
assert((src.match(/async function fetchGmail/g)||[]).length===1,'fetchGmail must exist exactly once');
assert((src.match(/async function fetchMicrosoft/g)||[]).length===1,'fetchMicrosoft must exist exactly once');
assert((src.match(/async function loadStoredPendingMessages/g)||[]).length===1,'stored pending loader must exist exactly once');
assert(src.includes('"takke ja" "takker ja"'),'Gmail candidate search does not include clear acceptance language');

function sourceRegex(name){
  const marker='const '+name+'=/';
  const start=src.indexOf(marker);
  assert(start>=0,'missing regex '+name);
  const bodyStart=start+marker.length;
  const end=src.indexOf('/i;',bodyStart);
  assert(end>bodyStart,'unterminated regex '+name);
  return new RegExp(src.slice(bodyStart,end),'i');
}
const lost=sourceRegex('mailDecisionLostRe');
const hardWon=sourceRegex('mailDecisionHardWonRe');
const softWon=sourceRegex('mailDecisionSoftWonRe');
const negotiation=sourceRegex('mailDecisionNegotiationRe');
function probe(text){
  if(lost.test(text))return'lost';
  if(hardWon.test(text))return'won';
  if(softWon.test(text)&&!negotiation.test(text))return'won';
  if(negotiation.test(text))return'negotiation';
  return'review';
}

assert(probe('Tak for dit tilbud, det vil vi gerne takke ja til.')==='won','Carl Zeiss acceptance phrase must be won');
assert(probe('Tak for tilbuddet. Vi takker nej denne gang.')==='lost','clear Danish rejection must be lost');
assert(probe('Vi vil gerne gå videre, men kan du ændre prisen?')==='negotiation','conditional proceed with price change must stay negotiation');
assert(probe('Please proceed with the order.')==='won','clear English acceptance must be won');
assert(probe('Tak for mailen. Vi vender tilbage.')==='review','non-decisive reply must not be auto-closed');

for(const marker of [
  "'mail-offer-sync-every-15-minutes'",
  "'8-59/15 * * * *'",
  'mail-offer-sync-runner',
  "name='mail_offer_sync_secret'",
  'timeout_milliseconds := 120000'
]) assert(cron.includes(marker),'missing mail-offer cron guard: '+marker);

console.log('PASS: Mail Decision Engine v2, thread context, stale-status guards and acceptance classification');
