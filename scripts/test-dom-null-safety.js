const fs=require('fs');

function read(path){return fs.readFileSync(path,'utf8')}
function assert(cond,msg){if(!cond)throw new Error(msg)}

const index=read('index.html');
assert(index.includes("function setText(id,value)"),'core setText helper missing');
assert(index.includes("setText('authMessage','Logger ind…')"),'login still writes auth message unsafely');
assert(index.includes("$('loading')?.classList.remove('hidden')"),'startup loading element is not guarded');
assert(!index.includes("$('authMessage').textContent='Logger ind…'"),'unsafe login authMessage write returned');

const mail=read('saas-mail-providers-v1.js');
assert(mail.includes("function setText(selector,value)"),'mail provider safe text helper missing');
assert(mail.includes("String(state?.client?.id||'')!==clientId"),'mail provider stale-client guard missing');
assert(mail.includes("if(!status)return;"),'mail provider status node guard missing');
assert(mail.includes("if(b?.isConnected)b.disabled=false"),'mail provider detached-button guard missing');
assert(!mail.includes("$('#lmMailProviderStatus').textContent='Kontrollerer…'"),'unsafe mail status write returned');

const sender=read('saas-mail-sender-name-v1.js');
assert(sender.includes("if(!preview||!input.isConnected)return"),'sender preview rerender guard missing');

const executive=read('executive-dashboard-v1.js');
assert(executive.includes("function setNodeText(id,value)"),'executive safe text helper missing');
assert(executive.includes("setNodeText('executivePeriodTitle',label[0])"),'executive period title is not guarded');
assert(executive.includes("setNodeText('executivePeriodText',label[1])"),'executive period text is not guarded');

console.log('PASS: DOM null/rerender race guards');
