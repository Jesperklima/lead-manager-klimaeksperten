from pathlib import Path
import hashlib
import json
import re

INDEX = Path('index.html')
MANIFEST = Path('baseline/manifest.json')
VERIFY = Path('scripts/verify-repository-baseline.sh')

s = INDEX.read_text(encoding='utf-8')

if 'id="lm-required-views-v1"' in s:
    print('required views fix already applied')
    raise SystemExit(0)

def replace_once(old: str, new: str, label: str):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one source match, found {count}')
    s = s.replace(old, new, 1)

# Navigation: only add the two views that are referenced by existing styles/guards but absent in the DOM.
replace_once(
    '<button data-view="pipeline">Pipeline</button><button data-view="offers">Tilbud</button><button data-view="calendar">Kalender</button>',
    '<button data-view="pipeline">Pipeline</button><button data-view="offers">Tilbud</button><button data-view="offerpipeline">Tilbudspipeline</button><button data-view="calendar">Kalender</button>',
    'offer pipeline navigation'
)
replace_once(
    '<button data-view="opportunities">Muligheder</button><button data-view="activity">Aktivitetslog</button><button data-view="approvals">Godkendelser</button>',
    '<button data-view="opportunities">Muligheder</button><button data-view="activity">Aktivitetslog</button><button data-view="activityReport">Aktivitetsrapport</button><button data-view="approvals">Godkendelser</button>',
    'activity report navigation'
)

# Offer pipeline view. Statuses are exactly the statuses already exposed by the existing offer editor/filter.
offer_pipeline_html = '''<section id="offerpipeline" class="view">
  <div class="offer-pipeline-toolbar pipeline-toolbar">
    <div><strong>Tilbudspipeline</strong><div class="sub">Træk tilbud mellem de eksisterende tilbudsstatusser. Ændringer journalføres som manuelle statusændringer.</div></div>
    <div class="pipeline-actions"><input id="offerPipelineSearch" placeholder="Søg tilbud eller kunde…" style="min-width:240px"><button class="btn small" id="offerPipelineLeft">←</button><button class="btn small" id="offerPipelineRight">→</button></div>
  </div>
  <div class="kanban" id="offerPipelineBoard"></div>
</section>
'''
replace_once(
    '<tbody id="offerRows"></tbody></table></div>\n</section>\n<section id="calendar"',
    '<tbody id="offerRows"></tbody></table></div>\n</section>\n' + offer_pipeline_html + '<section id="calendar"',
    'offer pipeline view'
)

# Activity report view. It exposes the requested custom period plus the four documented quick ranges.
activity_report_html = '''<section id="activityReport" class="view">
  <div class="card" style="margin-bottom:12px">
    <div class="split" style="align-items:end">
      <div class="field" style="margin:0"><label>Fra</label><input id="reportFrom" type="date"></div>
      <div class="field" style="margin:0"><label>Til</label><input id="reportTo" type="date"></div>
      <div class="split"><button class="btn small" data-report-range="today">I dag</button><button class="btn small" data-report-range="week">Denne uge</button><button class="btn small" data-report-range="month">Denne måned</button><button class="btn small" data-report-range="30">Seneste 30 dage</button></div>
      <button class="btn primary" id="reportLoad">Hent rapport</button>
    </div>
    <div id="reportStatus" class="sub" style="margin-top:10px">Rapporten hentes først, når fanen åbnes eller perioden ændres.</div>
  </div>
  <div class="cards" id="reportMetrics"></div>
  <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Dato</th><th>Type</th><th>Virksomhed</th><th>Detalje</th><th>Aktør</th></tr></thead><tbody id="reportRows"></tbody></table></div>
</section>
'''
replace_once(
    '<section id="activity" class="view"><div class="card"><h2 style="margin-top:0">Samlet aktivitetsjournal</h2><div id="activityFeed"></div></div></section>\n<section id="approvals"',
    '<section id="activity" class="view"><div class="card"><h2 style="margin-top:0">Samlet aktivitetsjournal</h2><div id="activityFeed"></div></div></section>\n' + activity_report_html + '<section id="approvals"',
    'activity report view'
)

# The UI refresh map already knows offerpipeline. Add only activityReport metadata.
replace_once("activity:'≡',approvals:'✓'", "activity:'≡',activityReport:'▦',approvals:'✓'", 'activity report icon')
replace_once("activity:'Samlet historik over CRM-aktivitet.',approvals:'Handlinger der kræver din godkendelse.'", "activity:'Samlet historik over CRM-aktivitet.',activityReport:'Vælg periode og træk en samlet aktivitetsrapport direkte fra CRM.',approvals:'Handlinger der kræver din godkendelse.'", 'activity report subtitle')

# Minimal styles only for the new pipeline/report surface; existing shared CRM styles remain authoritative.
required_css = '''<style id="lm-required-views-v1-css">
#offerPipelineBoard{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 14px;scroll-behavior:smooth}
.offer-pipe-col{min-height:420px;padding:10px}.offer-pipe-col.dragover{outline:2px solid var(--accent);outline-offset:-2px;background:#e0ebf0!important}
.offer-pipe-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin:7px 0;cursor:grab}.offer-pipe-card.dragging{opacity:.5}
#reportMetrics{margin-top:12px}#activityReport .tablewrap{max-height:65vh}#activityReport tbody td{vertical-align:top}
@media(max-width:620px){#offerPipelineBoard .offer-pipe-col{flex-basis:82vw;min-width:82vw}}
</style>
'''
replace_once('</head>', required_css + '</head>', 'required views css')

required_js = r'''<script id="lm-required-views-v1">
(()=>{
  const OFFER_PIPE_STATUSES=['I GANG','PÅ PAUSE','VUNDET','TABT','STATUS UKLAR'];
  const qid=id=>document.getElementById(id);

  function offerPipeCard(o){
    const customer=o.customer_name||company(o.company_id).name||'Kunde';
    const follow=o.follow_up_date?fmtDate(o.follow_up_date):'Ingen opfølgningsdato';
    const contact=[o.contact_person,o.contact_details].filter(Boolean).join(' · ');
    return `<div class="offer-pipe-card" draggable="true" data-offer-pipe="${o.id}" data-open-offer="${o.id}"><strong>${esc(o.offer_ref||'Tilbud')}</strong><div>${esc(customer)}</div><small>${esc(follow)}</small>${contact?`<small>${esc(contact)}</small>`:''}</div>`;
  }

  window.renderOfferPipeline=function(){
    const board=qid('offerPipelineBoard');if(!board||typeof state==='undefined')return;
    const q=(qid('offerPipelineSearch')?.value||'').trim().toLowerCase();
    const offers=(state.offers||[]).filter(o=>!q||[o.offer_ref,o.customer_name,company(o.company_id).name,o.installation_address,o.contact_person,o.contact_details].join(' ').toLowerCase().includes(q));
    const oldScroll=board.scrollLeft;
    board.innerHTML=OFFER_PIPE_STATUSES.map(status=>{
      const rows=offers.filter(o=>o.status===status);
      return `<div class="col offer-pipe-col" data-offer-pipe-status="${esc(status)}"><strong>${esc(status)}</strong><div class="sub">${rows.length} tilbud</div>${rows.map(offerPipeCard).join('')}</div>`;
    }).join('');
    board.scrollLeft=oldScroll;
    if(typeof wireOfferButtons==='function')wireOfferButtons();
    wireOfferPipelineDrag();
  };

  async function moveOfferPipelineOffer(id,targetStatus){
    const o=typeof offerById==='function'?offerById(id):null;if(!o||o.status===targetStatus)return;
    const previous=o.status;
    let r=await supabase.from('crm_offers').update({status:targetStatus,status_reason:`Manuelt ændret fra ${previous} til ${targetStatus}`}).eq('id',o.id);
    if(r.error){toast(r.error.message);await loadAll();return}
    if(typeof logOfferActivity==='function')await logOfferActivity(o,'Tilbudsstatus',`${previous} → ${targetStatus} (pipeline drag & drop)`,{previous,next:targetStatus,manual:true,method:'offer_pipeline_drag_drop'});
    const openTask=(state.tasks||[]).find(t=>t.offer_id===o.id&&t.task_type==='offer_followup'&&t.status==='open');
    if(targetStatus==='I GANG'&&o.follow_up_date){
      const scheduled=isoFromInputs(o.follow_up_date,'09:00');
      if(openTask)r=await supabase.from('crm_tasks').update({scheduled_at:scheduled,assigned_to:o.follow_up_owner||'JS'}).eq('id',openTask.id);
      else r=await supabase.from('crm_tasks').insert({client_id:state.client.id,company_id:o.company_id,offer_id:o.id,title:`Følg op på tilbud ${o.offer_ref} – ${o.customer_name||''}`,task_type:'offer_followup',scheduled_at:scheduled,planning_type:'flexible',status:'open',priority:'A',assigned_to:o.follow_up_owner||'JS',calendar_sync_status:'none'});
      if(r.error){toast(r.error.message);await loadAll();return}
    }else if(openTask){
      r=await supabase.from('crm_tasks').update({status:'done'}).eq('id',openTask.id);
      if(r.error){toast(r.error.message);await loadAll();return}
    }
    await loadAll();toast(`Tilbud ${o.offer_ref||''} flyttet til ${targetStatus}`);
  }

  function wireOfferPipelineDrag(){
    const board=qid('offerPipelineBoard');if(!board)return;
    board.querySelectorAll('[data-offer-pipe]').forEach(card=>{
      card.addEventListener('dragstart',e=>{card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-offer-pipe',card.dataset.offerPipe)});
      card.addEventListener('dragend',()=>{card.classList.remove('dragging');board.querySelectorAll('.offer-pipe-col.dragover').forEach(x=>x.classList.remove('dragover'))});
    });
    board.querySelectorAll('[data-offer-pipe-status]').forEach(col=>{
      col.addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes('application/x-offer-pipe'))return;e.preventDefault();col.classList.add('dragover')});
      col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('dragover')});
      col.addEventListener('drop',async e=>{const id=e.dataTransfer.getData('application/x-offer-pipe');if(!id)return;e.preventDefault();e.stopPropagation();col.classList.remove('dragover');await moveOfferPipelineOffer(id,col.dataset.offerPipeStatus)});
    });
  }

  function dateYmd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function setReportRange(kind){
    const now=new Date();now.setHours(12,0,0,0);let from=new Date(now),to=new Date(now);
    if(kind==='week'){const day=(now.getDay()+6)%7;from.setDate(now.getDate()-day);to.setDate(from.getDate()+6)}
    else if(kind==='month'){from=new Date(now.getFullYear(),now.getMonth(),1,12);to=new Date(now.getFullYear(),now.getMonth()+1,0,12)}
    else if(kind==='30'){from.setDate(now.getDate()-29)}
    qid('reportFrom').value=dateYmd(from);qid('reportTo').value=dateYmd(to);
  }

  async function reportFetch(table,dateCol,fromValue,toValue){
    const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Ikke logget ind');
    const qs=new URLSearchParams();qs.set('select','*');qs.append(dateCol,'gte.'+fromValue);qs.append(dateCol,'lte.'+toValue);qs.set('order',dateCol+'.desc');qs.set('limit','5000');
    const res=await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs.toString()}`,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token}});
    const text=await res.text();let data=[];try{data=text?JSON.parse(text):[]}catch{throw new Error(text||`${res.status} ${res.statusText}`)}
    if(!res.ok)throw new Error(data?.message||data?.error||`${res.status} ${res.statusText}`);return data||[];
  }

  window.loadActivityReport=async function(){
    const view=qid('activityReport');if(!view?.classList.contains('active'))return;
    const from=qid('reportFrom')?.value,to=qid('reportTo')?.value;if(!from||!to){toast('Vælg fra- og til-dato');return}
    if(from>to){toast('Fra-dato skal være før til-dato');return}
    const status=qid('reportStatus'),load=qid('reportLoad');load.disabled=true;status.textContent='Henter aktivitetsrapport…';
    try{
      const fromIso=new Date(from+'T00:00:00').toISOString(),toIso=new Date(to+'T23:59:59.999').toISOString();
      const [activities,mails,leads,offers]=await Promise.all([
        reportFetch('crm_activities','created_at',fromIso,toIso),
        reportFetch('crm_mail_messages','message_at',fromIso,toIso),
        reportFetch('crm_leads','updated_at',fromIso,toIso),
        reportFetch('crm_offers','sent_date',from,to)
      ]);
      const metrics=[[activities.length,'CRM-aktiviteter'],[mails.length,'Mails'],[leads.length,'Leads ændret'],[offers.length,'Tilbud sendt']];
      qid('reportMetrics').innerHTML=metrics.map(([v,l])=>`<div class="card"><div class="sub">${esc(l)}</div><div class="metric">${v}</div></div>`).join('');
      const activityRows=activities.map(a=>({at:a.created_at,type:a.type||'Aktivitet',company:company(a.company_id).name||'',detail:a.summary||'',actor:a.actor_name||a.actor_type||''}));
      const mailRows=mails.map(m=>({at:m.message_at,type:m.direction==='inbound'?'Indgående mail':'Udgående mail',company:company(m.company_id).name||'',detail:[m.subject,m.body_text].filter(Boolean).join(' — '),actor:m.from_email||''}));
      const rows=[...activityRows,...mailRows].sort((a,b)=>new Date(b.at)-new Date(a.at));
      qid('reportRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${fmt(r.at)}</td><td>${esc(r.type)}</td><td>${esc(r.company||'—')}</td><td>${esc(r.detail||'—')}</td><td>${esc(r.actor||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Ingen registreret aktivitet i perioden.</td></tr>';
      status.textContent=`Periode ${from} – ${to} · ${rows.length} journal-/mailhændelser.`;
    }catch(e){status.textContent='Rapporten kunne ikke hentes: '+(e?.message||e);toast('Aktivitetsrapport fejlede')}
    finally{load.disabled=false}
  };

  qid('offerPipelineSearch')?.addEventListener('input',()=>renderOfferPipeline());
  qid('offerPipelineLeft')?.addEventListener('click',()=>qid('offerPipelineBoard')?.scrollBy({left:-600,behavior:'smooth'}));
  qid('offerPipelineRight')?.addEventListener('click',()=>qid('offerPipelineBoard')?.scrollBy({left:600,behavior:'smooth'}));
  qid('reportLoad')?.addEventListener('click',()=>loadActivityReport());
  document.querySelectorAll('[data-report-range]').forEach(b=>b.addEventListener('click',()=>{setReportRange(b.dataset.reportRange);loadActivityReport()}));
  setReportRange('30');

  const previousRender=window.render;
  if(typeof previousRender==='function')window.render=function(){previousRender();renderOfferPipeline()};
  if(typeof state!=='undefined'&&state?.client)renderOfferPipeline();
})();
</script>
'''
replace_once('<script id="lm-report-lazy-guard-v1">', required_js + '\n<script id="lm-report-lazy-guard-v1">', 'required views javascript')

INDEX.write_text(s, encoding='utf-8', newline='')
raw = INDEX.read_bytes()
new_bytes = len(raw)
new_md5 = hashlib.md5(raw).hexdigest()

manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
manifest['derived_from'] = {
    'bytes': manifest.get('bytes'),
    'md5': manifest.get('md5'),
    'snapshot': manifest.get('snapshot')
}
manifest['repository_bytes'] = new_bytes
manifest['repository_md5'] = new_md5
manifest['change'] = 'restore missing offer pipeline and activity report views'
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

verify = VERIFY.read_text(encoding='utf-8')
verify = re.sub(r'EXPECTED_BYTES="\d+"', f'EXPECTED_BYTES="{new_bytes}"', verify, count=1)
verify = re.sub(r'EXPECTED_MD5="[0-9a-f]{32}"', f'EXPECTED_MD5="{new_md5}"', verify, count=1)
verify = re.sub(r"assert m\['bytes'\]==\d+\nassert m\['md5'\]=='[0-9a-f]{32}'", f"assert m['repository_bytes']=={new_bytes}\nassert m['repository_md5']=='{new_md5}'", verify, count=1)
verify = re.sub(r'echo "Repository baseline verified: .*?"', f'echo "Repository source verified: {new_bytes} bytes / {new_md5}"', verify, count=1)
VERIFY.write_text(verify, encoding='utf-8', newline='')

print(f'Applied required views fix: {new_bytes} bytes / {new_md5}')
