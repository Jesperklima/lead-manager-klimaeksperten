(()=>{
'use strict';
const VERSION='2026-09-16.1';
const LOOKBACK_DAYS=14;
const MIN_INTERVAL_MS=6*60*60*1000;
const START_DELAY_MS=16000;
const key=clientId=>`lm_mail_sales_signal_${clientId}`;
function ready(){return typeof state!=='undefined'&&state?.client?.id&&state?.session?.access_token&&typeof supabase!=='undefined'}
function instruction(){return `SYSTEMOPGAVE – MAIL SALGSSIGNAL SCANNER ${VERSION}: Analyser relevante indgående og udgående mails fra de seneste ${LOOKBACK_DAYS} dage for DET AKTUELLE WORKSPACE. Arbejd strengt tenant-isoleret: brug kun mail, CRM-data, integrationer og handlinger der tilhører det aktuelle client_id. Formålet er at opdage salgssignaler og omsætte dem til sikre CRM-handlinger uden at brugeren selv skal huske dem.

KLASSIFICER mindst disse signaler: (1) pris-/tilbudsforespørgsel: fx "kan I sende en pris", "send et tilbud", "hvad koster det"; (2) konkret callback/opfølgning: fx "ring i næste uge", "kontakt mig fredag", "vend tilbage om en måned"; (3) kort afventning: fx "afventer godkendelse", "hører fra os snart"; (4) lang udsættelse: fx "efter sommerferien", "næste år", "til foråret"; (5) ændrings-/revisionsønske: fx "send et revideret tilbud", "kan I ændre tilbuddet"; (6) positiv købsintention/accept: fx "vi går videre", "ordren er jeres", "godkendt"; (7) tab/afslag: fx "vi har valgt en anden", "ikke aktuelt", "tilbuddet afslås"; (8) ny potentiel kunde/leadhenvendelse; (9) svar på tidligere udsendt CRM-mail, som skal kobles til eksisterende dialog; (10) intern instruktion om ingen opfølgning eller at en medarbejder selv tager sagen.

HANDLINGER: Kobl signalet til eksisterende lead/kunde/tilbud når match er sikkert. Gem mail/svar i kronologisk dialoghistorik. Opret eller opdater opfølgningsdato når dato/tidsrum er sikkert udledt. Ved pris-/tilbudsforespørgsel eller ny salgsmulighed: opret IKKE blindt et eksternt fund som nyt lead; følg workspace-reglerne for review/godkendelse, med hvad der blev fundet og hvorfor. Ved sikker accept/tab kan relevant status foreslås/opdateres efter eksisterende status- og auditregler. Lang udsættelse følger eksisterende mail intelligence-regler og må kun auto-lukkes ved høj sikkerhed. Revisionsønske skal skabe en tydelig handling på det eksisterende tilbud/sag frem for en dublet.

INGEN-OPFØLGNING HAR HØJEST PRIORITET: Hvis en autoriseret intern bruger entydigt skriver fx "du skal ikke følge op", "ingen opfølgning", "lad den ligge", "jeg tager den selv", "opret den ikke" eller tilsvarende om en konkret sag, må scanneren ikke skabe lead/tilbud/opfølgning for den sag. Persistér beslutningen med client_id, relevant lead/offer reference, årsag, afsender, message/thread-id og tidspunkt. Ved tvivl: manuel kontrol, ingen automatisk handling. En senere eksplicit genoptagelse kan ophæve suppression og skal auditeres.

SIKKERHED: Dedupliker CRM-objekter på workspace/client_id + relevant stabil reference, ikke alene message/thread-id. Samme mailaktivitet må ikke logges dobbelt. Krydstjek Minuba read-only når workspace har Minuba tilsluttet og det er relevant for identifikation/status. Gæt aldrig på kunde, tilbud, status eller dato ved modstridende/uklare signaler; opret review. Log klassifikation, confidence, kilde, match, foreslået/udført handling og fejl til audit. Ingen handling må påvirke andre workspaces.

MÅLET er, at mailintegrationen fungerer som aktiv salgshukommelse: relevante mails bliver ikke bare gemt, men bliver til korrekt historik, opfølgning, status eller review.`}
async function queue(reason='scheduled'){
 if(!ready())return false;
 const clientId=state.client.id;
 const payload={source:'mail_sales_signal',version:VERSION,action:'scan_mail_sales_signals',lookback_days:LOOKBACK_DAYS,workspace_isolated:true,scan_inbound:true,scan_outbound:true,link_dialogue:true,detect_offer_request:true,detect_callback:true,detect_short_wait:true,detect_long_postpone:true,detect_revision_request:true,detect_acceptance:true,detect_rejection:true,detect_new_lead:true,detect_internal_no_followup:true,no_followup_precedence:true,persist_suppression:true,check_minuba_when_available:true,needs_review_on_uncertainty:true,avoid_duplicate_activity:true,reason};
 const {error}=await supabase.from('crm_agent_requests').insert({client_id:clientId,request_type:'lead_manager_command',request_text:instruction(),status:'queued',payload,created_by:state.session?.user?.email||'mail_sales_signal'});
 if(error){console.warn('Mail sales signal queue failed',error);return false}
 localStorage.setItem(key(clientId),String(Date.now()));
 document.dispatchEvent(new CustomEvent('lm:mail-sales-signal-queued',{detail:{client_id:clientId,version:VERSION,reason}}));
 return true;
}
async function maybeQueue(reason='scheduled'){
 if(!ready())return;
 const last=Number(localStorage.getItem(key(state.client.id))||0);
 if(Date.now()-last<MIN_INTERVAL_MS)return;
 await queue(reason);
}
function init(){setTimeout(()=>maybeQueue('startup'),START_DELAY_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>maybeQueue('visibility'),2200)});window.addEventListener('lm:client-switched',()=>setTimeout(()=>maybeQueue('client_switch'),3200));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.LMMailSalesSignal={version:VERSION,run:()=>queue('manual')};
})();
