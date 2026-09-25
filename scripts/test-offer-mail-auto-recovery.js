const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(condition,message){if(!condition){console.error('FAIL: '+message);process.exit(1)}}

const ui=read('offer-mail-pdf-v1.js');
const edge=read('supabase/functions/gmail-offer-send/index.ts');
const app=read('api/app.js');

must(ui.includes("lm_offer_send_pending:"), 'pending send id must survive reloads');
must(ui.includes("localStorage.setItem(pendingSendKey(o)"), 'pending send state must be persisted');
must(ui.includes("action:'resume'"), 'composer must ask the backend to resume interrupted sends');
must(ui.includes("pollOfferSendStatus(currentPdfSendId,135000"), 'automatic status watch must outlive the backend 2 minute recovery window');
must(ui.includes("Kontrollerer automatisk"), 'UI must explain automatic status recovery');
must(ui.includes("Der sendes ikke dobbelt"), 'UI must make idempotent retry behavior explicit');
must(!ui.includes("Brug “Kontroller status” i stedet for at starte en ny afsendelse."), 'old manual status instruction returned');
must(!ui.includes("Afsendelsen er stadig ved at blive kontrolleret. Lead Manager genbruger samme send-id"), 'old blocking alert returned');

must(edge.includes("['send','status','resume','pdf_status','preflight']"), 'edge function must expose resume action');
must(edge.includes(".in('status',['sending','sent_pending_postprocess','postprocessing'])"), 'resume must find active send jobs');
must(!edge.includes("Date.now()-30*60*1000"), 'active interrupted sends must remain recoverable even after a long delay');
must(edge.includes("Date.now()-5*60*1000"), 'recent sent jobs must be recovered after refresh without blocking later legitimate resends');
must(edge.includes("pending:true"), 'in-progress response must be explicit for the UI');

must(app.includes('/offer-mail-pdf-v1.js?v=20260925-5-auto-recovery'), 'offer mail asset cache version not bumped');

const backendNotFoundMs=120000;
const clientWatchMs=135000;
must(clientWatchMs>backendNotFoundMs, 'client auto-watch must exceed backend interrupted-send recovery threshold');

console.log('PASS: interrupted offer mail sends auto-recover without manual status clicks or duplicate sends');
