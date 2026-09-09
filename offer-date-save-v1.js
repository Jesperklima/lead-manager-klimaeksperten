(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  let saving=false;
  let dateAtClick=null;

  function current(){try{return typeof currentOffer!=='undefined'?currentOffer:null}catch{return null}}
  function formatDate(value){if(!value)return 'ingen dato';try{return new Intl.DateTimeFormat('da-DK',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value+'T12:00:00'))}catch{return value}}
  function message(text,bad=false){const input=byId('oFollow');if(!input)return;let el=byId('offerDateSaveMessage');if(!el){el=document.createElement('div');el.id='offerDateSaveMessage';el.className='sub';el.style.marginTop='5px';input.insertAdjacentElement('afterend',el)}el.textContent=text||'';el.style.color=bad?'#b33232':''}

  async function save(){
    if(saving)return;
    const o=current();if(!o)return;
    const btn=byId('saveOffer'),old=btn?.textContent||'Gem tilbud';
    const status=byId('oStatus')?.value||o.status;
    const date=(dateAtClick!==null?dateAtClick:String(byId('oFollow')?.value||'').trim())||null;
    const comment=String(byId('oComment')?.value||'').trim()||null;
    const now=new Date().toISOString();
    saving=true;if(btn){btn.disabled=true;btn.textContent='Gemmer…'};message('Gemmer '+formatDate(date)+'…');
    try{
      const r=await supabase.from('crm_offers').update({status,follow_up_date:date,current_comment:comment,status_reason:o.status!==status?`Manuelt ændret fra ${o.status} til ${status}`:o.status_reason,manual_lock:true,status_source:'manual',status_updated_at:now,updated_at:now}).eq('id',o.id).select('id,status,follow_up_date,current_comment').single();
      if(r.error)throw new Error(r.error.message||'Tilbuddet kunne ikke gemmes');
      if((r.data?.follow_up_date||null)!==date)throw new Error('Den valgte dato blev ikke gemt i CRM.');

      const task=(state.tasks||[]).find(t=>t.offer_id===o.id&&t.task_type==='offer_followup');
      if(status==='I GANG'&&date){
        const scheduled=isoFromInputs(date,'09:00');
        let tr;
        if(task)tr=await supabase.from('crm_tasks').update({scheduled_at:scheduled,status:'open',assigned_to:o.follow_up_owner||state.session?.user?.email||'JS',updated_at:now}).eq('id',task.id);
        else tr=await supabase.from('crm_tasks').insert({client_id:state.client.id,company_id:o.company_id,lead_id:o.lead_id||null,offer_id:o.id,title:`Følg op på tilbud ${o.offer_ref} – ${o.customer_name||''}`,task_type:'offer_followup',scheduled_at:scheduled,planning_type:'flexible',status:'open',priority:'A',assigned_to:o.follow_up_owner||state.session?.user?.email||'JS',calendar_sync_status:'none'});
        if(tr.error)throw new Error(tr.error.message||'Opfølgningsopgaven kunne ikke gemmes');
      }else if(task&&task.status==='open'){
        const tr=await supabase.from('crm_tasks').update({status:'done',updated_at:now}).eq('id',task.id);if(tr.error)throw new Error(tr.error.message||'Opfølgningsopgaven kunne ikke afsluttes');
      }

      if(o.status!==status&&typeof logOfferActivity==='function')await logOfferActivity(o,'Tilbudsstatus',`${o.status} → ${status} (manuel gem)`,{previous:o.status,next:status,manual:true,method:'verified_offer_save'});
      if((o.follow_up_date||null)!==date&&typeof logOfferActivity==='function')await logOfferActivity(o,'Planlægning',`Tilbudsopfølgning flyttet til ${date||'ingen dato'}`,{previous:o.follow_up_date||null,next:date,manual:true,method:'verified_offer_save'});
      if(typeof loadAll==='function')await loadAll();
      const check=(state.offers||[]).find(x=>x.id===o.id);
      if(!check||((check.follow_up_date||null)!==date))throw new Error('Datoen blev ikke bekræftet efter genindlæsning.');
      byId('offerModal')?.classList.remove('open');currentOffer=null;if(typeof toast==='function')toast('Tilbud opdateret · opfølgning '+formatDate(date));
    }catch(error){console.error('offer date save failed',error);message(error?.message||'Datoen kunne ikke gemmes',true);if(typeof toast==='function')toast(error?.message||'Tilbuddet kunne ikke gemmes')}
    finally{dateAtClick=null;saving=false;if(btn){btn.disabled=false;btn.textContent=old}}
  }

  function bind(){const input=byId('oFollow');if(input&&input.dataset.offerDateFix!=='1'){input.dataset.offerDateFix='1';const changed=()=>message('Valgt: '+formatDate(input.value||null)+' · gemmes med “Gem tilbud”');input.addEventListener('input',changed);input.addEventListener('change',changed);input.addEventListener('blur',changed)}}
  document.addEventListener('pointerdown',e=>{if(e.target?.closest?.('#saveOffer'))dateAtClick=String(byId('oFollow')?.value||'').trim()},true);
  document.addEventListener('click',e=>{if(!e.target?.closest?.('#saveOffer'))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();void save()},true);
  bind();new MutationObserver(bind).observe(document.documentElement,{subtree:true,childList:true});
})();