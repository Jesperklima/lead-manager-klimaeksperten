const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes('id="drawer" popover="manual"'),'lead drawer is not using native popover');
must(html.includes('popovertarget="drawer"'),'close button does not target native drawer popover');
must(html.includes('popovertargetaction="hide"'),'close button is not using native browser hide action');
must(html.includes("typeof drawer.showPopover==='function'"),'openLead does not open native popover');
must(html.includes("typeof drawer.hidePopover==='function'"),'JS fallback cannot hide native popover');
must(html.includes("leadDrawer.addEventListener('toggle'"),'native popover toggle cleanup missing');
must(html.includes("event.newState==='closed'"),'native close state cleanup missing');
must(html.includes("finalizeLeadDrawerClose"),'drawer state finalizer missing');
must(html.includes(".drawer:popover-open{display:block!important;right:0!important;visibility:visible!important;pointer-events:auto!important;transform:none!important}"),'native popover top-layer style missing');
must(!html.includes('onclick="return closeLeadDrawer(event)"'),'inline JS close fallback should not be required anymore');

console.log('PASS: lead drawer uses native browser popover close with JS only for state cleanup');
