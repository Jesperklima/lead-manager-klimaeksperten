const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    let html = fs.readFileSync(file, 'utf8');

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

    // Logout must be local-first. A slow /logout request must never trap the user in the CRM UI.
    html = html.replace(
      "$('logoutBtn').onclick=()=>supabase.auth.signOut();",
      "$('logoutBtn').onclick=()=>{const old=state.session;localStorage.removeItem('lm_supabase_session_v1');state.session=null;showAuth('Du er logget ud.');try{if(old?.access_token)fetch(SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json',Authorization:'Bearer '+old.access_token},keepalive:true}).catch(()=>{})}catch(_){}setTimeout(()=>location.replace('/?logged_out=1'),0)};"
    );

    // Strip every older SaaS/Microsoft startup layer. Only stable customer modules are allowed.
    html = html.replace(/<script[^>]+src="\/saas-[^"]+"[^>]*><\/script>/g, '');
    html = html.replace('</body>', '<script src="/saas-onboarding-v3.js?v=20260901-1"></script>\n<script src="/saas-customer-controls-v1.js?v=20260901-1"></script>\n<script src="/saas-lead-intake-v1.js?v=20260901-1"></script>\n<script src="/saas-response-panel-v1.js?v=20260901-1"></script>\n<script src="/saas-feedback-v1.js?v=20260901-1"></script>\n<script src="/saas-irrelevant-learning-v1.js?v=20260901-1"></script>\n<script src="/saas-microsoft-v1.js?v=20260901-1"></script>\n</body>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Lead-Manager-Mode', 'stable-core+onboarding-v3+customer-controls-v1+lead-intake-v1+response-panel-v1+feedback-v1+irrelevant-learning-v1+microsoft-v1');
    res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Lead Manager kunne ikke starte.');
  }
};