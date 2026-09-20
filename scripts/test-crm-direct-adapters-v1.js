const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function must(v,m){if(!v)throw new Error(m)}
const edge=read('supabase/functions/external-crm-sync/index.ts');
const ui=read('saas-crm-integrations-v1.js');
const boot=read('access-bootstrap-v1.js');

for(const marker of [
  "'pipedrive','dynamics365','salesforce'",
  'async function syncPipedrive',
  'async function pullPipedrive',
  "action==='connect_pipedrive'",
  'async function syncDynamics',
  'async function pullDynamics',
  "action==='connect_dynamics365'",
  'async function syncSalesforce',
  'async function pullSalesforce',
  "action==='connect_salesforce'",
  "integration.provider==='pipedrive'",
  "integration.provider==='dynamics365'",
  "integration.provider==='salesforce'",
  "saveSecret(admin,integration.id,{api_token:token})",
  "saveSecret(admin,integration.id,{client_secret:clientSecret})",
  'dynTokenCache',
  'sfTokenCache'
]) must(edge.includes(marker),'missing direct CRM edge marker: '+marker);

for(const marker of [
  'Pipedrive API-token',
  'Microsoft Dynamics 365',
  'Salesforce',
  "action:'connect_pipedrive'",
  "action:'connect_dynamics365'",
  "action:'connect_salesforce'",
  'type=\"password\"',
  'lmCrmPipeConnect',
  'lmCrmDynConnect',
  'lmCrmSfConnect'
]) must(ui.includes(marker),'missing direct CRM UI marker: '+marker);

must(edge.includes(".in('provider',['crm_webhook','hubspot','pipedrive','dynamics365','salesforce'])"),'status does not return all CRM providers');
must(edge.includes(".in('provider',['hubspot','pipedrive','dynamics365','salesforce'])"),'poll worker does not include all direct providers');
must(boot.includes('/saas-crm-integrations-v1.js?v=20260920-8'),'CRM UI cache version not bumped');
must(!/config:\{[^}]*client_secret/.test(edge),'client secret appears to be stored in integration config');
console.log('PASS: Pipedrive, Dynamics 365 and Salesforce direct adapter guards');
