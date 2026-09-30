const fs=require('fs');

function assert(v,m){if(!v)throw new Error(m)}
const src=fs.readFileSync('supabase/functions/mail-offer-sync/index.ts','utf8');
const cron=fs.readFileSync('supabase/migrations/20260920055800_schedule_mail_offer_sync.sql','utf8');
const threadCandidates=fs.readFileSync('supabase/migrations/20260922094500_mail_decision_v2_thread_candidates.sql','utf8');

for(const marker of [
  'loadStoredPendingMessages',
  "const pending=ids.filter((id:string)=>!known.has(id)||legacyReinspect.has(id))",
  'IGNORED_STALE_OFFER_STATUS',
  'IGNORED_CLOSED_OFFER_REOPEN',
  'IGNORED_CLOSED_STATUS_CONFLICT',
  'markMailIgnored',
  'PENDING_APPROVAL',
  'LINKED_NO_STATUS_CHANGE',
  'IGNORED_SUPPLIER_QUOTE',
  'supplierQuoteLooksLikely',
  'customerMailVerified',
  'identityAutomatic',
  'statusAutomatic',
  "syncResult==='PENDING_APPROVAL'",
  "source_evidence:min?'explicit_mail_minuba_validated':'explicit_customer_mail_verified'",
  "offer_sync_processed:targetComplete",
  "const allowDecisiveOverrideOpen=!!matched&&decisiveInbound&&!closedStatuses.has(matched.status)",
  "matchType='mail_thread_offer'",
  'threadOfferByKey',
  'quotedExternalReply',
  "decisionSource=quotedReply?'quoted_external_customer_reply'",
  'decision_sender:decisionSender',
  'decision_excerpt:clean(decisionBody,1200)',
  'needs_review:!!analysis.needsReview',
  'Godkendt via mail – afventer ordreoprettelse i Minuba.',
  "mode:'mail_decision_v3_paginated_multi_offer_v16_auto_link'"
]) assert(src.includes(marker),'missing mail-offer guard: '+marker);

assert(!src.includes('fetchMicrosoftasync function fetchMicrosoft'),'duplicate fetchMicrosoft function marker');
assert((src.match(/async function fetchGmail/g)||[]).length===1,'fetchGmail must exist exactly once');
assert((src.match(/async function fetchMicrosoft/g)||[]).length===1,'fetchMicrosoft must exist exactly once');
assert((src.match(/async function loadStoredPendingMessages/g)||[]).length===1,'stored pending loader must exist exactly once');
assert(src.includes('"takke ja" "takker ja"'),'Gmail candidate search does not include clear acceptance language');
assert(src.includes("maxResults:'500'"),'Gmail search must request large pages');
assert(src.includes("pageToken")&&src.includes("nextPageToken"),'Gmail search must follow pagination');
assert(src.includes("pages<20")&&src.includes("ids.length<10000"),'Gmail pagination safety bounds missing');
assert(src.includes(".slice(0,300)"),'Gmail detail processing must be bounded per run');
assert(src.includes("internalDomains.has(domainOf(from))"),'internal sender aliases must be classified as outbound');
assert(src.includes("expandedMessages:any[]"),'multi-offer mail expansion missing');
assert(src.includes("target_ref:ref")&&src.includes("target_count:messageRefs.length"),'multi-offer per-reference targets missing');
assert(src.includes("offer_sync_refs:allOfferRefs"),'processed offer references must be persisted');
assert(src.includes("offer_sync_processed:targetComplete"),'multi-offer mail must only complete after final reference');
assert(src.includes("const key=`${m.provider}:${m.id}`;let existing=existingByKey.get(key)"),'multi-offer mail state must remain mutable after first insert');
assert(src.includes("legacyReinspect=new Set<string>()"),'legacy Gmail backfill reinspection set missing');
assert(src.includes("reinspect_legacy:legacyReinspect.has(id)"),'legacy Gmail backfill marker missing');
assert(src.includes("meta.offer_sync_evidence?.attachments"),'stored mail must recover attachment evidence');
assert(src.includes("offer_sync_processed&&!m.reinspect_legacy"),'legacy processed mail must be reinspectable during backfill');
assert(!src.includes("const automatic=highConfidence&&!matched?.manual_lock&&!analysis.needsReview"),'identity linking must not be blocked by ambiguous status analysis');
assert(src.includes("if(matched&&!statusAutomatic)"),'existing exact/thread offer must link even when status is ambiguous or manually locked');
assert(src.includes("reinspect_legacy:revisitPending"),'pending approvals must be eligible for deterministic backfill reinspection');
assert(src.includes("supplierQuote=!matched&&!min&&supplierQuoteLooksLikely(m)"),'supplier quote filter must run before customer offer creation');
assert(src.includes("supplierRole=/(?:spare\\s+parts?|reservdel(?:ar|e)?|leverandør|supplier|vendor|after\\s+sales|logistics"),'supplier-role detection missing');
function supplierQuoteProbe(subject,body){
  const x=(String(subject||'')+'\n'+String(body||'')).toLowerCase();
  const attachedQuote=/(?:bifogat|vedhæftet|attached)\s+(?:offert|tilbud|quote|quotation)/i.test(x);
  const procurement=/(?:beställning|bestilling|purchase\s+order|ordrebekræftelse|faktura|invoice|reservdel|spare\s+part|leveringstid|delivery\s+time|fragt|freight)/i.test(x);
  const supplierRole=/(?:spare\s+parts?|reservdel(?:ar|e)?|leverandør|supplier|vendor|after\s+sales|logistics(?:\s+coordinator)?)/i.test(x);
  const procurementSubject=/(?:beställning|bestilling|purchase\s+order|offert|quotation)/i.test(String(subject||'').toLowerCase());
  return(attachedQuote&&procurement)||(procurement&&supplierRole)||(procurementSubject&&supplierRole);
}
assert(supplierQuoteProbe('Sv: Re: Beställning: 20142841','Kan vi bruge PDF faktura? Spare Parts Department. Gällande reservdelar.')===true,'Carrier-style supplier thread must be filtered');
assert(supplierQuoteProbe('Re: Tilbud 2981','Kan I sende en revideret pris på tilbuddet?')===false,'ordinary customer offer discussion must not be classified as supplier quote');
assert(src.includes("const supplierThreadKeys=new Set<string>()"),'supplier thread preclassification missing');
assert(src.includes("supplierThreadKeys.add(\`${message.provider}:${message.thread}\`)"),'supplier thread key registration missing');
assert(src.includes("supplierQuoteLooksLikely(m)||supplierThread"),'supplier thread must suppress all messages in the quotation thread');

assert(src.includes("customerMailVerified=!matched&&!!offerRef&&m.direction==='inbound'&&!minubaSystemMail&&candidateCompanyIds.length===1"),'known external customer mail must be able to create an offer independently of Minuba');
assert(src.includes("const minubaSystemMail=domainOf(m.from)==='minuba.dk'"),'Minuba system mail must not masquerade as an external customer reply');
assert(src.includes("proposal.status=min?'I GANG':'STATUS UKLAR'"),'mail-only offers must start safely when Minuba has not matched them');
assert((src.match(/crm_approvals'\)\.update\(\{status:'rejected'/g)||[]).length>=2,'stale and supplier pending approvals must be closed during reconciliation');



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

function quotedExternalProbe(value,internalDomains){
  const lines=String(value||'').split(/\r?\n/);
  const quotePrefix=s=>s.replace(/^\s*>+\s?/,'').trim();
  const quoteHeader=/^(?:den\s+.+\s+skrev\b|on\s+.+\s+wrote\b|fra:|from:)/i;
  const metaHeader=/^(?:sendt|sent|dato|date|til|to|cc|emne|subject):/i;
  const signatureStart=/^(?:med venlig hilsen|venlig hilsen|best regards|kind regards|with best regards)\b/i;
  const emailRe2=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
  const domain=e=>String(e||'').toLowerCase().split('@')[1]||'';
  for(let i=0;i<lines.length;i++){
    const first=quotePrefix(lines[i]);if(!quoteHeader.test(first))continue;
    let header=first,headerEnd=i;
    for(let k=1;k<=3&&headerEnd+1<lines.length&&!header.match(emailRe2);k++){headerEnd++;header+=' '+quotePrefix(lines[headerEnd])}
    const sender=((header.match(emailRe2)||[])[0]||'').toLowerCase();if(!sender||internalDomains.has(domain(sender)))continue;
    let j=headerEnd+1;while(j<lines.length){const t=quotePrefix(lines[j]);if(!t||metaHeader.test(t)){j++;continue}break}
    const body=[];let meaningful=0;
    for(;j<lines.length;j++){const t=quotePrefix(lines[j]);if(quoteHeader.test(t)&&meaningful>0)break;if(signatureStart.test(t)&&meaningful>0)break;if(metaHeader.test(t)&&meaningful>0)break;body.push(t);if(t)meaningful++}
    const text=body.join('\n').replace(/\n{3,}/g,'\n\n').trim();if(text)return{sender,text};
  }
  return null;
}
const quotedCarlZeiss=quotedExternalProbe(`Hej Frank

Jeg undersøger hvornår vi kan presse den ind til service.

Den fre. 11. sep. 2026 kl. 11.16 skrev Nielsen, Frank <
frank.nielsen@zeiss.com>:

> Hej Thomas
>
> Tak for dit tilbud, det vil vi gerne takke ja til.
>
> Kan vi booke en tid til service i den nærmeste fremtid?
>
> Med venlig hilsen
> Frank`,new Set(['klimaeksperten.dk']));
assert(quotedCarlZeiss&&quotedCarlZeiss.sender==='frank.nielsen@zeiss.com','quoted external customer sender must be extracted');
assert(probe(quotedCarlZeiss.text)==='won','Carl Zeiss acceptance inside an internal quoted reply must be won');
assert(src.includes("senderInternal&&!quotedReply&&analysis.decisive"),'internal decisive text must not auto-close without verified customer quote');

for(const marker of [
  "create or replace function public.crm_guard_mail_offer_sync_candidates()",
  "'offer_sync_candidate',true",
  "coalesce(metadata->>'offer_sync_result','') = 'THREAD_LINKED_NO_AUTO_STATUS'",
  "message_at >= now() - interval '45 days'",
  "takke(r)?[[:space:]]+ja"
]) assert(threadCandidates.includes(marker),'missing thread-candidate migration guard: '+marker);
assert(!threadCandidates.includes("'offer_sync_result','THREAD_LINKED_NO_AUTO_STATUS'"),'new trigger must not suppress safely thread-linked customer mail');

for(const marker of [
  "'mail-offer-sync-every-15-minutes'",
  "'8-59/15 * * * *'",
  'mail-offer-sync-runner',
  "name='mail_offer_sync_secret'",
  'timeout_milliseconds := 120000'
]) assert(cron.includes(marker),'missing mail-offer cron guard: '+marker);

console.log('PASS: Mail Decision Engine v2, thread context, quoted customer decisions and acceptance classification');
