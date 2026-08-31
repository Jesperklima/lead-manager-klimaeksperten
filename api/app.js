const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    let html = fs.readFileSync(file, 'utf8');

    // Generic SaaS shell. No customer identity is exposed before the
    // authenticated tenant and plan have been resolved client-side.
    html = html
      .replace('<title>Lead Manager – Klimaeksperten</title>', '<title>Lead Manager</title>')
      .replace('<div class="sub">Klimaeksperten · Pilot</div>', '<div class="sub">Sikker kundelogin</div>')
      .replace('Log ind med arbejdsmailen. Første gang vælger du et password og bekræfter den mail, Supabase sender til dig.', 'Log ind med den e-mailadresse, du er inviteret med. Første gang vælger du et password og bekræfter din e-mail.')
      .replace('<input id="authEmail" value="js@klimaeksperten.dk" readonly>', '<input id="authEmail" type="email" autocomplete="email" placeholder="din@virksomhed.dk">')
      .replace('<button id="signupBtn" class="btn">Opret pilot-login</button>', '<button id="signupBtn" class="btn">Opret login fra invitation</button>')
      .replace('<div class="brand">Lead Manager<small id="brandClient">Klimaeksperten · Pilot</small></div>', '<div class="brand">Lead Manager<small id="brandClient">Kundekonto</small></div>')
      .replace('<span>Klimaeksperten<small>Lead Manager</small></span>', '<span>Lead Manager<small>Kundekonto</small></span>')
      .replace('Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Lav et mailudkast til Hotel Kirstine', 'Fx: Hvad skal jeg ringe på i dag? · Flyt mine fleksible opfølgninger fra torsdag til fredag · Hvad er mit næste bedste lead?')
      .replace('Lav et kort no-contact mailudkast med primært mål at finde den rette tekniske/facility/driftsansvarlige. Send ikke uden godkendelse.', 'Lav et kort no-contact mailudkast med primært mål at finde den rette beslutningstager for kundens ydelser og målgruppe. Send ikke uden godkendelse.')
      .replace('Skriv mailen mere som Jesper: ligefrem, menneskelig og uden AI-klicheer.', 'Skriv mailen mere som mig: ligefrem, menneskelig og uden AI-klicheer. Brug kun min kundes toneprofil.')
      .replace('>Mere Jesper</button>', '>Mere som mig</button>')
      .replace("d.textContent='Tone of voice: Jesper · aktiv'", "d.textContent='Din tone of voice · aktiv'");

    const injections = [
      '<script src="/saas-ui.js?v=20260831-2"></script>',
      '<script src="/saas-package-guard.js?v=20260831-1"></script>',
      '<script src="/saas-generic-guard.js?v=20260831-1"></script>'
    ].join('');
    if (!html.includes('/saas-ui.js')) {
      html = html.replace('</body>', injections + '</body>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Lead-Manager-SaaS', '1');
    res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Lead Manager kunne ikke starte.');
  }
};
