const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const dashboardCss = fs.readFileSync('executive-dashboard-v1.css', 'utf8');

function requireCss(fragment, message) {
  if (!dashboardCss.includes(fragment)) throw new Error(message);
}

requireCss('Sidebar flow guard:', 'Sidebar flow guard is missing');
requireCss(
  '.side{display:flex!important;flex-direction:column!important;overflow-y:auto!important;overscroll-behavior:contain!important}',
  'Sidebar must be a vertically scrolling flex container'
);
requireCss(
  '.sidefoot{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;margin-top:auto!important;',
  'Sidebar footer must participate in normal layout flow'
);
requireCss(
  '.sidefoot #userEmail{display:block!important;line-height:1.35!important;overflow-wrap:anywhere!important}',
  'Long account names must wrap inside the sidebar'
);
requireCss(
  '@media(max-width:1000px){.side{box-shadow:none!important;',
  'Compact Executive Dashboard navigation guard is missing'
);
if (!html.includes(
  '@media(max-width:1000px){.app{grid-template-columns:1fr}.side{position:static;height:auto}.sidefoot{display:none}'
)) {
  throw new Error(
  'Compact navigation must hide the desktop footer'
  );
}

for (const [name, pattern] of [
  ['drawer', /\.drawer\{[^}]*height:100%[^}]*overflow:auto/],
  ['modal', /\.modal\{[^}]*max-height:88vh[^}]*overflow:auto/],
  ['mail composer', /#mailModal \.mail-compose-pane\{[^}]*overflow:auto!important/],
]) {
  if (!pattern.test(html)) throw new Error(`${name} overlay is missing its overflow guard`);
}

console.log('PASS: persistent navigation and overlay overflow guards');
