// Regression tests for review findings. Run from repository root with node.
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const html=read('index.html'),pdf=read('offer-mail-pdf-v1.js');
let scripts=0;const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let match;
while((match=re.exec(html))){scripts++;assert.doesNotThrow(()=>new Function(match[1]),'inline script #'+scripts+' has invalid JS')}
assert.ok(scripts>=10,'expected inline application scripts');
const sync=read('supabase/functions/mail-offer-sync/index.ts');
assert.match(sync,/action==='reject_approval'/);
assert.match(sync,/APPROVAL_TENANT_MISMATCH/);
assert.match(sync,/APPROVAL_ALREADY_CLAIMED/);
assert.match(html,/action:status==='approved'\?'apply_approval':'reject_approval'/);
assert.match(pdf,/FINAL_PRE_SEND_CODES=new Set/);
assert.match(pdf,/if\(status>=500&&status<600&&!FINAL_PRE_SEND_CODES\.has\(code\)\)return;/);
assert.match(pdf,/action:'resume'/);
assert.match(pdf,/En mail til denne kunde er netop sendt/);
const sender=read('supabase/functions/gmail-offer-send/index.ts');
assert.match(sender,/OFFER_CLOSED_IN_MINUBA/);
assert.match(sender,/sendJobCreated=true;/);
assert.match(sender,/OFFER_MAIL_PRE_SEND_ERROR/);
const minuba=read('supabase/functions/minuba-offer-status-sync/index.ts');
assert.match(minuba,/minuba_missing_twice_unverified/);
assert.ok(!minuba.includes("patch.status='LUKKET';patch.follow_up_date=null;patch.status_source='minuba'"),'absence alone must not close offer');
console.log('PASS: audit syntax and safety guards; parsed '+scripts+' inline scripts');
