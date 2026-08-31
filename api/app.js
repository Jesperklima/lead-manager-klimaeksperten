const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    let html = fs.readFileSync(file, 'utf8');

    // Generic SaaS login shell. Customer-specific branding is applied only after
    // the authenticated tenant has been resolved.
    html = html
      .replace('<title>Lead Manager – Klimaeksperten</title>', '<title>Lead Manager</title>')
      .replace('<div class="sub">Klimaeksperten · Pilot</div>', '<div class="sub">Sikker kundelogin</div>')
      .replace('Log ind med arbejdsmailen. Første gang vælger du et password og bekræfter den mail, Supabase sender til dig.', 'Log ind med den e-mailadresse, du er inviteret med. Første gang vælger du et password og bekræfter din e-mail.')
      .replace('<input id="authEmail" value="js@klimaeksperten.dk" readonly>', '<input id="authEmail" type="email" autocomplete="email" placeholder="din@virksomhed.dk">')
      .replace('<button id="signupBtn" class="btn">Opret pilot-login</button>', '<button id="signupBtn" class="btn">Opret login fra invitation</button>');

    const injections = [
      '<script src="/saas-ui.js?v=20260831-2"></script>',
      '<script src="/saas-package-guard.js?v=20260831-1"></script>'
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
