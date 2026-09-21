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

console.log('PASS: mail composer uses native dialog with native open fallback, native close and standard email fallback');
