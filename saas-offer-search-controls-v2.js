(()=>{
  const norm=v=>String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9@.+-]+/g,' ').replace(/\s+/g,' ').trim();
  const tokens=q=>norm(q).split(' ').filter(Boolean);
  const matches=(hay,q)=>{const ts=tokens(q);if(!ts.length)return true;const h=norm(hay);return ts.every(t=>h.includes(t));};

  function offerSearchText(o){
    const c=typeof company==='function'?company(o.company_id)||{}:{};
    const contacts=typeof contactsFor==='function'?(contactsFor(o.company_id)||[]):[];
    const mails=(typeof state!=='undefined'&&Array.isArray(state.mail)?state.mail:[]).filter(m=>m.offer_id===o.id||(!m.offer_id&&o.company_id&&m.company_id===o.company_id));
    return [
      o.offer_ref,o.customer_name,o.installation_address,o.contact_person,o.contact_details,
      o.current_comment,o.status,o.status_reason,o.source_file,o.data_warning,
      o.minuba_status,o.minuba_record_type,o.minuba_order_number,
      c.name,c.cvr,c.domain,c.website_url,c.phone,c.address,
      ...contacts.flatMap(x=>[x.full_name,x.title,x.email,x.phone]),
      ...mails.flatMap(m=>[m.subject,m.body_text,m.from_email,JSON.stringify(m.to_emails||[]),JSON.stringify(m.cc_emails||[])])
    ].filter(Boolean).join(' ');
  }

  const originalRenderOffers=typeof window.renderOffers==='function'?window.renderOffers:null;
  window.renderOffers=function(){
    if(typeof state==='undefined'||typeof $!=='function'||typeof esc!=='function'||typeof isOfferOverdue!=='function'||typeof statusClass!=='function')return originalRenderOffers?.();
    const active=state.offers.filter(o=>o.status==='I GANG').length;
    const won=state.offers.filter(o=>o.status==='VUNDET').length;
    const lost=state.offers.filter(o=>o.status==='TABT').length;
    const overdue=state.offers.filter(isOfferOverdue).length;
    const metrics=$('offerMetrics');
    if(metrics)metrics.innerHTML=[[active,'Tilbud ude'],[overdue,'Forfaldne'],[won,'Vundet'],[lost,'Tabt']].map(([v,l])=>`<div class="card"><div class="sub">${l}</div><div class="metric">${v}</div></div>`).join('');
    const q=($('offerSearch')?.value||'').trim(),sf=$('offerStatusFilter')?.value||'';
    const rows=state.offers.filter(o=>matches(offerSearchText(o),q)&&(!sf||o.status===sf)).sort((a,b)=>{const ao=isOfferOverdue(a),bo=isOfferOverdue(b);if(ao!==bo)return bo-ao;return String(a.follow_up_date||'9999').localeCompare(String(b.follow_up_date||'9999'));});
    const target=$('offerRows');if(!target)return;
    target.innerHTML=rows.length?rows.map(o=>`<tr data-open-offer="${o.id}" style="cursor:pointer"><td><strong>${esc(o.offer_ref)}</strong>${o.data_warning?'<div class="badge warn" style="margin-top:4px">Kontrollér data</div>':''}</td><td><strong>${esc(o.customer_name||company(o.company_id).name||'')}</strong></td><td>${esc(o.installation_address||'—')}</td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td><td>${fmtDate(o.follow_up_date)} ${isOfferOverdue(o)?'<span class="badge a">Forfalden</span>':''}</td><td>${esc([o.contact_person,o.contact_details].filter(Boolean).join(' · ')||'—')}</td><td><div class="mailbody">${esc(o.current_comment||'—')}</div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Ingen tilbud matcher filtrene.</td></tr>';
    if(typeof wireOfferButtons==='function')wireOfferButtons();
  };

  const originalPipeline=typeof window.renderOfferPipeline==='function'?window.renderOfferPipeline:null;
  if(originalPipeline){
    window.renderOfferPipeline=function(){
      if(typeof state==='undefined')return originalPipeline();
      const input=document.getElementById('offerPipelineSearch'),q=(input?.value||'').trim();
      if(!q)return originalPipeline();
      const original=state.offers,old=input.value;
      try{state.offers=original.filter(o=>matches(offerSearchText(o),q));input.value='';return originalPipeline();}
      finally{state.offers=original;input.value=old;}
    };
  }

  async function firstOfferFollowupTask(o){
    const q=await supabase.from('crm_tasks').select('*').eq('client_id',state.client.id).eq('offer_id',o.id).eq('task_type','offer_followup').limit(1);
    if(q.error)throw q.error;
    return q.data?.[0]||null;
  }
  const isUniqueError=e=>e?.code==='23505'||e?.details?.code==='23505'||/duplicate key|crm_tasks_one_offer_followup/i.test(String(e?.message||''));

  async function ensureOfferFollowupTask(o,newStatus,newDate){
    let existing=await firstOfferFollowupTask(o);
    if(newStatus==='I GANG'&&newDate){
      const scheduled=isoFromInputs(newDate,'09:00');
      const patch={scheduled_at:scheduled,status:'open',assigned_to:o.follow_up_owner||state.session.user.email||'JS',updated_at:new Date().toISOString(),title:`Følg op på tilbud ${o.offer_ref} – ${o.customer_name||''}`,planning_type:'flexible',priority:'A'};
      if(existing){const r=await supabase.from('crm_tasks').update(patch).eq('id',existing.id);if(r.error)throw r.error;return;}
      let r=await supabase.from('crm_tasks').insert({client_id:state.client.id,company_id:o.company_id,lead_id:o.lead_id||null,offer_id:o.id,...patch,task_type:'offer_followup',calendar_sync_status:'none'});
      if(r.error&&isUniqueError(r.error)){
        existing=await firstOfferFollowupTask(o);
        if(!existing)throw r.error;
        r=await supabase.from('crm_tasks').update(patch).eq('id',existing.id);
      }
      if(r.error)throw r.error;
    }else if(existing){
      const r=await supabase.from('crm_tasks').update({status:'done',updated_at:new Date().toISOString()}).eq('id',existing.id);if(r.error)throw r.error;
    }
  }

  async function saveManualOffer(o,newStatus,newDate,newComment,method){
    const prev=o.status,now=new Date().toISOString();
    const patch={status:newStatus,follow_up_date:newDate,current_comment:newComment,status_reason:prev!==newStatus?`Manuelt ændret fra ${prev} til ${newStatus}`:o.status_reason,manual_lock:true,status_source:'manual',status_updated_at:now,updated_at:now};
    const r=await supabase.from('crm_offers').update(patch).eq('id',o.id);if(r.error)throw r.error;
    await ensureOfferFollowupTask(o,newStatus,newDate);
    if(prev!==newStatus&&typeof logOfferActivity==='function')await logOfferActivity(o,'Tilbudsstatus',`${prev} → ${newStatus} (${method})`,{previous:prev,next:newStatus,manual:true,method});
    if(newDate!==o.follow_up_date&&typeof logOfferActivity==='function')await logOfferActivity(o,'Planlægning',`Tilbudsopfølgning flyttet til ${newDate||'ingen dato'}`,{previous:o.follow_up_date,next:newDate,manual:true,method});
  }

  function wireSafeOfferSave(){
    const old=document.getElementById('saveOffer');if(!old||old.dataset.safeOfferSave==='1')return;
    const btn=old.cloneNode(true);btn.dataset.safeOfferSave='1';old.replaceWith(btn);
    btn.onclick=async()=>{
      if(typeof currentOffer==='undefined'||!currentOffer)return;
      const o=currentOffer,newStatus=$('oStatus').value,newDate=$('oFollow').value||null,newComment=$('oComment').value.trim()||null;
      btn.disabled=true;
      try{
        await saveManualOffer(o,newStatus,newDate,newComment,'manuel gem');
        await loadAll();$('offerModal').classList.remove('open');currentOffer=null;toast('Tilbud opdateret');
      }catch(e){console.error('safe offer save failed',e);toast(e?.message||'Tilbuddet kunne ikke gemmes');}
      finally{btn.disabled=false;}
    };
  }

  async function safePipelineMove(id,targetStatus){
    const o=typeof offerById==='function'?offerById(id):state.offers?.find(x=>x.id===id);if(!o||!targetStatus||o.status===targetStatus)return;
    try{
      await saveManualOffer(o,targetStatus,o.follow_up_date||null,o.current_comment||null,'pipeline drag & drop');
      await loadAll();toast(`Tilbud ${o.offer_ref||''} flyttet til ${targetStatus}`);
    }catch(e){console.error('safe offer pipeline move failed',e);toast(e?.message||'Tilbuddet kunne ikke flyttes');await loadAll();}
  }

  function wireSafePipelineDrop(){
    const board=document.getElementById('offerPipelineBoard');if(!board||board.dataset.safeOfferDrop==='1')return;
    board.dataset.safeOfferDrop='1';
    board.addEventListener('drop',e=>{
      if(!e.dataTransfer?.types?.includes('application/x-offer-pipe'))return;
      const col=e.target?.closest?.('[data-offer-pipe-status]');if(!col)return;
      const id=e.dataTransfer.getData('application/x-offer-pipe');if(!id)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      col.classList.remove('dragover');void safePipelineMove(id,col.dataset.offerPipeStatus);
    },true);
  }

  function wire(){
    const a=document.getElementById('offerSearch');if(a){a.placeholder='Søg tilbud, kunde, kontakt, mail, telefon, adresse eller note…';a.oninput=()=>window.renderOffers();}
    const b=document.getElementById('offerPipelineSearch');if(b&&b.dataset.offerSearchV2!=='1'){b.dataset.offerSearchV2='1';b.placeholder='Søg tilbud, kunde, kontakt, mail, telefon, adresse eller note…';b.addEventListener('input',()=>window.renderOfferPipeline?.());}
    wireSafeOfferSave();wireSafePipelineDrop();
  }
  wire();
  new MutationObserver(()=>wire()).observe(document.documentElement,{subtree:true,childList:true});
})();