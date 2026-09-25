const fs = require('fs');
const path = require('path');
let cachedBaseHtml = null;
module.exports = async function handler(req, res) {
  try {
    const file = path.join(process.cwd(), 'index.html');
    if (cachedBaseHtml == null) cachedBaseHtml = fs.readFileSync(file, 'utf8');
    let html = cachedBaseHtml;
    html = html.replace('<title>Lead Manager – Klimaeksperten</title>', '<title>Lead Manager</title>').replace('<span>Klimaeksperten<small>Lead Manager</small></span>', '<span>Lead Manager<small>Kundekonto</small></span>').replace('>Mere Jesper</button>', '>Mere som mig</button>').replace("d.textContent='Tone of voice: Jesper · aktiv'", "d.textContent='Din tone of voice · aktiv'");
    html = html.replaceAll('<option>STATUS UKLAR</option></select>', '<option>STATUS UKLAR</option><option>LUKKET</option></select>');
    html = html.replace("const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','STATUS UKLAR'];", "const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','LUKKET','STATUS UKLAR'];");
    html = html.replace("return {auth,from:(table)=>new Query(table)};","const rpc=async(fn,args={})=>{await refreshIfNeeded();const r=await request('/rest/v1/rpc/'+encodeURIComponent(fn),{method:'POST',body:args});return {data:r.data,error:r.error}};return {auth,from:(table)=>new Query(table),rpc};");
    html = html.replace(new RegExp('<script[^>]+src="/saas-[^"]+"[^>]*><\\/script>','g'), '');
    html = html.replaceAll('ensureGmailSetup();','');
    html = html.replace('</body>', '<script src="/performance-v1.js?v=20260921-6"></script>\n<script src="/tenant-isolation-v1.js?v=20260914-1"></script>\n<script src="/legal-agreement-v1.js?v=20260920-4"></script>\n<script src="/access-bootstrap-v1.js?v=20260922-atomic-2"></script>\n<script src="/saas-customer-controls-v1.js?v=20260922-pool-1"></script>\n<script src="/saas-lead-intake-v1.js?v=20260919-2"></script>\n<script src="/saas-offer-intake-v1.js?v=20260919-2"></script>\n<script src="/saas-response-panel-v1.js?v=20260901-1"></script>\n<script src="/saas-irrelevant-learning-v1.js?v=20260919-2"></script>\n<script src="/saas-mail-signature-v1.js?v=20260919-2"></script>\n<script src="/mail-templates-v1.js?v=20260925-1-contact-name"></script>\n<script src="/offer-date-save-v1.js?v=20260925-1"></script>\n<script src="/offer-mail-pdf-v1.js?v=20260925-5-auto-recovery"></script>\n<script src="/offer-reconciliation-v1.js?v=20260916-1"></script>\n<script src="/mail-sales-signal-v1.js?v=20260916-1"></script>\n<script src="/source-transparency-v1.js?v=20260917-1"></script>\n<script src="/activity-report-core-v2.js?v=20260923-1"></script>\n<script src="/activity-report-v2.js?v=20260923-1"></script>\n</body>');
    const freshVersion = String((req.query && req.query.fresh) || '20260922-atomic-2').replace(/[^0-9A-Za-z_-]/g,'').slice(0,40) || '20260922-atomic-2';
    html = html.replace('/access-bootstrap-v1.js?v=20260922-atomic-2','/access-bootstrap-v1.js?v='+freshVersion);
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('X-Lead-Manager-Mode','platform-admin-system-mail-oauth-v4');res.status(200).send(html);
  } catch (error) { console.error(error); res.status(500).send('Lead Manager kunne ikke starte.'); }
};
