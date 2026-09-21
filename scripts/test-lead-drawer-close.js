const fs=require('fs');
function must(v,m){if(!v)throw new Error(m)}
const html=fs.readFileSync('index.html','utf8');

must(html.includes('<dialog class="drawer lm-native-dialog" id="drawer"'),'lead drawer is not a native dialog');
must(html.includes('<form method="dialog" class="lm-dialog-close-form"><button type="submit" class="btn" id="closeDrawer"'),'lead close button is not native form-dialog close');
must(html.includes("if(!drawer.open)drawer.showModal()"),'openLead does not use showModal');
must(html.includes("drawer.close('close')"),'closeLeadDrawer does not use native dialog close');
must(html.includes("leadDrawer.addEventListener('close'"),'native lead dialog close cleanup missing');
must(html.includes('finalizeLeadDrawerClose'),'lead dialog state finalizer missing');
must(html.includes('dialog.drawer[open]{display:block!important'),'native drawer open CSS missing');
must(!html.includes('id="drawer" popover="manual"'),'legacy drawer popover returned');
must(!html.includes('popovertarget="drawer"'),'legacy drawer popover target returned');

console.log('PASS: lead drawer uses native dialog open/close with browser-native close button');
