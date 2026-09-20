(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let loading=false,last=null;
function fmt(v){if(!v)return'—';try{return new Intl.DateTimeFormat('da-DK',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return String(v)}}
function age(v){if(!v)return'—';const ms=Date.now()-new Date(v).getTime(),h=Math.max(0,Math.round(ms/3600000));if(h<24)return h+' t';return Math.round(h/24)+' d'}
function ensureStyle(){
 if($('#lmOpsV2Style'))return;
 const s=document.createElement('style');s.id='lmOpsV2Style';s.textContent=`
 #lmOpsV2{grid-column:1/-1;background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px}
 .lmops-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
 .lmops-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:13px}
 .lmops-metric{border:1px solid var(--border);border-radius:11px;padding:10px;background:#f8fafc}
 .lmops-metric strong{display:block;font-size:20px}.lmops-metric span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
 .lmops-table{margin-top:14px;display:grid;gap:7px}
 .lmops-row{display:grid;grid-template-columns:minmax(150px,1.4fr) 90px 100px 100px 105px 90px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:9px 10px;background:#fff;font-size:11px}
 .lmops-row.head{border:0;background:#f8fafc;font-weight:800;color:var(--muted)}
 .lmops-row.attn{border-color:#f0c36d;background:#fffdf6}
 .lmops-name strong{display:block;font-size:12px}.lmops-name span{color:var(--muted)}
 .lmops-bad{color:#b42318;font-weight:800}.lmops-ok{color:#166534;font-weight:800}
 @media(max-width:900px){.lmops-metrics{grid-template-columns:repeat(2,1fr)}.lmops-row{grid-template-columns:1fr 1fr}.lmops-row.head{display:none}}
 `;
 document.head.appendChild(s);
}
function mount(){
 const grid=document.querySelector('#lmSystemView .lm-system-grid');if(!grid)return null;
 let el=$('#lmOpsV2');if(el)return el;
 el=document.createElement('div');el.id='lmOpsV2';grid.prepend(el);return el;
}
function metric(n,label){return `<div class="lmops-metric"><strong>${Number(n||0)}</strong><span>${esc(label)}</span></div>`}
function row(w){
 const issues=Number(w.integration_issues||0)+Number(w.marketing_issues||0)+Number(w.queue_issues||0)+Number(w.inbound_errors_24h||0);
 return `<div class="lmops-row ${w.needs_attention?'attn':''}">
  <div class="lmops-name"><strong>${esc(w.name||'Workspace')}</strong><span>${Number(w.active_users||0)} bruger${Number(w.active_users||0)===1?'':'e'} · ${Number(w.lead_count||0)} leads · ${Number(w.open_offer_count||0)} åbne tilbud</span></div>
  <div><span class="sub">Login</span><br>${esc(age(w.last_login_at))}</div>
  <div><span class="sub">Aktivitet</span><br>${esc(age(w.last_activity_at))}</div>
  <div class="${issues?'lmops-bad':'lmops-ok'}">${issues?issues+' fejl':'✓ Normal'}</div>
  <div>${Number(w.queue_issues||0)} kø · ${Number(w.inbound_errors_24h||0)} inbound</div>
  <div>${Number(w.usage_30d||0)} / 30d</div>
 </div>`;
}
function render(d){
 last=d;const el=mount();if(!el)return;const s=d?.summary||{},ws=d?.workspaces||[];
 el.innerHTML=`<div class="lmops-head"><div><h2 style="margin:0 0 4px">Driftsovervågning</h2><div class="sub">Workspace-status uden mailindhold eller unødige persondata · opdateret ${esc(fmt(d?.generated_at))}</div></div><button class="btn" id="lmOpsRefresh" type="button">Opdatér</button></div>
 <div class="lmops-metrics">
  ${metric(s.workspaces,'Workspaces')}
  ${metric(s.needs_attention,'Kræver handling')}
  ${metric(s.integration_issues,'Integrationsfejl')}
  ${metric(s.queue_issues,'Køproblemer')}
  ${metric(s.cron_failures_24h,'Cron-fejl 24t')}
 </div>
 <div class="sub" style="margin-top:10px">30 dage: ${Number(s.usage_30d||0)} hændelser · AI ${Number(s.ai_usage_30d||0)} · mail ${Number(s.mail_usage_30d||0)} · ${Number(s.active_cron_jobs||0)} aktive cron-jobs</div>
 <div class="lmops-table"><div class="lmops-row head"><div>Workspace</div><div>Seneste login</div><div>Aktivitet</div><div>Status</div><div>Kø / inbound</div><div>Forbrug</div></div>${ws.map(row).join('')}</div>`;
 $('#lmOpsRefresh').onclick=()=>load(true);
}
async function load(force=false){
 if(loading||window.LM_ACCESS?.platform_admin!==true||typeof supabase==='undefined')return;
 if(!force&&last&&$('#lmOpsV2'))return;
 loading=true;ensureStyle();const el=mount();if(el&&!last)el.innerHTML='<div class="sub">Henter driftsovervågning…</div>';
 try{
   const {data,error}=await supabase.rpc('crm_platform_ops_snapshot_v2');if(error)throw error;render(data||{});
 }catch(e){
   const x=mount();if(x)x.innerHTML='<div class="lmops-head"><div><h2 style="margin:0">Driftsovervågning</h2><div class="lmops-bad">Kunne ikke hente status: '+esc(e.message||e)+'</div></div><button class="btn" id="lmOpsRefresh" type="button">Prøv igen</button></div>';
   const b=$('#lmOpsRefresh');if(b)b.onclick=()=>load(true);
 }finally{loading=false}
}
function active(){return !!$('#lmSystemView')?.classList.contains('active')}
function boot(){
 if(window.LM_ACCESS?.platform_admin!==true)return;
 ensureStyle();mount();if(active())load(false);
}
document.addEventListener('click',e=>{if(e.target.closest?.('#lmSystemNav'))setTimeout(()=>load(true),0)},true);
window.addEventListener('lm:client-switched',()=>{last=null});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0),{once:true});else setTimeout(boot,0);
window.LMAdminOpsV2={refresh:()=>load(true)};
})();