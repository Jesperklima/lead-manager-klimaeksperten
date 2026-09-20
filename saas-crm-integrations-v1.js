(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
let busy=false,lastClient='',lastStatus=null,setupSecret=null;

async function session(){const {data}=await supabase.auth.getSession();return data?.session||null}
async function edge(payload){
  const s=await session();if(!s?.access_token)throw new Error('Login-session mangler');
  const r=await fetch(API+'/functions/v1/external-crm-sync',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify({...payload,client_id:state?.client?.id||null})});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}
  if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;
}
function canManage(){return ['workspace_owner','workspace_admin'].includes(window.LM_ACCESS?.role)||window.LM_ACCESS?.platform_admin===true}
function fmt(v){if(!v)return'—';try{return new Date(v).toLocaleString('da-DK')}catch{return String(v)}}
function providerName(p){return p==='hubspot'?'HubSpot':p==='crm_webhook'?'Andet CRM / webhook':p}
function statusPill(s){return s==='connected'?'<span class=\"pill\" style=\"background:#dcfce7;color:#166534\">✓ Forbundet</span>':s==='error'?'<span class=\"pill\" style=\"background:#fee2e2;color:#991b1b\">Fejl</span>':'<span class=\"pill\">'+esc(s||'Ikke forbundet')+'</span>'}

function style(){
  if($('#lmCrmIntegrationStyle'))return;
  const s=document.createElement('style');s.id='lmCrmIntegrationStyle';s.textContent=`
    #lmCrmIntegrationCard{margin-top:12px}
    .lm-crm-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
    .lm-crm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15px}
    .lm-crm-box{border:1px solid #e4e9ef;border-radius:14px;padding:15px;background:#fbfcfe}
    .lm-crm-box h3{margin:0 0 5px;font-size:15px}
    .lm-crm-box .field{margin-top:11px}
    .lm-crm-box label{display:block;font-weight:750;color:#475569;margin-bottom:5px}
    .lm-crm-box input,.lm-crm-box select{width:100%;box-sizing:border-box;min-height:42px}
    .lm-crm-connections{display:grid;gap:9px;margin-top:13px}
    .lm-crm-connection{border:1px solid #e4e9ef;border-radius:13px;padding:13px;background:#fff}
    .lm-crm-row{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .lm-crm-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
    .lm-crm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:12px}
    .lm-crm-stat{background:#f8fafc;border:1px solid #e7ebf1;border-radius:10px;padding:9px;text-align:center}
    .lm-crm-stat strong{display:block;font-size:17px}.lm-crm-stat span{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .lm-crm-secret{margin-top:12px;padding:13px;border-radius:12px;border:1px solid #f0c36d;background:#fff9e9}
    .lm-crm-secret code{display:block;white-space:pre-wrap;word-break:break-all;font-size:11px;margin:6px 0}
    .lm-crm-message{min-height:18px;margin-top:9px;font-size:12px;color:#475569}
    .lm-crm-message.bad{color:#b42318}
    @media(max-width:760px){.lm-crm-grid{grid-template-columns:1fr}.lm-crm-stats{grid-template-columns:repeat(2,1fr)}}
  `;document.head.appendChild(s);
}
function card(){
  const panel=$('#lmSettingsIntegrationPanel');if(!panel)return null;
  let c=$('#lmCrmIntegrationCard');if(c)return c;
  c=document.createElement('div');c.id='lmCrmIntegrationCard';c.className='card';
  c.innerHTML=`
    <div class=\"lm-crm-head\"><div><h2 style=\"margin:0 0 4px\">CRM-forbindelse</h2><div class=\"sub\">Synkronisér virksomheder, kontakter og leads med jeres eget CRM. Lead Manager holder styr på mapping og konflikter pr. workspace.</div></div><div id=\"lmCrmTopStatus\" class=\"pill\">Kontrollerer…</div></div>
    <div id=\"lmCrmStats\"></div>
    <div id=\"lmCrmConnections\" class=\"lm-crm-connections\"></div>
    <div class=\"lm-crm-grid\">
      <div class=\"lm-crm-box\">
        <h3>HubSpot</h3>
        <div class=\"sub\">Brug et HubSpot access token med læse-/skriveadgang til Companies, Contacts og Deals. Pipeline og standard-stage findes automatisk.</div>
        <div class=\"field\"><label>HubSpot access token</label><input id=\"lmCrmHubToken\" type=\"password\" autocomplete=\"new-password\" placeholder=\"pat-… eller service key\"></div>
        <button id=\"lmCrmHubConnect\" type=\"button\" class=\"btn primary\" style=\"margin-top:10px\">Forbind HubSpot</button>
      </div>
      <div class=\"lm-crm-box\">
        <h3>Andet CRM via webhook/API</h3>
        <div class=\"sub\">Lead Manager sender ændringer som JSON til jeres HTTPS-endpoint og kan modtage ændringer retur via en sikker inbound webhook.</div>
        <div class=\"field\"><label>Outbound HTTPS endpoint</label><input id=\"lmCrmWebhookUrl\" type=\"url\" placeholder=\"https://crm.example.dk/lead-manager\"></div>
        <div class=\"field\"><label>Bearer token (valgfrit)</label><input id=\"lmCrmWebhookToken\" type=\"password\" autocomplete=\"new-password\" placeholder=\"Token sendes som Authorization: Bearer\"></div>
        <button id=\"lmCrmWebhookConnect\" type=\"button\" class=\"btn primary\" style=\"margin-top:10px\">Forbind webhook CRM</button>
      </div>
    </div>
    <div id=\"lmCrmSetupSecret\"></div>
    <div id=\"lmCrmMessage\" class=\"lm-crm-message\"></div>`;
  panel.appendChild(c);
  $('#lmCrmHubConnect').onclick=connectHubSpot;$('#lmCrmWebhookConnect').onclick=connectWebhook;
  c.addEventListener('click',handleAction);return c;
}
function msg(t,bad=false){const e=$('#lmCrmMessage');if(e){e.textContent=t||'';e.classList.toggle('bad',!!bad)}}
function setBusy(v){busy=!!v;['#lmCrmHubConnect','#lmCrmWebhookConnect'].forEach(s=>{const e=$(s);if(e)e.disabled=busy})}
async function copyText(v){try{await navigator.clipboard.writeText(v);if(typeof toast==='function')toast('Kopieret')}catch{msg('Kunne ikke kopiere automatisk.',true)}}
function renderSetup(){
  const host=$('#lmCrmSetupSecret');if(!host)return;
  if(!setupSecret){host.innerHTML='';return}
  host.innerHTML=`<div class=\"lm-crm-secret\"><strong>Gem disse oplysninger nu</strong><div class=\"sub\">Inbound-secret vises kun i denne opsætning. Brug den i jeres CRM, når det sender ændringer tilbage til Lead Manager.</div><div class=\"sub\" style=\"margin-top:7px\">Inbound URL</div><code>${esc(setupSecret.url)}</code><button type=\"button\" class=\"btn\" data-crm-copy=\"url\">Kopiér URL</button><div class=\"sub\" style=\"margin-top:9px\">Inbound secret</div><code>${esc(setupSecret.secret)}</code><button type=\"button\" class=\"btn\" data-crm-copy=\"secret\">Kopiér secret</button></div>`;
}
function render(d){
  lastStatus=d;const con=d?.connections||[],q=d?.queue||{};
  const top=$('#lmCrmTopStatus');if(top){const ok=con.some(x=>x.status==='connected');top.textContent=ok?'✓ CRM aktiv':'Ikke forbundet';top.style.background=ok?'#dcfce7':'';top.style.color=ok?'#166534':''}
  const stats=$('#lmCrmStats');if(stats)stats.innerHTML=`<div class=\"lm-crm-stats\"><div class=\"lm-crm-stat\"><strong>${Number(d?.links||0)}</strong><span>Mappinger</span></div><div class=\"lm-crm-stat\"><strong>${Number(q.queued||0)}</strong><span>I kø</span></div><div class=\"lm-crm-stat\"><strong>${Number(q.error||0)}</strong><span>Fejl</span></div><div class=\"lm-crm-stat\"><strong>${esc(fmt(d?.last_event))}</strong><span>Seneste event</span></div></div>`;
  const host=$('#lmCrmConnections');if(host)host.innerHTML=con.length?con.map(x=>`<div class=\"lm-crm-connection\" data-crm-id=\"${esc(x.id)}\"><div class=\"lm-crm-row\"><div><strong>${esc(providerName(x.provider))}</strong><div class=\"sub\">${esc(x.account||'')}</div></div>${statusPill(x.status)}</div><div class=\"sub\" style=\"margin-top:7px\">Seneste sync: ${esc(fmt(x.last_sync_at))}${x.last_error?' · Fejl: '+esc(x.last_error):''}</div>${canManage()?`<div class=\"lm-crm-actions\"><button type=\"button\" class=\"btn\" data-crm-action=\"test\">Test</button><button type=\"button\" class=\"btn\" data-crm-action=\"resync\">Synkronisér alt igen</button><button type=\"button\" class=\"btn\" data-crm-action=\"disconnect\">Frakobl</button></div>`:''}</div>`).join(''):'<div class=\"lm-settings-note\">Der er endnu ikke forbundet et eksternt CRM.</div>';
  if(!canManage()){['#lmCrmHubToken','#lmCrmWebhookUrl','#lmCrmWebhookToken','#lmCrmHubConnect','#lmCrmWebhookConnect'].forEach(s=>{const e=$(s);if(e)e.disabled=true})}
  renderSetup();
}
async function refresh(){
  if(!state?.client)return;const id=String(state.client.id);lastClient=id;card();
  try{const d=await edge({action:'status'});if(String(state?.client?.id)!==id)return;render(d);msg('')}
  catch(e){if(String(state?.client?.id)!==id)return;msg('CRM-status kunne ikke hentes: '+(e.message||e),true)}
}
async function connectHubSpot(){
  if(busy||!canManage())return;const token=$('#lmCrmHubToken')?.value?.trim();if(!token){msg('Indsæt HubSpot access token.',true);return}
  setBusy(true);msg('Tester HubSpot og opretter sikker forbindelse…');
  try{const d=await edge({action:'connect_hubspot',token});$('#lmCrmHubToken').value='';setupSecret=null;msg(`HubSpot er forbundet. ${Number(d.queued||0)} poster er lagt i første sync-kø.`);if(typeof toast==='function')toast('HubSpot forbundet');await refresh()}
  catch(e){msg('HubSpot kunne ikke forbindes: '+(e.message||e),true)}
  finally{setBusy(false)}
}
async function connectWebhook(){
  if(busy||!canManage())return;const endpoint=$('#lmCrmWebhookUrl')?.value?.trim(),bearer=$('#lmCrmWebhookToken')?.value?.trim()||'';
  if(!endpoint){msg('Indsæt CRM webhook URL.',true);return}
  setBusy(true);msg('Tester endpoint og opretter sikre webhook-nøgler…');
  try{
    const d=await edge({action:'connect_webhook',endpoint_url:endpoint,bearer_token:bearer});
    $('#lmCrmWebhookToken').value='';setupSecret={url:d.inbound_url,secret:d.inbound_secret};renderSetup();
    msg(`Webhook CRM er forbundet. ${Number(d.queued||0)} poster er lagt i første sync-kø.`);if(typeof toast==='function')toast('CRM webhook forbundet');await refresh()
  }catch(e){msg('Webhook CRM kunne ikke forbindes: '+(e.message||e),true)}
  finally{setBusy(false)}
}
async function handleAction(e){
  const copy=e.target.closest?.('[data-crm-copy]');if(copy&&setupSecret){await copyText(copy.dataset.crmCopy==='url'?setupSecret.url:setupSecret.secret);return}
  const b=e.target.closest?.('[data-crm-action]');if(!b||busy)return;const row=b.closest('[data-crm-id]'),id=row?.dataset.crmId;if(!id)return;
  const action=b.dataset.crmAction;
  if(action==='disconnect'&&!confirm('Frakobl dette CRM? Mapping og ventende sync-kø fjernes, men CRM-data slettes ikke.'))return;
  busy=true;b.disabled=true;msg(action==='resync'?'Lægger alle poster i sync-kø…':action==='test'?'Tester CRM-forbindelsen…':'Frakobler CRM…');
  try{
    if(action==='test'){await edge({action:'test',integration_id:id});msg('✓ CRM-forbindelsen svarer korrekt.')}
    if(action==='resync'){const d=await edge({action:'resync',integration_id:id});msg(`Fuld resync startet: ${Number(d.queued||0)} poster lagt i kø.`)}
    if(action==='disconnect'){await edge({action:'disconnect',integration_id:id});setupSecret=null;msg('CRM er frakoblet.')}
    await refresh();
  }catch(err){msg('CRM-handlingen fejlede: '+(err.message||err),true)}
  finally{busy=false;b.disabled=false}
}
function active(){return !!document.getElementById('leadmanager')?.classList.contains('active')}
function boot(){
  style();if(!active())return;
  if(!state?.client){setTimeout(boot,150);return}
  const id=String(state.client.id);card();if(id!==lastClient||!lastStatus)refresh();
}
function schedule(){setTimeout(boot,0)}
document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view=\"leadmanager\"]'))setTimeout(boot,0)},true);
window.addEventListener('lm:client-data-ready',()=>{lastStatus=null;lastClient='';schedule()});
window.addEventListener('lm:data-refreshed',()=>{if(active())schedule()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.LMExternalCRM={refresh};
})();