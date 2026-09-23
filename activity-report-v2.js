(()=>{
'use strict';
const core=window.LMActivityReportCoreV2;if(!core)return;
const q=id=>document.getElementById(id), esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const cats=['all','Mails','Tilbud','Leads','Pipeline','Planlægning','System','Øvrige'];
const catLabel={all:'Alle'};
const columns=[
  {key:'date',label:'Dato'},{key:'time',label:'Tid'},{key:'category',label:'Kategori'},{key:'type',label:'Type'},
  {key:'company',label:'Virksomhed'},{key:'actor',label:'Bruger / aktør'},{key:'detail',label:'Detalje'},{key:'status',label:'Status'},
  {key:'mailDirection',label:'Mailretning'},{key:'offerStatus',label:'Tilbudsstatus'},{key:'leadStatus',label:'Leadstatus'},
  {key:'pipelineStatus',label:'Pipelinestatus'},{key:'offerRef',label:'Tilbudsnummer'},{key:'source',label:'Kilde'}
];
const rs={rows:[],filtered:[],category:'all',source:'',sortKey:'at',sortDir:'desc',filters:{},selected:new Set(columns.slice(0,12).map(c=>c.key)),enhanced:false,loading:false};

function appState(){try{return typeof state!=='undefined'?state:null}catch{return null}}
function companyName(id,fallback=''){
  if(fallback)return fallback;
  try{if(typeof company==='function')return company(id)?.name||''}catch{}
  const st=appState();return st?.companies?.find?.(x=>x.id===id)?.name||'';
}
function clientKey(){return appState()?.client?.id||'default'}
function fmtDateTime(v){
  if(!v)return {date:'',time:''};
  const d=new Date(v);if(Number.isNaN(d.getTime()))return {date:String(v).slice(0,10),time:''};
  return {date:d.toLocaleDateString('da-DK'),time:d.toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'})};
}
function meta(v){if(!v)return{};if(typeof v==='object')return v;try{return JSON.parse(v)}catch{return{}}}
function inferPipelineStatus(a,m){
  const direct=a.pipeline_status||a.status_to||a.new_status||m.pipeline_status||m.next||m.status;
  if(direct)return String(direct);
  const s=String(a.summary||a.detail||'');const hit=s.match(/→\s*([^,(]+)/);return hit?hit[1].trim():'';
}
function rowBase(at,source){
  const f=fmtDateTime(at);return {at,source,date:f.date,time:f.time,category:'',type:'',company:'',actor:'',detail:'',status:'',mailDirection:'',offerStatus:'',leadStatus:'',pipelineStatus:'',offerRef:''};
}
function normalize(activities,mails,leads,offers){
  const out=[];
  for(const a of activities||[]){
    const m=meta(a.metadata);const r=rowBase(a.created_at,'activity');
    r.type=a.type||'Aktivitet';r.company=companyName(a.company_id,a.company_name||m.company_name||'');r.actor=a.actor_name||a.actor_type||a.user_email||m.actor||'';
    r.detail=a.summary||a.detail||m.summary||'';r.status=a.status||m.status||'';r.pipelineStatus=inferPipelineStatus(a,m);r.offerRef=a.offer_ref||m.offer_ref||'';
    r.category=core.categoryFor(r);out.push(r);
  }
  for(const m of mails||[]){
    const r=rowBase(m.message_at||m.created_at,'mail');const inbound=m.direction==='inbound';
    r.category='Mails';r.type=inbound?'Indgående mail':'Udgående mail';r.mailDirection=inbound?'Indgående':'Udgående';
    r.company=companyName(m.company_id,m.company_name||'');r.actor=m.from_email||m.sender_email||m.to_email||'';
    r.detail=[m.subject,m.body_text||m.snippet].filter(Boolean).join(' — ');r.status=m.delivery_status||m.status||'';out.push(r);
  }
  for(const l of leads||[]){
    const r=rowBase(l.updated_at||l.created_at,'lead');r.category='Leads';r.type='Lead ændret';
    r.company=companyName(l.company_id,l.company_name||l.name||'');r.actor=l.owner||l.assigned_to||l.updated_by||'';r.status=l.status||'';r.leadStatus=l.status||'';
    r.detail=[l.next_action,l.note||l.notes,l.source].filter(Boolean).join(' — ');out.push(r);
  }
  for(const o of offers||[]){
    const at=o.sent_date?o.sent_date+'T12:00:00':(o.updated_at||o.created_at);const r=rowBase(at,'offer');r.category='Tilbud';r.type='Tilbud sendt';
    r.company=o.customer_name||companyName(o.company_id,'');r.actor=o.follow_up_owner||o.owner||'';r.status=o.status||'';r.offerStatus=o.status||'';r.offerRef=o.offer_ref||'';
    r.detail=[o.installation_address,o.contact_person,o.follow_up_date?('Opfølgning '+o.follow_up_date):''].filter(Boolean).join(' — ');out.push(r);
  }
  return out;
}
function uniq(key,sourceRows=rs.rows){
  return [...new Set(sourceRows.map(r=>r[key]).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b,'da',{numeric:true,sensitivity:'base'}));
}
function filterState(){
  return {...rs.filters,category:rs.category,source:rs.source};
}
function apply(){
  rs.filtered=core.sortRows(core.filterRows(rs.rows,filterState()),rs.sortKey,rs.sortDir);
  renderKpis();renderTabs();renderTable();updateCount();
}
function optionHtml(values,current,label){
  return '<option value="">'+esc(label)+': alle</option>'+values.map(v=>'<option'+(v===current?' selected':'')+'>'+esc(v)+'</option>').join('');
}
function populateFilters(){
  const map={lmRfCompany:['company','Virksomhed'],lmRfType:['type','Type'],lmRfActor:['actor','Bruger / aktør'],lmRfMail:['mailDirection','Mailretning'],lmRfOffer:['offerStatus','Tilbudsstatus'],lmRfLead:['leadStatus','Leadstatus'],lmRfPipeline:['pipelineStatus','Pipelinestatus']};
  Object.entries(map).forEach(([id,[key,label]])=>{const el=q(id);if(el){el.title=label;el.innerHTML=optionHtml(uniq(key),rs.filters[key]||'',label)}});
}
function renderTabs(){
  const host=q('lmReportTabs');if(!host)return;
  host.innerHTML=cats.map(c=>{
    const n=c==='all'?rs.rows.length:rs.rows.filter(r=>r.category===c).length;
    return '<button class="btn small lm-report-tab'+(rs.category===c?' active':'')+'" data-cat="'+esc(c)+'">'+esc(catLabel[c]||c)+' <span>'+n+'</span></button>';
  }).join('');
  host.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{rs.category=b.dataset.cat;rs.source='';apply()});
}
function renderKpis(){
  const host=q('reportMetrics');if(!host)return;
  const defs=[['activity','CRM-aktiviteter'],['mail','Mails'],['lead','Leads ændret'],['offer','Tilbud sendt']];
  host.innerHTML=defs.map(([src,label])=>{
    const n=rs.rows.filter(r=>r.source===src).length;
    return '<button type="button" class="card lm-report-kpi'+(rs.source===src?' active':'')+'" data-src="'+src+'"><div class="sub">'+esc(label)+'</div><div class="metric">'+n+'</div></button>';
  }).join('');
  host.querySelectorAll('[data-src]').forEach(b=>b.onclick=()=>{rs.source=rs.source===b.dataset.src?'':b.dataset.src;rs.category='all';apply()});
}
function head(key,label){
  const mark=rs.sortKey===key?(rs.sortDir==='asc'?' ↑':' ↓'):'';
  return '<th><button class="lm-sort" data-sort="'+key+'">'+esc(label)+mark+'</button></th>';
}
function renderTable(){
  const table=q('reportRows')?.closest('table');if(!table)return;
  table.querySelector('thead').innerHTML='<tr>'+head('at','Dato')+head('type','Type')+head('company','Virksomhed')+head('actor','Bruger')+head('status','Status')+head('detail','Detalje')+'</tr>';
  const body=q('reportRows');const shown=rs.filtered.slice(0,2000);
  body.innerHTML=shown.length?shown.map(r=>'<tr><td>'+esc([r.date,r.time].filter(Boolean).join(', '))+'</td><td><span class="badge">'+esc(r.category)+'</span><br>'+esc(r.type||'—')+'</td><td>'+esc(r.company||'—')+'</td><td>'+esc(r.actor||'—')+'</td><td>'+esc(r.status||r.offerStatus||r.leadStatus||r.pipelineStatus||'—')+'</td><td>'+esc(r.detail||'—')+'</td></tr>').join(''):'<tr><td colspan="6" class="empty">Ingen poster matcher filtrene.</td></tr>';
  table.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.sort;if(rs.sortKey===k)rs.sortDir=rs.sortDir==='asc'?'desc':'asc';else{rs.sortKey=k;rs.sortDir=k==='at'?'desc':'asc'}apply()});
}
function updateCount(){
  const status=q('reportStatus');const from=q('reportFrom')?.value,to=q('reportTo')?.value;if(!status)return;
  status.textContent='Periode '+(from||'—')+' – '+(to||'—')+' · '+rs.filtered.length+' poster efter filtre'+(rs.filtered.length>2000?' · de første 2.000 vises, eksport indeholder alle':'')+'.';
}
async function reportFetch(table,dateCol,fromValue,toValue){
  const sb=(typeof supabase!=='undefined'?supabase:window.supabase);if(!sb)throw new Error('CRM-forbindelsen er ikke klar');
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)throw new Error('Ikke logget ind');
  const base=(typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:window.SUPABASE_URL),key=(typeof SUPABASE_KEY!=='undefined'?SUPABASE_KEY:window.SUPABASE_KEY);
  const qs=new URLSearchParams();qs.set('select','*');qs.append(dateCol,'gte.'+fromValue);qs.append(dateCol,'lte.'+toValue);qs.set('order',dateCol+'.desc');qs.set('limit','5000');
  const res=await fetch(base+'/rest/v1/'+table+'?'+qs.toString(),{headers:{apikey:key,Authorization:'Bearer '+session.access_token}});
  const text=await res.text();let data=[];try{data=text?JSON.parse(text):[]}catch{throw new Error(text||res.statusText)}
  if(!res.ok)throw new Error(data?.message||data?.error||res.statusText);return data||[];
}
async function loadReport(){
  const view=q('activityReport');if(!view?.classList.contains('active'))return;
  const from=q('reportFrom')?.value,to=q('reportTo')?.value;if(!from||!to){window.toast?.('Vælg fra- og til-dato');return}if(from>to){window.toast?.('Fra-dato skal være før til-dato');return}
  if(rs.loading)return;rs.loading=true;const btn=q('reportLoad');if(btn)btn.disabled=true;if(q('reportStatus'))q('reportStatus').textContent='Henter aktivitetsrapport…';
  try{
    const fi=new Date(from+'T00:00:00').toISOString(),ti=new Date(to+'T23:59:59.999').toISOString();
    const [activities,mails,leads,offers]=await Promise.all([
      reportFetch('crm_activities','created_at',fi,ti),reportFetch('crm_mail_messages','message_at',fi,ti),
      reportFetch('crm_leads','updated_at',fi,ti),reportFetch('crm_offers','sent_date',from,to)
    ]);
    rs.rows=normalize(activities,mails,leads,offers);populateFilters();apply();
  }catch(e){if(q('reportStatus'))q('reportStatus').textContent='Rapporten kunne ikke hentes: '+(e?.message||e);window.toast?.('Aktivitetsrapport fejlede')}
  finally{rs.loading=false;if(btn)btn.disabled=false}
}
function wireFilter(id,key,event='change'){
  q(id)?.addEventListener(event,e=>{rs.filters[key]=e.target.value;apply()});
}
function filename(ext){
  const from=q('reportFrom')?.value||'fra',to=q('reportTo')?.value||'til';return 'Lead-Manager-aktivitetsrapport_'+from+'_'+to+'.'+ext;
}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function selectedColumns(){return columns.filter(c=>rs.selected.has(c.key))}
function exportOverview(){
  const active=Object.entries(filterState()).filter(([,v])=>v&&v!=='all').map(([k,v])=>k+': '+v).join(' · ');
  return {'Periode fra':q('reportFrom')?.value||'','Periode til':q('reportTo')?.value||'','Antal poster':rs.filtered.length,'Aktive filtre':active||'Ingen','Sortering':rs.sortKey+' '+rs.sortDir};
}
function openExport(){
  const modal=q('lmReportExportModal');if(!modal)return;
  q('lmExportCols').innerHTML=columns.map(c=>'<label><input type="checkbox" value="'+c.key+'"'+(rs.selected.has(c.key)?' checked':'')+'> '+esc(c.label)+'</label>').join('');
  modal.classList.add('open');
}
function closeExport(){q('lmReportExportModal')?.classList.remove('open')}
function syncExportColumns(){
  q('lmExportCols')?.querySelectorAll('input').forEach(x=>x.checked?rs.selected.add(x.value):rs.selected.delete(x.value));
  if(!rs.selected.size){window.toast?.('Vælg mindst én kolonne til eksport');return false}return true;
}
function doCsv(){
  if(!syncExportColumns())return;
  const csv=core.toCsv(rs.filtered,selectedColumns());download(new Blob([csv],{type:'text/csv;charset=utf-8'}),filename('csv'));closeExport();
}
function doXlsx(){
  if(!syncExportColumns())return;
  const bytes=core.buildXlsx(rs.filtered,selectedColumns(),exportOverview());download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename('xlsx'));closeExport();
}
function viewsKey(){return 'lm.activityReport.v2.views.'+clientKey()}
function getViews(){try{return JSON.parse(localStorage.getItem(viewsKey())||'{}')}catch{return{}}}
function putViews(v){localStorage.setItem(viewsKey(),JSON.stringify(v))}
function refreshViews(selected=''){
  const el=q('lmReportSavedViews');if(!el)return;const views=getViews();el.innerHTML='<option value="">Gemte visninger…</option>'+Object.keys(views).sort((a,b)=>a.localeCompare(b,'da')).map(n=>'<option'+(n===selected?' selected':'')+'>'+esc(n)+'</option>').join('');
}
function saveView(){
  const name=(window.prompt('Navn på visningen')||'').trim();if(!name)return;
  const v=getViews();v[name]={category:rs.category,source:rs.source,sortKey:rs.sortKey,sortDir:rs.sortDir,filters:rs.filters,from:q('reportFrom')?.value,to:q('reportTo')?.value,selected:[...rs.selected]};putViews(v);refreshViews(name);window.toast?.('Visning gemt');
}
function loadView(name){
  if(!name)return;const v=getViews()[name];if(!v)return;
  rs.category=v.category||'all';rs.source=v.source||'';rs.sortKey=v.sortKey||'at';rs.sortDir=v.sortDir||'desc';rs.filters=v.filters||{};rs.selected=new Set(v.selected||[...rs.selected]);
  if(v.from&&q('reportFrom'))q('reportFrom').value=v.from;if(v.to&&q('reportTo'))q('reportTo').value=v.to;
  populateFilters();Object.entries({lmRfQuery:'query',lmRfCompany:'company',lmRfType:'type',lmRfActor:'actor',lmRfMail:'mailDirection',lmRfOffer:'offerStatus',lmRfLead:'leadStatus',lmRfPipeline:'pipelineStatus'}).forEach(([id,k])=>{if(q(id))q(id).value=rs.filters[k]||''});
  apply();loadReport();
}
function deleteView(){
  const el=q('lmReportSavedViews'),name=el?.value;if(!name)return;const v=getViews();delete v[name];putViews(v);refreshViews();window.toast?.('Visning slettet');
}
function injectStyles(){
  if(q('lm-report-v2-css'))return;const s=document.createElement('style');s.id='lm-report-v2-css';s.textContent=`
  #activityReport .lm-report-controls{display:grid;gap:10px;margin:12px 0}
  #lmReportTabs{display:flex;gap:7px;flex-wrap:wrap}.lm-report-tab.active,.lm-report-kpi.active{outline:2px solid var(--accent,#2dd4bf);outline-offset:1px}.lm-report-tab span{opacity:.7}
  #reportMetrics .lm-report-kpi{text-align:left;color:inherit;width:100%;font:inherit;cursor:pointer}
  .lm-report-filterbar{display:grid;grid-template-columns:2fr repeat(3,minmax(130px,1fr));gap:8px}.lm-report-filterbar input,.lm-report-filterbar select,.lm-report-saved select{width:100%;min-width:0}
  .lm-report-saved{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.lm-report-saved select{max-width:260px}
  .lm-sort{border:0;background:transparent;color:inherit;font:inherit;font-weight:700;padding:0;cursor:pointer}
  .lm-report-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:none;align-items:center;justify-content:center;padding:18px}.lm-report-modal.open{display:flex}
  .lm-report-modal-card{background:var(--panel,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:14px;width:min(720px,96vw);max-height:88vh;overflow:auto;padding:18px}
  #lmExportCols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0}.lm-report-export-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
  @media(max-width:900px){.lm-report-filterbar{grid-template-columns:1fr 1fr}}@media(max-width:600px){.lm-report-filterbar,#lmExportCols{grid-template-columns:1fr}}
  `;document.head.appendChild(s);
}
function enhance(){
  if(rs.enhanced||!q('activityReport'))return;rs.enhanced=true;injectStyles();
  const metrics=q('reportMetrics');const wrap=document.createElement('div');wrap.className='card lm-report-controls';wrap.innerHTML=
    '<div id="lmReportTabs"></div>'+
    '<div class="lm-report-filterbar"><input id="lmRfQuery" placeholder="Søg i rapporten…"><select id="lmRfCompany"></select><select id="lmRfType"></select><select id="lmRfActor"></select><select id="lmRfMail"></select><select id="lmRfOffer"></select><select id="lmRfLead"></select><select id="lmRfPipeline"></select></div>'+
    '<div class="lm-report-saved"><select id="lmReportSavedViews"></select><button class="btn small" id="lmReportSave">Gem visning</button><button class="btn small" id="lmReportDelete">Slet visning</button><button class="btn small" id="lmReportClear">Nulstil filtre</button><button class="btn primary small" id="lmReportExport">Eksportér</button></div>';
  metrics?.parentNode?.insertBefore(wrap,metrics);
  const labels={lmRfCompany:'Virksomhed',lmRfType:'Type',lmRfActor:'Bruger / aktør',lmRfMail:'Mailretning',lmRfOffer:'Tilbudsstatus',lmRfLead:'Leadstatus',lmRfPipeline:'Pipelinestatus'};
  Object.entries(labels).forEach(([id,label])=>{q(id).innerHTML='<option value="">'+label+': alle</option>'});
  const modal=document.createElement('div');modal.id='lmReportExportModal';modal.className='lm-report-modal';modal.innerHTML='<div class="lm-report-modal-card"><h2 style="margin-top:0">Eksportér aktivitetsrapport</h2><div class="sub">Eksporten bruger præcis de aktive filtre og den aktuelle sortering. Excel-filen indeholder fanerne <strong>Oversigt</strong> og <strong>Aktiviteter</strong>.</div><div id="lmExportCols"></div><div class="lm-report-export-actions"><button class="btn" id="lmExportCancel">Annuller</button><button class="btn" id="lmExportCsv">Download CSV</button><button class="btn primary" id="lmExportXlsx">Download Excel (.xlsx)</button></div></div>';document.body.appendChild(modal);
  wireFilter('lmRfQuery','query','input');wireFilter('lmRfCompany','company');wireFilter('lmRfType','type');wireFilter('lmRfActor','actor');wireFilter('lmRfMail','mailDirection');wireFilter('lmRfOffer','offerStatus');wireFilter('lmRfLead','leadStatus');wireFilter('lmRfPipeline','pipelineStatus');
  q('lmReportExport').onclick=openExport;q('lmExportCancel').onclick=closeExport;q('lmExportCsv').onclick=doCsv;q('lmExportXlsx').onclick=doXlsx;modal.addEventListener('click',e=>{if(e.target===modal)closeExport()});
  q('lmReportSave').onclick=saveView;q('lmReportDelete').onclick=deleteView;q('lmReportSavedViews').onchange=e=>loadView(e.target.value);
  q('lmReportClear').onclick=()=>{rs.category='all';rs.source='';rs.filters={};['lmRfQuery','lmRfCompany','lmRfType','lmRfActor','lmRfMail','lmRfOffer','lmRfLead','lmRfPipeline'].forEach(id=>{if(q(id))q(id).value=''});apply()};
  refreshViews();renderTabs();renderKpis();
  window.loadActivityReport=loadReport;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance);else enhance();
setTimeout(enhance,400);
})();