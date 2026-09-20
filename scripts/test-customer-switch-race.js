const fs=require('fs');
const s=fs.readFileSync('saas-admin-client-switcher-v1.js','utf8');
function assert(v,m){if(!v)throw new Error(m)}
assert(s.includes("if(seq===switchSeq)setSwitching(false)"),'stale switch can unlock UI while a newer switch is running');
assert(s.includes("if(seq===switchSeq&&typeof toast==='function')toast('Kunne ikke skifte kundeprofil. Prøv igen.')"),'stale switch can show an obsolete error toast');
assert(s.includes("if(seq!==switchSeq||String(state?.client?.id)!==id)return"),'stale switch result guard missing');
assert(s.includes("window.__LM_ADMIN_CLIENT_SWITCHER_TEST={resetWorkspaceUi,assertVisibleData,fullLoadForClient,switchClient}"),'switchClient is not exposed to regression harness');
assert(s.includes("if(String(state?.client?.id)!==String(id))throw new Error('Kundeprofil ændrede sig under indlæsning')"),'workspace load identity guard missing');
console.log('PASS: rapid customer switch race guards');
