const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    let html = fs.readFileSync(file, 'utf8');

    // Generic SaaS shell. New customers create login only from a signed onboarding invite.
    html = html
      .replace('<title>Lead Manager – Klimaeksperten</title>', '<title>Lead Manager</title>')
      .replace('<div class="sub">Klimaeksperten · Pilot</div>', '<div class="sub">Sikker kundelogin</div>')
      .replace('Log ind med arbejdsmailen. Første gang vælger du et password og bekræfter den mail, Supabase sender til dig.', 'Log ind med din Lead Manager-konto. Nye kunder opretter login via deres personlige onboarding-link.')
      .replace('<input id="authEmail" value="js@klimaeksperten.dk" readonly>', '<input id="authEmail" type="email" autocomplete="email" placeholder="din@virksomhed.dk">')
      .replace('<button id="signupBtn" class="btn">Opret pilot-login</button>', '<button id="signupBtn" class="btn" type="button" style="display:none" aria-hidden="true" tabindex="-1">Invitation kræves</button>')
      .replace('<div class="brand">Lead Manager<small id="brandClient">Klimaeksperten · Pilot</small></div>', '<div class="brand">Lead Manager<small id="brandClient">Kundekonto</small></div>')
      .replace('<span>Klimaeksperten<small>Lead Manager</small></span>', '<span>Lead Manager<small>Kundekonto</small></span>')
      .replace('Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Lav et mailudkast til Hotel Kirstine', 'Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Hvad er mit næste bedste lead?')
      .replace('Lav et kort no-contact mailudkast med primært mål at finde den rette tekniske/facility/driftsansvarlige. Send ikke uden godkendelse.', 'Lav et kort no-contact mailudkast med primært mål at finde den rette beslutningstager for kundens ydelser og målgruppe. Send ikke uden godkendelse.')
      .replace('Skriv mailen mere som Jesper: ligefrem, menneskelig og uden AI-klicheer.', 'Skriv mailen mere som mig: ligefrem, menneskelig og uden AI-klicheer. Brug kun min kundes toneprofil.')
      .replace('>Mere Jesper</button>', '>Mere som mig</button>')
      .replace("d.textContent='Tone of voice: Jesper · aktiv'", "d.textContent='Din tone of voice · aktiv'")
      .replaceAll('js@klimaeksperten.dk', 'din forbundne mailkonto');

    // Repair a legacy startup script that was stored in index.html with literal escaped
    // newlines/quotes. Browsers parse that as invalid JavaScript and may leave the page
    // in a broken loading state even though the Vercel function itself returns 200.
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

    // The isolated Microsoft setup page can legitimately rotate the Supabase refresh token.
    // If that tab still has the newer valid session, copy it back before the main app boots.
    // This prevents OAuth setup from accidentally logging the user out of Lead Manager.
    const sessionRecovery = `<script id="lm-session-recovery-v1">
(()=>{
  try{
    const raw=sessionStorage.getItem('lm_microsoft_setup_session_v1');
    if(!raw)return;
    const s=JSON.parse(raw);
    if(!s?.access_token||!s?.refresh_token)return;
    localStorage.setItem('lm_supabase_session_v1',JSON.stringify(s));
  }catch(e){console.warn('Lead Manager session recovery skipped',e)}
})();
</script>`;
    if (!html.includes('lm-session-recovery-v1')) {
      html = html.replace('</head>', sessionRecovery + '</head>');
    }

    const injections = [
      '<script src="/saas-onboarding-v2.js?v=20260831-2"></script>',
      '<script src="/saas-microsoft-guard.js?v=20260831-1"></script>',
      '<script src="/saas-ui.js?v=20260831-2"></script>',
      '<script src="/saas-package-guard.js?v=20260831-1"></script>',
      '<script src="/saas-generic-guard.js?v=20260901-1"></script>',
      '<script src="/saas-admin-invite.js?v=20260831-1"></script>'
    ].join('');
    if (!html.includes('/saas-onboarding-v2.js')) {
      html = html.replace('</body>', injections + '</body>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Lead-Manager-SaaS', '2');
    res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Lead Manager kunne ikke starte.');
  }
};
