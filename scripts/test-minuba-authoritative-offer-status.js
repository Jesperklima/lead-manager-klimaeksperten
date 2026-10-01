const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(text,needle,label){if(!text.includes(needle))throw new Error('Missing '+label+': '+needle)}
function forbid(text,needle,label){if(text.includes(needle))throw new Error('Forbidden '+label+': '+needle)}
function before(text,a,b,label){const ia=text.indexOf(a),ib=text.indexOf(b,Math.max(0,ia));if(ia<0||ib<0||ia>=ib)throw new Error('Ordering failed '+label)}

const sync=read('supabase/functions/minuba-offer-status-sync/index.ts');
must(sync,'function terminalProposalDisposition','terminal Minuba proposal classifier');
must(sync,"if(prev!=='VUNDET'){patch.status='VUNDET';patch.follow_up_date=null",'order always closes follow-up');
forbid(sync,"if(!o.manual_lock&&prev!=='VUNDET')",'manual lock blocking Minuba order');
must(sync,"patch.status='LUKKET';patch.follow_up_date=null;patch.status_source='minuba'",'missing twice forces closed status');
forbid(sync,"if(!o.manual_lock){patch.status='LUKKET'",'manual lock blocking Minuba closure');
must(sync,'manual_lock_overridden:!!o.manual_lock','audit terminal manual-lock override');
must(sync,'manual_terminal_overrides:manualOverrides','terminal override metric');
must(sync,">=10*60*1000",'second safe status check threshold');
before(sync,'terminal=terminalProposalDisposition(proposal)',"minuba_sync_state:'active'",'terminal proposal is classified before active state');

const lookup=read('supabase/functions/minuba-offer-lookup/index.ts');
must(lookup,'function crmStatus(recordType:string,status:string,record:any=null)','lookup uses raw Minuba record flags');
must(lookup,"active:recordType==='proposal'&&mappedStatus==='I GANG'",'lookup active flag');
must(lookup,"terminal:['VUNDET','TABT','LUKKET'].includes", 'lookup terminal flag');
must(lookup,"return resp({found:false,active:false,terminal:false", 'not-found is explicitly inactive');
before(lookup,"if(recordType==='order')return 'VUNDET';","if(rejected)return 'TABT';",'real order remains won even when closed later');

const mail=read('offer-mail-v1.js');
must(mail,'async function verifyMinubaStillActiveForFollowUp','pre-send Minuba verifier');
must(mail,'OPFØLGNING BLOKERET – MINUBA-STATUS','terminal follow-up blocker');
must(mail,'OPFØLGNING BLOKERET – STATUS IKKE VERIFICERET','fail-closed lookup blocker');
const gate=mail.indexOf('const gate=await verifyMinubaStillActiveForFollowUp(o);');
const send=mail.indexOf("callProtectedEdge('gmail-direct-send'",gate);
if(gate<0||send<0||gate>=send)throw new Error('Minuba verifier must run before Gmail send');

console.log('Minuba authoritative offer-status guards passed.');
