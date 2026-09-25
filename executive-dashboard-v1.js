(()=>{
  'use strict';

  let selectedPeriod='week';
  let serverClockMs=null;
  let serverClockMeasuredAt=null;
  const byId=id=>document.getElementById(id);
  function setNodeText(id,value){const el=byId(id);if(!el){console.warn('[Executive Dashboard] DOM element mangler:',id);return false}el.textContent=value??'';return true}
  const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const closedStatuses=new Set(['VUNDET','TABT','IKKE RELEVANT']);
  const allowedNewLeadPoolSizes=[10,20,30];

  function dashboardNow(){
    if(serverClockMs!==null&&serverClockMeasuredAt!==null&&typeof performance!=='undefined')return serverClockMs+(performance.now()-serverClockMeasuredAt);
    return Date.now();
  }

  function newLeadPoolLimit(){
    const raw=Number(state?.client?.settings?.new_lead_pool_limit??10);
    return allowedNewLeadPoolSizes.includes(raw)?raw:10;
  }

  async function saveNewLeadPoolLimit(value){
    const limit=Number(value);
    if(!allowedNewLeadPoolSizes.includes(limit)||!state?.client?.id)return;
    const clientId=state.client.id;
    const select=byId('newLeadPoolSize');
    if(select)select.disabled=true;
    try{
      const {data,error}=await supabase.rpc('crm_set_new_lead_pool_limit',{p_client_id:clientId,p_limit:limit});
      if(error)throw error;
      const currentSettings=(state.client.settings&&typeof state.client.settings==='object')?state.client.settings:{};
      state.client={...state.client,settings:{...currentSettings,new_lead_pool_limit:limit}};
      renderNewLeadPoolControl();
      renderAttention(state.leads||[],state.offers||[],state.approvals||[]);
      const currentNy=Number(data?.current_ny);
      const knownNy=Number.isFinite(currentNy)?currentNy:(state.leads||[]).filter(lead=>lead.status==='NY'&&(lead.lead_pool||'standard')==='standard').length;
      const missing=Math.max(0,limit-knownNy);
      toast(missing?`Puljen er sat til ${limit}. Finder ${missing} nye leads nu.`:`Puljen er sat til ${limit} og er klar.`);
      window.dispatchEvent(new CustomEvent('lm:lead-pool-limit-changed',{detail:{client_id:clientId,new_limit:limit,result:data||null}}));
    }catch(error){
      toast(`Kunne ikke gemme puljestørrelse: ${error?.message||error}`);
      renderNewLeadPoolControl();
    }
  }

  function renderNewLeadPoolControl(){
    if(typeof state==='undefined'||!state?.client)return;
    const pipeline=document.querySelector('#pipeline .pipeline-toolbar');
    if(!pipeline)return;
    let wrap=byId('newLeadPoolControl');
    if(!wrap){
      wrap=document.createElement('label');
      wrap.id='newLeadPoolControl';
      wrap.className='pill';
      wrap.style.cssText='gap:7px;align-items:center;white-space:nowrap';
      const actions=pipeline.querySelector('.pipeline-actions');
      (actions||pipeline).appendChild(wrap);
    }
    const limit=newLeadPoolLimit();
    const count=(state.leads||[]).filter(lead=>lead.status==='NY'&&(lead.lead_pool||'standard')==='standard').length;
    wrap.innerHTML=`<span>Nye:</span><select id="newLeadPoolSize" aria-label="Antal leads i puljen Nye" style="border:0;background:transparent;font-weight:800;color:inherit;outline:none"><option value="10" ${limit===10?'selected':''}>10</option><option value="20" ${limit===20?'selected':''}>20</option><option value="30" ${limit===30?'selected':''}>30</option></select><span class="sub" style="font-size:11px">${count}/${limit}</span>`;
    byId('newLeadPoolSize').onchange=event=>saveNewLeadPoolLimit(event.target.value);
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
    const targetCount=newLeadPoolLimit();
    if(newCount<targetCount)items.push({color:'#c47b12',title:`${newCount}/${targetCount} nye leads står klar`,copy:`Leadmotoren fylder automatisk puljen op til ${targetCount}.`,button:'Se nye leads',attrs:'data-executive-status="NY"'});
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
    setNodeText('executivePeriodTitle',label[0]);
    setNodeText('executivePeriodText',label[1]);
    document.querySelectorAll('[data-executive-period]').forEach(button=>button.classList.toggle('active',button.dataset.executivePeriod===selectedPeriod));
    renderAttention(leads,offers,approvals);
    renderPerformance(periodActivities,periodOffers);
    renderPipeline(leads);
    renderActivityList(periodActivities);
    renderNewLeadPoolControl();
    if(state.client)byId('loading')?.classList.add('hidden');
  }

  function openView(view){document.querySelector(`.nav button[data-view="${view}"]`)?.click()}

  document.addEventListener('click',async event=>{
    const periodButton=event.target.closest('[data-executive-period]');
    if(periodButton){
      selectedPeriod=periodButton.dataset.executivePeriod;
      const partialActivities=window.__LM_PERF?.getPartialKeys?.().includes('activities');
      if(selectedPeriod==='all'&&partialActivities){
        periodButton.disabled=true;
        try{await window.__LM_PERF.refreshKeys('activities')}finally{periodButton.disabled=false}
      }
      renderExecutiveDashboard();return
    }
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

  const offerMailScript=document.createElement('script');
  offerMailScript.src='/offer-mail-v1.js?v=20260925-5-contact-name';
  offerMailScript.defer=true;
  document.head.appendChild(offerMailScript);

  const mailTemplatesScript=document.createElement('script');
  mailTemplatesScript.src='/mail-templates-v1.js?v=20260925-1-contact-name';
  mailTemplatesScript.defer=true;
  document.head.appendChild(mailTemplatesScript);
})();