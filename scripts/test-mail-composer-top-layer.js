const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes('<dialog class="modalback lm-native-dialog" id="mailModal">'),'mail composer is not a native dialog');
must(html.includes('id="mailDialogCloseForm"'),'native mail close form missing');
must(html.includes('form="mailDialogCloseForm"'),'mail cancel button is not native dialog close');
must(html.includes('commandfor="mailModal" command="show-modal"'),'mail button lacks native browser show-modal fallback');
must(html.includes("if(!modal.open)modal.showModal()"),'mail composer JS path does not use showModal');
must(html.includes("modal.close('close')"),'mail composer JS close does not use native dialog close');
must(html.includes("nativeMailModal.addEventListener('close'"),'mail dialog cleanup listener missing');
must(html.includes("bestEmailContact(cts)?.email||c.email||''"),'mail composer does not fall back to company standard email');
must(html.includes('function openMailComposerForCurrentLead()'),'mail composer preparation function missing');
must(html.includes('Ingen verificeret e-mail fundet endnu'),'missing-email feedback missing');
must(html.includes('dialog.modalback[open]{display:flex!important'),'mail dialog open CSS missing');
must(!html.includes('id="mailModal" popover="manual"'),'legacy mail popover returned');


const themeIndex=html.indexOf('<link rel="stylesheet" href="/lead-manager-theme-v2.css?v=20260918-1">');
const darkIndex=html.indexOf('id="lm-mail-dialog-dark-v1"');
must(themeIndex>=0&&darkIndex>themeIndex,'mail dark-theme override must load after main theme');

for(const marker of [
  '#mailModal .mail-ai-modal,',
  'background:#0b1f2a!important',
  '#mailModal .mail-ai-head,',
  'background:#0d2430!important',
  '#mailModal input,',
  'background:#203543!important',
  '#mailModal .ai-chat,',
  'background:#102a36!important',
  '#mailModal .ai-chip,',
  'background:#17303c!important',
  '#mailModal .btn.primary,',
  'background:#4de0b0!important'
]) must(html.includes(marker),'mail dark-theme marker missing: '+marker);

for(const forbidden of [
  '.mail-ai-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--border);background:#fff}',
  '.mail-compose-pane{padding:16px 20px 14px;overflow:auto;background:#fff}',
  '.ai-chip{border:1px solid #cddbe1;background:#fff',
  '.ai-chat{flex:1;min-height:180px;overflow:auto;border:1px solid #dbe5e9;border-radius:10px;background:#fff',
  '.ai-prompt-wrap textarea{width:100%;border:1px solid var(--border);border-radius:9px;padding:9px;font:inherit;background:#fff}',
  '.mail-ai-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid var(--border);background:#fff}',
  '#mailModal .mail-ai-footer{flex:0 0 auto!important;position:relative!important;bottom:auto!important;z-index:3!important;padding:10px 18px!important;background:#fff!important}'
]) must(!html.includes(forbidden),'legacy white mail surface returned: '+forbidden.slice(0,80));

console.log('PASS: mail composer uses native dialog, standard email fallback and fully dark mail surfaces');
