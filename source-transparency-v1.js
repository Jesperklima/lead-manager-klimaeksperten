(()=>{
  const text=v=>v==null?'':String(v).trim();
  const esc=s=>text(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt=d=>{if(!d)return'';try{return new Intl.DateTimeFormat('da-DK',{dateStyle:'medium'}).format(new Date(d))}catch{return text(d)}};
  const normUrl=v=>{v=text(v);return !v?'':/^https?:\/\//i.test(v)?v:'https://'+v};
  const ev=l=>(l&&l.source_verification_evidence&&typeof l.source_verification_evidence==='object')?l.source_verification_evidence:{};
  const first=(...xs)=>xs.find(x=>text(x))||'';
  function typeLabel(l,e){return first(l?.source,e.source_label,e.source_type,'Dokumenteret kilde')}
  function statusLabel(e){
    const s=text(e.freshness_state);
    if(s==='recheck_required')return ['Skal genverificeres','warn'];
    if(s==='deadline_expired')return ['Udbudsfrist udløbet','bad'];
    if(s==='closed')return ['Afsluttet','bad'];
    if(s==='current')return ['Aktuel kilde','ok'];
    return ['Ikke genverificeret endnu','warn'];
  }
  function render(){
    try{
      if(typeof currentLead==='undefined'||!currentLead)return;
      const l=currentLead,e=ev(l),box=document.getElementById('contactBlock');
      if(!box)return;
      box.querySelector('[data-lead-source-transparency]')?.remove();
      if((l.lead_pool||'')!=='documented_opportunity'&&!l.source_url&&!l.source_reference)return;
      const [freshLabel,freshClass]=statusLabel(e);
      const sourceDate=first(e.status_verified_at,e.status_checked_at,e.status_source_date,e.published_date,e.publication_date,e.decision_date,e.source_date);
      const latest=first(e.latest_official_status,e.project_stage,e.opportunity_stage);
      const ref=text(l.source_reference);
      const url=text(l.source_url);
      const el=document.createElement('div');
      el.dataset.leadSourceTransparency='1';
      el.style.cssText='margin:0 0 14px;padding:14px;border:1px solid var(--border);border-radius:12px;background:#f8fafb';
      el.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><strong>Kilde til leadet</strong><div class="sub" style="margin-top:3px">'+esc(typeLabel(l,e))+'</div></div><span class="badge '+(freshClass==='ok'?'ok':freshClass==='warn'?'warn':'a')+'">'+esc(freshLabel)+'</span></div>'+
        (ref?'<div style="margin-top:9px"><strong>'+esc(ref)+'</strong></div>':'')+
        (url?'<div style="margin-top:7px"><a target="_blank" rel="noopener" href="'+esc(normUrl(url))+'">Åbn original kilde →</a></div>':'<div class="notice" style="margin-top:8px">Originalt kildelink mangler.</div>')+
        (sourceDate?'<div class="sub" style="margin-top:7px">Senest dokumenterede dato: '+esc(fmt(sourceDate))+'</div>':'')+
        (latest?'<div class="sub" style="margin-top:5px">Dokumenteret status: '+esc(latest)+'</div>':'')+
        (text(e.freshness_state)==='recheck_required'?'<div class="notice" style="margin-top:8px"><strong>Ikke klar til kontakt.</strong> Sagen er flyttet til Under vurdering, indtil en nyere officiel kilde har bekræftet, at den stadig er aktiv.</div>':'');
      box.prepend(el);
    }catch(err){console.warn('source transparency',err)}
  }
  function install(){
    if(typeof openLead==='function'&&!openLead.__sourceTransparencyWrapped){
      const original=openLead;
      const wrapped=function(id){const r=original.apply(this,arguments);setTimeout(render,40);return r};
      wrapped.__sourceTransparencyWrapped=true;
      openLead=wrapped;
    }
    document.addEventListener('click',e=>{if(e.target?.closest?.('[data-open-lead]'))setTimeout(render,80)},true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  setTimeout(install,500);
})();
