(()=>{
  'use strict';
  const REASONS=[
    ['wrong_industry','Forkert branche'],
    ['wrong_need','Forkert opgavetype / behov'],
    ['too_small','Virksomheden er for lille'],
    ['too_large','Virksomheden er for stor'],
    ['wrong_geography','Forkert geografi'],
    ['provider_not_buyer','Konkurrent / leverandør – ikke køber'],
    ['no_real_need','Intet reelt behov / købssignal'],
    ['already_customer','Allerede kunde / kendt virksomhed'],
    ['other','Andet']
  ];
  let busy=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const leadBy=id=>{try{return typeof leadById==='function'?leadById(id):(state?.leads||[]).find(x=>x.id===id)}catch{return null}};
  const leadTitle=l=>{try{return typeof leadName==='function'?leadName(l):'leadet'}catch{return 'leadet'}};
  async function rpc(leadId,reasonCode,reasonText){
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token)throw new Error('Login-session mangler');
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_mark_lead_irrelevant`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({p_lead_id:leadId,p_reason_code:reasonCode,p_reason_text:reasonText||null})
    });
    const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}};
    if(!r.ok)throw new Error(data?.message||data?.error||`HTTP ${r.status}`);
    return data;
  }
  function ensureModal(){
    if(document.getElementById('lmIrrelevantBack'))return;
    const html=`<div class="modalback" id="lmIrrelevantBack" style="z-index:120"><div class="modal" style="width:min(620px,94vw)"><h2 style="margin:0 0 6px">Hvorfor er leadet ikke relevant?</h2><div class="sub" id="lmIrrelevantLeadName">Din begrundelse bruges kun til denne kundes Lead Hunter.</div><div class="field" style="margin-top:14px"><label>Vælg den vigtigste årsag *</label><select id="lmIrrelevantReason"><option value="">Vælg årsag…</option>${REASONS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></div><div class="field"><label>Suppler gerne med en kort forklaring</label><textarea id="lmIrrelevantText" rows="4" placeholder="Fx: Vi vil kun have virksomheder med mindst 20 medarbejdere, eller denne branche køber ikke vores løsning."></textarea></div><div class="notice" style="margin:10px 0">Den konkrete virksomhed bliver blokeret med det samme. Når årsagen kan omsættes sikkert til et kriterium, skærpes denne kundes søgeprofil også.</div><div id="lmIrrelevantMsg" class="sub" style="min-height:20px"></div><div class="split" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="lmIrrelevantCancel">Annuller</button><button class="btn primary" id="lmIrrelevantSave">Gem som ikke relevant</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);
  }
  function ask(lead){
    ensureModal();
    return new Promise(resolve=>{
      const back=document.getElementById('lmIrrelevantBack'),reason=document.getElementById('lmIrrelevantReason'),text=document.getElementById('lmIrrelevantText'),msg=document.getElementById('lmIrrelevantMsg'),save=document.getElementById('lmIrrelevantSave'),cancel=document.getElementById('lmIrrelevantCancel');
      document.getElementById('lmIrrelevantLeadName').textContent=`${leadTitle(lead)} · feedback gælder kun denne kundes Lead Hunter.`;
      reason.value='';text.value='';msg.textContent='';save.disabled=false;back.classList.add('open');
      const finish=v=>{back.classList.remove('open');save.onclick=null;cancel.onclick=null;resolve(v)};
      cancel.onclick=()=>finish(null);
      save.onclick=()=>{const code=reason.value,detail=text.value.trim();if(!code){msg.textContent='Vælg en årsag først.';return}if(code==='other'&&!detail){msg.textContent='Skriv kort hvorfor leadet ikke er relevant.';return}finish({code,detail})};
    });
  }
  async function markIrrelevant(lead,source='status'){
    if(busy||!lead?.id)return false;
    const answer=await ask(lead);if(!answer)return false;
    busy=true;
    try{
      const result=await rpc(lead.id,answer.code,answer.detail);
      if(typeof loadAll==='function')await loadAll();
      if(typeof openLead==='function'&&document.getElementById('drawer')?.classList.contains('open'))openLead(lead.id);
      if(typeof toast==='function')toast(result?.learned_into_profile?'Lead markeret ikke relevant · søgeprofilen er skærpet':'Lead markeret ikke relevant · virksomheden er blokeret fremover');
      return true;
    }catch(e){console.error('irrelevant learning',e);if(typeof toast==='function')toast(e?.message||'Kunne ikke gemme årsagen');return false}
    finally{busy=false}
  }
  function patchDrag(){
    if(typeof window.movePipelineLead!=='function'||window.movePipelineLead.__irrelevantLearning)return;
    const original=window.movePipelineLead;
    const wrapped=async function(id,targetStatus){if(targetStatus!=='IKKE RELEVANT')return original(id,targetStatus);const lead=leadBy(id);if(!lead||lead.status===targetStatus)return;await markIrrelevant(lead,'pipeline_drag_drop')};
    wrapped.__irrelevantLearning=true;wrapped.__original=original;window.movePipelineLead=wrapped;
  }
  function patchDrawer(){
    const select=document.getElementById('dStatus');if(!select||select.dataset.irrelevantLearning==='1')return;
    select.dataset.irrelevantLearning='1';
    const previous=select.onchange;
    select.onchange=async()=>{
      const lead=(()=>{try{return currentLead}catch{return null}})(),target=select.value,old=lead?.status;
      if(target!=='IKKE RELEVANT'){if(typeof previous==='function')return previous.call(select);return}
      select.disabled=true;
      const ok=await markIrrelevant(lead,'lead_drawer_dropdown');
      select.disabled=false;
      if(!ok){select.value=old||'';try{if(typeof statusExtras==='function')statusExtras()}catch{}}
    };
  }
  function install(){patchDrag();patchDrawer()}
  document.addEventListener('click',()=>setTimeout(install,0),true);
  new MutationObserver(()=>install()).observe(document.documentElement,{subtree:true,childList:true});
  setInterval(install,800);setTimeout(install,100);
})();