const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes('id="mailModal" popover="manual"'),'mail modal is not in native top layer');
must(html.includes('.modalback[popover]:popover-open{display:flex!important'),'mail modal top-layer CSS missing');
must(html.includes("typeof modal.showPopover==='function'"),'mail modal does not use showPopover');
must(html.includes("typeof modal.hidePopover==='function'"),'mail modal does not use hidePopover');
must(html.includes("bestEmailContact(cts)?.email||c.email||''"),'mail composer does not fall back to company standard email');
must(html.includes("Ingen verificeret e-mail fundet endnu"),'missing-email feedback missing');
must(html.includes("$('openMailComposer').onclick=()=>"),'mail composer button handler missing');
must(html.includes("window.dispatchEvent(new CustomEvent(open?'lm:mail-opened':'lm:mail-closed'"),'mail lifecycle events missing');

console.log('PASS: mail composer opens in top layer and uses standard email fallback');
