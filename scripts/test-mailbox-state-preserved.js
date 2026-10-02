const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function must(text,needle,label){if(!text.includes(needle))throw new Error('Missing '+label+': '+needle)}
function forbid(text,needle,label){if(text.includes(needle))throw new Error('Forbidden '+label+': '+needle)}

const runner=read('supabase/functions/mail-offer-sync-runner/index.ts');
must(runner,'mailbox_state_preserved:true','mail sync mailbox preservation marker');
for(const marker of [
  'markHandledRead',
  'markProviderRead',
  'offer_read_sync',
  'marked_read_at',
  'gmail.modify',
  'Mail.ReadWrite',
  "removeLabelIds:['UNREAD']",
  'isRead:true'
]) forbid(runner,marker,'provider read-state mutation');

const gmailAuth=read('supabase/functions/gmail-direct-auth/index.ts');
must(gmailAuth,"https://www.googleapis.com/auth/gmail.readonly",'Gmail readonly permission');
forbid(gmailAuth,"https://www.googleapis.com/auth/gmail.modify",'Gmail modify permission');
forbid(gmailAuth,'mark_read_scope','Gmail mark-read capability flag');

const gmailCallback=read('supabase/functions/gmail-oauth-callback/index.ts');
must(gmailCallback,"https://www.googleapis.com/auth/gmail.readonly",'Gmail callback readonly scope');
forbid(gmailCallback,"https://www.googleapis.com/auth/gmail.modify",'Gmail callback modify scope');

const microsoft=read('supabase/functions/microsoft-oauth-auth/index.ts');
must(microsoft,"const READ_SCOPE='Mail.Read';",'Microsoft read-only permission');
forbid(microsoft,"Mail.ReadWrite",'Microsoft read/write mailbox permission');

console.log('PASS: mail processing preserves provider read/unread state and uses read-only mailbox scopes');
