const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');
const perf=fs.readFileSync('performance-v1.js','utf8');
const app=fs.readFileSync('api/app.js','utf8');
const templates=fs.readFileSync('mail-templates-v1.js','utf8');
const signature=fs.readFileSync('saas-mail-signature-v1.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260921101500_startup_snapshot_company_email.sql','utf8');

must(migration.includes('domain,phone,email,address'),'startup snapshot does not include company email');
must(html.includes("domain,phone,email,address,stoplisted"),'base CRM company query does not include email');
must(perf.includes("domain,phone,email,address,stoplisted"),'performance company query does not include email');
must(html.includes('async function resolveMailRecipientForLead'),'recipient resolver missing');
must(html.includes("supabase.from('crm_companies').select('id,email')"),'direct company email fallback missing');
must(html.includes("bestEmailContact(cts)?.email||c.email||''")||html.includes('resolveMailRecipientForLead'),'mail composer email fallback missing');
must(html.includes('id="mToSource"'),'recipient source UI missing');
must(html.includes('function currentClientMail()'),'dynamic client mail helper missing');
must(html.includes('function gmailAccount(status)'),'dynamic Gmail account resolver missing');
must(html.includes("marker.textContent='Afsender: '+(account||'forbundet Gmail-konto')"),'mail sender UI is not dynamic');
must(html.includes("confirm('Send mailen nu fra '+account+' til '+to+'?')"),'send confirmation does not use connected account');
must(html.includes("toast('Mail sendt fra '+account)"),'send success does not use connected account');
must(!html.includes("marker.textContent='Afsender: js@klimaeksperten.dk · Gmail forbundet'"),'hardcoded Klimaeksperten sender returned');
must(!html.includes("q.textContent='Send fra js@klimaeksperten.dk'"),'hardcoded send button returned');
must(!html.includes("confirm('Send mailen nu fra js@klimaeksperten.dk"),'hardcoded send confirmation returned');

must(html.includes('function clientMailSignatureHtml()'),'HTML signature helper missing');
must(html.includes('function sanitizeSignatureHtml'),'signature sanitizer missing');
must(html.includes("box.innerHTML=sanitizeSignatureHtml(html)"),'HTML signature is not rendered in composer');
must(html.includes('Signatur der sendes med mailen'),'signature preview label missing');
must(html.includes('#mailModal #mSignatureText{max-height:none!important'),'signature preview can still be clipped');
must(signature.includes('/functions/v1/mail-signature-discover'),'dedicated signature discovery endpoint missing');
must(!signature.includes("fetch(`${API}/functions/v1/mail-provider-auth`"),'signature discovery still calls mail-provider-auth');

must(app.includes('/mail-templates-v1.js?v=20260921-2'),'mail templates module is not always loaded');
must(templates.includes("document.createElement('dialog')"),'template manager is not a native dialog');
must(templates.includes("modal.showModal()"),'template manager does not open with showModal');
must(templates.includes('id="mailTemplateManagerCloseForm"'),'template manager native close form missing');
must(templates.includes('Gem skabelon'),'template save action missing');
must(templates.includes("update({is_active:false"),'template safe-deactivation missing');
must(!templates.includes(".delete().eq('id',editingId)"),'hard delete returned to mail templates');
must(!templates.includes(".in('scope',[scope,'both'])"),'unsupported .in() returned to mail templates');

console.log('PASS: recipient email, mail templates and HTML signature are wired end-to-end');
