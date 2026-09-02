(()=>{
  'use strict';

  let selectedPeriod='week';
  let serverClockMs=null;
  let serverClockMeasuredAt=null;
  const byId=id=>document.getElementById(id);
  const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const closedStatuses=new Set(['VUNDET','TABT','IKKE RELEVANT']);

  function dashboardNow(){
    if(serverClockMs!==null&&serverClockMeasuredAt!==null&&typeof performance!=='undefined')return serverClockMs+(performance.now()-serverClockMeasuredAt);
    return Date.now();
  }

  async function syncServerClock(){
    try{
      const response=await fetch(location.origin+'/',{method:'HEAD',cache:'no-store'});
      const parsed=Date.parse(response.headers.get('date')||'');
      if(!Number.isFinite(parsed))throw new Error('Serveren returnerede ikke et gyldigt tidsstempel');
      serverClockMs=parsed;
      serverClockMeasuredAt=typeof performance!=='undefined'?performance.now():0;
      renderExecutiveDashboard();
    }catch(error){
      console.warn('Executive Dashboard kunne ikke synkronisere servertid',error);
    }
  }

  function startOfPeriod(period){
    if(period==='all')return null;
    const start=new Date(dashboardNow());
    start.setHours(0,0,0,0);
    if(period==='month')start.setDate(1);
    else start.setDate(start.getDate()-((start.getDay()+6)%7));
    return start.getTime();
  }

  function recordTime(record,fields){
    for(const field of fields){
      if(!record?.[field])continue;
      const value=String(record[field]);
      const time=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value).getTime();
      if(Number.isFinite(time))return time;
    }
    return null;
  }

  function inSelectedPeriod(record,fields){
    const start=startOfPeriod(selectedPeriod);
    if(start===null)return true;
    const time=recordTime(record,fields);
    return time!==null&&time>=start&&time<=dashboardNow();
  }

  function clickButton(label,attrs=''){
    return `<button type="button" class="btn small" ${attrs}>${safe(label)}</button>`;
  }

  function metric(value,label,icon,color,description){
    return `<article class="card executive-metric" style="--metric-color:${color}" title="${safe(description)}"><div class="executive-metric-top"><div class="executive-kicker">${safe(label)}</div><div class="executive-metric-icon" aria-hidden="true">${icon}</div></div><div class="executive-metric-value">${value}</div><div class="executive-metric-label">${safe(description)}</div></article>`;
  }

  function attentionItem({color,title,copy,button,attrs}){
    return `<div class="executive-attention-item" style="--item-color:${color}"><span class="executive-attention-dot" aria-hidden="true"></span><div><div class="executive-attention-title">${safe(title)}</div><div class="executive-attention-copy">${safe(copy)}</div></div>${clickButton(button,attrs)}</div>`;
  }

  function renderAttention(leads,offers,approvals){
    const target=byId('executiveAttention');
    if(!target)return;
    const now=dashboardNow();
    const items=[];
    offers.filter(offer=>offer.status==='I GANG'&&offer.follow_up_date&&new Date(offer.follow_up_date+'T23:59:59').getTime()<now).slice(0,2).forEach(offer=>{
      items.push({color:'#c44141',title:`Tilbud ${offer.offer_ref||''} er forfaldent`,copy:offer.customer_name||company(offer.company_id).name||'Kunde',button:'Åbn tilbud',attrs:`data-executive-offer="${safe(offer.id)}"`});
    });
    leads.filter(lead=>!closedStatuses.has(lead.status)&&lead.next_at&&new Date(lead.next_at).getTime()<now).slice(0,3).forEach(lead=>{
      items.push({color:'#c47b12',title:leadName(lead),copy:`${lead.next_action||'Opfølgning'} · ${fmt(lead.next_at)}`,button:'Åbn lead',attrs:`data-executive-lead="${safe(lead.id)}"`});
    });
    const pending=approvals.filter(item=>item.status==='pending');
    if(pending.length)items.push({color:'#2f67d8',title:`${pending.length} ${pending.length===1?'godkendelse venter':'godkendelser venter'}`,copy:'Gennemgå handlingerne, før noget bliver sendt eller udført.',button:'Gennemgå',attrs:'data-executive-view="approvals"'});
    const newCount=leads.filter(lead=>lead.status==='NY').length;
    if(newCount<12)items.push({color:'#c47b12',title:`Kun ${newCount} nye leads står klar`,copy:'Målet er mindst 12 nye leads i puljen.',button:'Se nye leads',attrs:'data-executive-status="NY"'});
    target.innerHTML=items.length?items.slice(0,5).map(attentionItem).join(''):'<div class="executive-empty"><div class="executive-empty-mark">✓</div><strong>Alt er fulgt op</strong><div class="sub" style="margin-top:4px">Der er ingen forfaldne handlinger lige nu.</div></div>';
  }

  function renderPerformance(periodActivities,periodOffers){
    const target=byId('executivePerformance');
    if(!target)return;
    const statusEvents=periodActivities.filter(item=>String(item.type||'').toLowerCase()==='status'&&item.metadata?.next);
    const closedIds=new Set(statusEvents.filter(item=>['VUNDET','TABT'].includes(item.metadata.next)).map(item=>item.lead_id||item.company_id).filter(Boolean));
    const wonIds=new Set(statusEvents.filter(item=>item.metadata.next==='VUNDET').map(item=>item.lead_id||item.company_id).filter(Boolean));
    const closed=closedIds.size;
    const won=wonIds.size;
    const rate=closed?Math.round((won/closed)*100):0;
    const offerWon=periodOffers.filter(offer=>offer.status==='VUNDET').length;
    target.innerHTML=`<div class="executive-performance"><div class="executive-performance-number">${rate}%</div><div class="executive-performance-caption">Vundet af afsluttede leads i perioden</div><div class="executive-progress" aria-label="Vinderate ${rate} procent"><span style="width:${Math.min(100,rate)}%"></span></div><div class="executive-performance-row"><span>Afsluttede leads</span><strong>${closed}</strong></div><div class="executive-performance-row"><span>Vundne leads</span><strong>${won}</strong></div><div class="executive-performance-row"><span>Vundne tilbud</span><strong>${offerWon}</strong></div></div>`;
  }

  function renderPipeline(leads){
    const target=byId('executivePipeline');
    if(!target)return;
    const groups=[
      {label:'Nye',statuses:['NY','UNDER VURDERING'],color:'#5c88e6'},
      {label:'Kontakt',statuses:['KLAR TIL KONTAKT','I GANG'],color:'#3eaa9a'},
      {label:'Dialog',statuses:['DIALOG','MØDE'],color:'#8066cc'},
      {label:'Tilbud',statuses:['TILBUD','AFVENTER','PÅ PAUSE'],color:'#d49637'},
      {label:'Vundet',statuses:['VUNDET'],color:'#158267'}
    ].map(group=>({...group,count:leads.filter(lead=>group.statuses.includes(lead.status)).length}));
    const total=Math.max(1,groups.reduce((sum,group)=>sum+group.count,0));
    const track=groups.map(group=>`<span title="${safe(group.label)}: ${group.count}" style="width:${(group.count/total)*100}%;background:${group.color}"></span>`).join('');
    const cards=groups.map(group=>`<button type="button" class="executive-pipeline-stage" data-executive-view="pipeline" style="--stage-color:${group.color}"><i aria-hidden="true"></i><strong>${group.count}</strong><span>${safe(group.label)}</span></button>`).join('');
    target.innerHTML=`<div class="executive-pipeline"><div class="executive-pipeline-track" aria-label="Fordeling af pipeline">${track}</div><div class="executive-pipeline-list">${cards}</div></div>`;
  }

  function activityIcon(type){
    const value=String(type||'').toLowerCase();
    if(value.includes('mail'))return '✉';
    if(value.includes('status'))return '↗';
    if(value.includes('opkald'))return '☎';
    if(value.includes('møde'))return '◷';
    return '•';
  }

  function renderActivityList(activities){
    const target=byId('executiveActivity');
    if(!target)return;
    const rows=activities.slice(0,5).map(item=>`<div class="executive-activity-item"><div class="executive-activity-icon" aria-hidden="true">${activityIcon(item.type)}</div><div><div class="executive-activity-title">${safe(item.summary||item.type||'Aktivitet')}</div><div class="executive-activity-meta">${safe(company(item.company_id).name||'System')} · ${safe(fmt(item.created_at))}</div></div></div>`).join('');
    target.innerHTML=`<div class="executive-activity">${rows||'<div class="executive-empty">Ingen aktiviteter i perioden.</div>'}</div>`;
  }

  function renderExecutiveDashboard(){
    if(typeof state==='undefined'||!state?.leads)return;
    const leads=state.leads||[],offers=state.offers||[],approvals=state.approvals||[],activities=state.activities||[];
    const periodOffers=offers.filter(offer=>inSelectedPeriod(offer,['updated_at','sent_date','created_at','follow_up_date']));
    const periodActivities=activities.filter(item=>inSelectedPeriod(item,['created_at']));
    const found=leads.filter(lead=>['NY','UNDER VURDERING'].includes(lead.status)).length;
    const approvedStatuses=new Set(['KLAR TIL KONTAKT','I GANG','DIALOG','MØDE','TILBUD','AFVENTER','PÅ PAUSE']);
    const approved=leads.filter(lead=>approvedStatuses.has(lead.status)).length;
    const dialogue=leads.filter(lead=>['DIALOG','MØDE'].includes(lead.status)).length;
    const activeOffers=offers.filter(offer=>offer.status==='I GANG').length;
    const won=leads.filter(lead=>lead.status==='VUNDET').length;
    const metrics=byId('executiveMetrics');
    if(metrics)metrics.innerHTML=[
      metric(found,'FUNDET','◎','#2f67d8','Nye leads'),
      metric(approved,'GODKENDT','✓','#158267','Aktive leads videre fra vurdering'),
      metric(dialogue,'I DIALOG','↔','#8066cc','Aktive dialoger og møder'),
      metric(activeOffers,'TILBUD','▣','#c47b12','Aktive tilbud'),
      metric(won,'VUNDET','◆','#158267','Vundne leads')
    ].join('');

    const labels={week:['Denne uge','Aktuel salgsstatus samt handlinger og aktivitet fra denne uge.'],month:['Denne måned','Aktuel salgsstatus samt handlinger og aktivitet fra denne måned.'],all:['Samlet overblik','Aktuel salgsstatus og hele aktivitetshistorikken.']};
    const label=labels[selectedPeriod];
    if(byId('executivePeriodTitle'))byId('executivePeriodTitle').textContent=label[0];
    if(byId('executivePeriodText'))byId('executivePeriodText').textContent=label[1];
    document.querySelectorAll('[data-executive-period]').forEach(button=>button.classList.toggle('active',button.dataset.executivePeriod===selectedPeriod));
    renderAttention(leads,offers,approvals);
    renderPerformance(periodActivities,periodOffers);
    renderPipeline(leads);
    renderActivityList(periodActivities);
    if(state.client)byId('loading')?.classList.add('hidden');
  }

  function openView(view){document.querySelector(`.nav button[data-view="${view}"]`)?.click()}

  document.addEventListener('click',event=>{
    const periodButton=event.target.closest('[data-executive-period]');
    if(periodButton){selectedPeriod=periodButton.dataset.executivePeriod;renderExecutiveDashboard();return}
    const leadButton=event.target.closest('[data-executive-lead]');
    if(leadButton&&typeof openLead==='function'){openLead(leadButton.dataset.executiveLead);return}
    const offerButton=event.target.closest('[data-executive-offer]');
    if(offerButton&&typeof openOffer==='function'){openOffer(offerButton.dataset.executiveOffer);return}
    const statusButton=event.target.closest('[data-executive-status]');
    if(statusButton){openView('leads');setTimeout(()=>{const select=byId('statusFilter');if(select){select.value=statusButton.dataset.executiveStatus;select.dispatchEvent(new Event('change',{bubbles:true}))}},0);return}
    const viewButton=event.target.closest('[data-executive-view]');
    if(viewButton)openView(viewButton.dataset.executiveView);
  });

  window.renderExecutiveDashboard=renderExecutiveDashboard;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderExecutiveDashboard);
  else renderExecutiveDashboard();
  syncServerClock();
  setInterval(syncServerClock,30*60*1000);

  const approvalScript=document.createElement('script');
  approvalScript.src='/approval-center-v2.js?v=20260902-1';
  approvalScript.defer=true;
  document.head.appendChild(approvalScript);
})();
