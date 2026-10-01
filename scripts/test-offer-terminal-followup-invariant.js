const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(text,needle,label){if(!text.includes(needle))throw new Error('Missing '+label+': '+needle)}
function forbid(text,needle,label){if(text.includes(needle))throw new Error('Forbidden '+label+': '+needle)}

const index=read('index.html');
must(index,"effectiveDate=terminalStatus?null:newDate",'manual close clears offer follow-up date');
must(index,"patch.status_source='manual'",'manual offer status source');
must(index,"patch.manual_lock=true",'manual offer status lock');
must(index,"if(terminalStatus)patch.follow_up_date=null",'pipeline terminal close clears follow-up date');

const sync=read('supabase/functions/minuba-offer-status-sync/index.ts');
must(sync,"const terminalStatuses=new Set(['VUNDET','TABT','LUKKET','LUKKET – UDSKUDT'])",'terminal cleanup status set');
must(sync,"terminalFollowupCleaned++",'terminal cleanup metric');
must(sync,"terminal_followup_cleaned:terminalFollowupCleaned",'terminal cleanup result');
must(sync,"await closeTasks(admin,o,now)",'terminal cleanup closes open follow-up tasks');

const migration=read('supabase/migrations/20261001105000_fix_offer_sync_schedule.sql');
must(migration,"'07:00','07:30','15:00'",'weekday local offer-sync times');
must(migration,"'0,30 5,6,13,14 * * 1-5'",'DST-safe weekday cron window');
must(migration,"timezone('Europe/Copenhagen', now())",'local timezone gate');

forbid(index,"follow_up_date:newDate,current_comment:newComment",'old manual close behavior');

console.log('Offer terminal follow-up invariant guards passed.');
