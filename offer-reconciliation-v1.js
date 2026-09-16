(()=>{
'use strict';
const VERSION='2026-09-16.1';
const LOOKBACK_DAYS=14;
const MIN_INTERVAL_MS=6*60*60*1000;
const START_DELAY_MS=12000;
const key=clientId=>`lm_offer_reconcile_${clientId}`;
function ready(){return typeof state!=='undefined'&&state?.client?.id&&state?.session?.access_token&&typeof supabase!=='undefined'}
function instruction(){return `SYSTEMOPGAVE – TILBUD RECONCILIATION ${VERSION}: Gennemgå relevante indgående og udgående mails fra de seneste ${LOOKBACK_DAYS} dage for dette workspace og find ALLE konkrete tilbudsnumre. Et tilbudsnummer skal vurderes individuelt, også når det optræder i en allerede kendt/gammel mailtråd. Søg i emne, mailtekst og vedhæftningsfilnavne; hvis PDF-indhold allerede er tilgængeligt sikkert, brug også dette. Filnavne som "Tilbud 2924.pdf" og "Tilbud 2925.pdf" er to separate tilbudskandidater. Normaliser tilbudsnumre og dedupliker på workspace/client_id + tilbudsnummer – aldrig kun på thread-id, message-id eller indholdshash. Sammenlign alle fund med crm_offers og Minuba read-only data, når Minuba er tilgængelig. Mangler et sikkert identificeret tilbud i crm_offers, opret det som separat aktivt tilbud med normal opfølgning. Findes det allerede, opret ikke dublet; tilknyt i stedet nye relevante mails til historikken. Hvis en gammel sag senere opdeles/erstattes af nye tilbudsnumre, bevar den gamle historik og relation, men behandl hvert nyt nummer som et selvstændigt tilbud. Ændr ikke det gamle tilbuds status alene fordi nye tilbud findes; statusændring kræver dokumentation. Gem audit-oplysninger om fund, kilde (subject/body/attachment), mail/message/thread, dedupe-resultat, Minuba-kontrol og eventuelle fejl. Ved usikker identifikation: opret kontrolpunkt i stedet for at gætte. Mail-svar skal fortsat ind i dialogloggen. Testcase som SKAL kunne fanges: en tråd med gammelt tilbud 2803-3 får senere en mail med Tilbud 2924.pdf og Tilbud 2925.pdf; resultatet skal være to separate nye tilbud 2924 og 2925 uden dubletter.`}
async function queue(reason='scheduled'){
 if(!ready())return false;
 const clientId=state.client.id;
 const payload={source:'offer_reconciliation',version:VERSION,action:'reconcile_offers_from_mail',lookback_days:LOOKBACK_DAYS,search_subject:true,search_body:true,search_attachment_names:true,search_pdf_content_when_available:true,check_minuba:true,dedupe_key:'client_id+offer_ref',thread_is_not_dedupe_key:true,link_mail_thread:true,create_followup:true,preserve_old_offer_status:true,needs_review_on_uncertainty:true,reason};
 const {error}=await supabase.from('crm_agent_requests').insert({client_id:clientId,request_type:'lead_manager_command',request_text:instruction(),status:'queued',payload,created_by:state.session?.user?.email||'offer_reconciliation'});
 if(error){console.warn('Offer reconciliation queue failed',error);return false}
 localStorage.setItem(key(clientId),String(Date.now()));
 document.dispatchEvent(new CustomEvent('lm:offer-reconciliation-queued',{detail:{client_id:clientId,version:VERSION,reason}}));
 return true;
}
async function maybeQueue(reason='scheduled'){
 if(!ready())return;
 const last=Number(localStorage.getItem(key(state.client.id))||0);
 if(Date.now()-last<MIN_INTERVAL_MS)return;
 await queue(reason);
}
function init(){setTimeout(()=>maybeQueue('startup'),START_DELAY_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>maybeQueue('visibility'),1500)});window.addEventListener('lm:client-switched',()=>setTimeout(()=>maybeQueue('client_switch'),2500));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.LMOfferReconciliation={version:VERSION,run:()=>queue('manual')};
})();
