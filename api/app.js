const fs = require('fs');
const path = require('path');

let cachedBaseHtml = null;

module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    if (cachedBaseHtml == null) cachedBaseHtml = fs.readFileSync(file, 'utf8');
    let html = cachedBaseHtml;

    // Keep the proven CRM core and generic login shell.
    html = html
      .replace('<title>Lead Manager – Klimaeksperten</title>', '<title>Lead Manager</title>')
      .replace('<div class="sub">Klimaeksperten · Pilot</div>', '<div class="sub">Sikker kundelogin</div>')
      .replace('Log ind med arbejdsmailen. Første gang vælger du et password og bekræfter den mail, Supabase sender til dig.', 'Log ind med din Lead Manager-konto.')
      .replace('<input id="authEmail" value="js@klimaeksperten.dk" readonly>', '<input id="authEmail" type="email" autocomplete="email" placeholder="din@virksomhed.dk">')
      .replace('<button id="signupBtn" class="btn">Opret pilot-login</button>', '<button id="signupBtn" class="btn" type="button" style="display:none" aria-hidden="true" tabindex="-1">Invitation kræves</button>')
      .replace('<div class="brand">Lead Manager<small id="brandClient">Klimaeksperten · Pilot</small></div>', '<div class="brand">Lead Manager<small id="brandClient">Kundekonto</small></div>')
      .replace('<span>Klimaeksperten<small>Lead Manager</small></span>', '<span>Lead Manager<small>Kundekonto</small></span>')
      .replace('Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Lav et mailudkast til Hotel Kirstine', 'Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Hvad er mit næste bedste lead?')
      .replace('Lav et kort no-contact mailudkast med primært mål at finde den rette tekniske/facility/driftsansvarlige. Send ikke uden godkendelse.', 'Lav et kort no-contact mailudkast med primært mål at finde den rette beslutningstager for kundens ydelser og målgruppe. Send ikke uden godkendelse.')
      .replace('Skriv mailen mere som Jesper: ligefrem, menneskelig og uden AI-klicheer.', 'Skriv mailen mere som mig: ligefrem, menneskelig og uden AI-klicheer.')
      .replace('>Mere Jesper</button>', '>Mere som mig</button>')
      .replace("d.textContent='Tone of voice: Jesper · aktiv'", "d.textContent='Din tone of voice · aktiv'");

    // LUKKET is a first-class offer state for offers closed in the source system without a verified win/loss outcome.
    html = html.replaceAll('<option>STATUS UKLAR</option></select>', '<option>STATUS UKLAR</option><option>LUKKET</option></select>');
    html = html.replace("const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','STATUS UKLAR'];", "const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','LUKKET','STATUS UKLAR'];");
    html = html.replace('.status.STATUS-UKLAR{color:#64748b}.status.I-GANG{color:#075985}', '.status.STATUS-UKLAR{color:#64748b}.status.LUKKET{color:#64748b}.status.I-GANG{color:#075985}');

    // Repair the verified malformed legacy startup block before sending HTML.
    const cleanStartupScript = `<script id="lm-startup-autorefresh-v8">
(()=>{
  let hiddenAt=Date.now();
  async function silentRefresh(){
    try{
      if(typeof state==='undefined'||!state?.client||typeof loadAll!=='function') return false;
      await loadAll();
      return true;
    }catch(e){console.warn('visibility refresh failed',e);return false}
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenAt=Date.now();return}
    if(Date.now()-hiddenAt>60000)setTimeout(()=>silentRefresh(),100);
  });
  window.addEventListener('pageshow',e=>{if(e.persisted)setTimeout(()=>silentRefresh(),100)});
})();
</script>`;
    html = html.replace(/<script id="lm-startup-autorefresh-v8">[\s\S]*?<\/script>/, cleanStartupScript);

    // Keep the verified fix for the core self-triggering follow-up observer.
    html = html.replace(
      "new MutationObserver(()=>setTimeout(watchModal,20)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});",
      "/* stable core: global mail-follow-up MutationObserver disabled; click + interval remain */"
    );

    // Performance: replace whole-document observers/pollers with narrow event-driven observers.
    html = html.replace(
      "document.addEventListener('click',()=>setTimeout(watch,30),true);new MutationObserver(watch).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});setInterval(watch,800);setTimeout(watch,800);",
      "document.addEventListener('click',()=>setTimeout(watch,30),true);const lmGhDrawer=document.getElementById('drawer');if(lmGhDrawer)new MutationObserver(watch).observe(lmGhDrawer,{attributes:true,attributeFilter:['class']});setTimeout(watch,400);"
    );
    html = html.replace(
      "new MutationObserver(watch).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});document.addEventListener('click',()=>setTimeout(watch,20),true);setInterval(watch,800);",
      "const lmContactDrawer=document.getElementById('drawer');if(lmContactDrawer)new MutationObserver(watch).observe(lmContactDrawer,{attributes:true,attributeFilter:['class']});document.addEventListener('click',()=>setTimeout(watch,20),true);"
    );
    html = html.replace(
      "document.addEventListener('click',()=>setTimeout(watch,30),true);new MutationObserver(watch).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});setInterval(watch,700);",
      "document.addEventListener('click',()=>setTimeout(watch,30),true);const lmCustomerDrawer=document.getElementById('drawer');if(lmCustomerDrawer)new MutationObserver(watch).observe(lmCustomerDrawer,{attributes:true,attributeFilter:['class']});"
    );
    html = html.replace(
      "new MutationObserver(()=>installQuickStatus()).observe(document.documentElement,{subtree:true,childList:true});",
      "/* performance: quick status is installed by initial load + click events; global DOM observer removed */"
    );
    html = html.replace(
      "new MutationObserver(bind).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});\n  setInterval(()=>{bind();correct()},500);\n  setTimeout(bind,500);",
      "const lmCorrectionModal=document.getElementById('mailModal');if(lmCorrectionModal)new MutationObserver(()=>{bind();correct()}).observe(lmCorrectionModal,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});\n  setTimeout(()=>{bind();correct()},300);"
    );
    html = html.replace(
      "setInterval(renderFocus,2500)",
      "window.addEventListener('lm:data-refreshed',renderFocus)"
    );

    // Add RPC support to the tiny built-in Supabase client used by stable modules.
    html = html.replace(
      "return {auth,from:(table)=>new Query(table)};",
      "const rpc=async(fn,args={})=>{await refreshIfNeeded();const r=await request('/rest/v1/rpc/'+encodeURIComponent(fn),{method:'POST',body:args});return {data:r.data,error:r.error}};return {auth,from:(table)=>new Query(table),rpc};"
    );

    // Logout must be local-first. A slow /logout request must never trap the user in the CRM UI.
    html = html.replace(
      "$('logoutBtn').onclick=()=>supabase.auth.signOut();",
      "$('logoutBtn').onclick=()=>{const old=state.session;localStorage.removeItem('lm_supabase_session_v1');state.session=null;showAuth('Du er logget ud.');try{if(old?.access_token)fetch(SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json',Authorization:'Bearer '+old.access_token},keepalive:true}).catch(()=>{})}catch(_){}setTimeout(()=>location.replace('/?logged_out=1'),0)};"
    );

    // Strip every older SaaS/Microsoft startup layer. Only stable customer modules are allowed.
    html = html.replace(/<script[^>]+src="\/saas-[^"]+"[^>]*><\/script>/g, '');
    html = html.replace('</body>', '<script src="/performance-v1.js?v=20260909-2"></script>\n<script src="/saas-onboarding-v3.js?v=20260901-1"></script>\n<script src="/saas-customer-controls-v1.js?v=20260901-1"></script>\n<script src="/saas-admin-client-switcher-v1.js?v=20260903-1"></script>\n<script src="/saas-lead-intake-v1.js?v=20260901-1"></script>\n<script src="/saas-offer-intake-v1.js?v=20260902-1"></script>\n<script src="/saas-offer-search-controls-v2.js?v=20260902-2"></script>\n<script src="/saas-response-panel-v1.js?v=20260901-1"></script>\n<script src="/saas-feedback-v1.js?v=20260901-1"></script>\n<script src="/saas-regression-center-v1.js?v=20260909-1"></script>\n<script src="/saas-irrelevant-learning-v1.js?v=20260901-1"></script>\n<script src="/saas-microsoft-v1.js?v=20260901-1"></script>\n<script src="/saas-mail-providers-v1.js?v=20260902-1"></script>\n<script src="/saas-mail-sender-name-v1.js?v=20260903-1"></script>\n<script src="/saas-minuba-v1.js?v=20260901-1"></script>\n<script src="/saas-credit-check-v1.js?v=20260902-1"></script>\n<script src="/saas-marketing-leads-v1.js?v=20260903-1"></script>\n<script src="/saas-marketing-connections-v1.js?v=20260903-1"></script>\n<script src="/offer-date-save-v1.js?v=20260909-1"></script>\n<script src="/date-picker-click-v1.js?v=20260909-2"></script>\n<script src="/offer-mail-pdf-v1.js?v=20260909-1"></script>\n</body>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Lead-Manager-Mode', 'stable-core+performance-v1+event-driven-ui+onboarding-v3+customer-controls-v1+admin-client-switcher-v1+lead-intake-v1+offer-search-controls-v2+closed-offer-status+response-panel-v1+feedback-v1+regression-center-v1+irrelevant-learning-v1+microsoft-v1+mail-providers-v1+mail-sender-name-v1+minuba-v1+credit-check-v1+marketing-leads-v1+marketing-connections-v1+offer-date-save-v1+date-picker-click-v2+offer-mail-pdf-v1');
    res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Lead Manager kunne ikke starte.');
  }
};