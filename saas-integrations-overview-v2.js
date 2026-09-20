(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let lastClient='',busy=false;
const extCrm=new Set(['hubspot','crm_webhook','pipedrive','dynamics365','salesforce']);
const mailProviders=new Set(['gmail','microsoft','imap_smtp']);

function style(){
  if($('#lmIntegrationOverviewStyle'))return;
  const s=document.createElement('style');s.id='lmIntegrationOverviewStyle';
  s.textContent='#lmIntegrationOverview{margin-bottom:14px}.lm-int-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.lm-int-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-top:12px}.lm-int-tile{border:1px solid #e4e9ef;border-radius:12px;padding:11px;background:#fff;text-align:left;cursor:pointer}.lm-int-tile:hover{border-color:#cbd5e1}.lm-int-name{font-weight:800}.lm-int-status{font-size:11px;margin-top:5px}.lm-int-ok{color:#166534}.lm-int-warn{color:#9a6100}.lm-int-bad{color:#b42318}.lm-int-sub{font-size:10px;color:#64748b;margin-top:4px}.lm-int-summary{font-size:12px;color:#64748b;margin-top:4px}@media(max-width:900px){.lm-int-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}';
  document.head.appendChild(s);
}
function host(){
  const p=$('#lmSettingsIntegrationPanel');if(!p)return null;
  let c=$('#lmIntegrationOverview');if(c)return c;
  c=document.createElement('div');c.id='lmIntegrationOverview';c.className='card';
  const head=p.querySelector('.lm-settings-panel-head');if(head?.nextSibling)p.insertBefore(c,head.nextSibling);else p.prepend(c);
  return c;
}
function label(state){return state==='ok'?'✓ Forbundet':state==='bad'?'Fejl / kræver handling':state==='warn'?'Kræver handling':'Ikke forbundet'}
function tile(name,state,sub,target){return '<button type="button" class="lm-int-tile" data-int-target="'+esc(target)+'"><div class="lm-int-name">'+esc(name)+'</div><div class="lm-int-status lm-int-'+state+'">'+label(state)+'</div><div class="lm-int-sub">'+esc(sub||'')+'</div></button>'}
function classify(rows){
  const any=rows.length>0,connected=rows.filter(x=>x.status==='connected'||x.status==='ready').length;
  const broken=rows.filter(x=>x.status==='error'||x.status==='needs_authorization'||x.status==='needs_reconnect'||x.status==='needs_credentials'||x.last_error).length;
  return {state:broken?'bad':connected?'ok':any?'warn':'off',connected,broken,total:rows.length};
}
function render(data){
  const c=host();if(!c)return;
  const {ints=[],marketing=[]}=data;
  const mail=classify(ints.filter(x=>mailProviders.has(x.provider)));
  const minuba=classify(ints.filter(x=>x.provider==='minuba'));
  const crm=classify(ints.filter(x=>extCrm.has(x.provider)));
  const website=classify(marketing.filter(x=>x.platform==='website'));
  const social=classify(marketing.filter(x=>x.platform!=='website'));
  const attention=[mail,minuba,crm,website,social].filter(x=>x.state==='bad'||x.state==='warn').length;
  c.innerHTML='<div class="lm-int-head"><div><h2 style="margin:0 0 4px">Integrationer · overblik</h2><div class="lm-int-summary">'+(attention?attention+' område'+(attention===1?'':'r')+' kræver opmærksomhed':'Alle aktive integrationer ser normale ud')+'</div></div><button class="btn" id="lmIntegrationRefresh">Opdatér status</button></div><div class="lm-int-grid">'+
    tile('Mail',mail.state,mail.connected?mail.connected+' konto'+(mail.connected===1?'':'i'):'Ingen aktiv mail','#lmMailProviderCard')+
    tile('Minuba',minuba.state,minuba.connected?'Automatisk sync aktiv':'Ikke aktiv','#minubaStatus')+
    tile('Website',website.state,website.connected?'Webhook aktiv':'Ingen website-forbindelse','#lmWebsiteIntakeCard')+
    tile('CRM',crm.state,crm.connected?crm.connected+' aktiv forbindelse':'Intet eksternt CRM','#lmCrmIntegrationCard')+
    tile('Marketing',social.state,social.connected?social.connected+' aktiv forbindelse':'Ingen social/marketing-feed','#mkConnectionsCard')+
  '</div>';
  $('#lmIntegrationRefresh').onclick=()=>load(true);
  c.querySelectorAll('[data-int-target]').forEach(b=>b.onclick=()=>{const target=$(b.dataset.intTarget);if(target)target.scrollIntoView({behavior:'smooth',block:'center'})});
}
async function load(force=false){
  if(busy||!state?.client?.id||typeof supabase==='undefined')return;
  const cid=String(state.client.id);if(!force&&cid===lastClient&&$('#lmIntegrationOverview'))return;
  busy=true;lastClient=cid;style();host();
  try{
    const [a,b]=await Promise.all([
      supabase.from('crm_integrations').select('id,provider,account,status,last_sync_at,last_error,updated_at').eq('client_id',cid),
      supabase.from('crm_marketing_connections').select('id,platform,label,status,last_event_at,last_error,updated_at').eq('client_id',cid).neq('status','disabled')
    ]);
    if(a.error)throw a.error;if(b.error)throw b.error;if(String(state?.client?.id)!==cid)return;
    render({ints:a.data||[],marketing:b.data||[]});
  }catch(e){
    const c=host();if(c)c.innerHTML='<div class="lm-int-head"><div><h2 style="margin:0">Integrationer · overblik</h2><div class="lm-int-status lm-int-bad">Status kunne ikke hentes: '+esc(e.message||e)+'</div></div><button class="btn" id="lmIntegrationRefresh">Prøv igen</button></div>';
    const r=$('#lmIntegrationRefresh');if(r)r.onclick=()=>load(true);
  }finally{busy=false}
}
function active(){return !!document.getElementById('leadmanager')?.classList.contains('active')}
function boot(){if(!active())return;if(!state?.client?.id){setTimeout(boot,120);return}load(false)}
document.addEventListener('click',e=>{if(e.target.closest?.('.nav button[data-view="leadmanager"]'))setTimeout(boot,0)},true);
window.addEventListener('lm:client-data-ready',()=>{lastClient='';if(active())setTimeout(boot,0)});
window.addEventListener('lm:client-switched',()=>{lastClient='';if(active())setTimeout(boot,0)});
window.addEventListener('lm:data-refreshed',()=>{if(active())load(true)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.LMIntegrationOverview={refresh:()=>load(true)};
})();