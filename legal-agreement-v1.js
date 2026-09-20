(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let state=null,busy=false,refreshTimer=null,refreshPromise=null;
async function session(){if(typeof supabase==='undefined')return null;const r=await supabase.auth.getSession();return r.data&&r.data.session?r.data.session:null}
async function edge(payload){
  const s=await session();if(!s||!s.access_token)throw new Error('Login-session mangler');
  const r=await fetch(API+'/functions/v1/legal-agreement',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify(payload||{})});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch(_){d={error:raw}}
  if(!r.ok){const e=new Error(d.error||('HTTP '+r.status));e.code=d.code;e.data=d;e.status=r.status;throw e}
  return d;
}
function style(){
  if($('lmLegalAgreementStyle'))return;
  const s=document.createElement('style');s.id='lmLegalAgreementStyle';
  s.textContent=[
    '#lmLegalAgreementBanner{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:11950;width:min(940px,calc(100vw - 28px));border:1px solid rgba(245,158,11,.5);background:#fff7ed;color:#7c2d12;border-radius:14px;padding:11px 14px;box-shadow:0 12px 34px rgba(15,23,42,.16);display:flex;gap:12px;align-items:center;justify-content:space-between;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}',
    '#lmLegalAgreementBanner button{border:0;border-radius:10px;padding:8px 11px;font-weight:800;cursor:pointer;background:#0f172a;color:#fff}',
    '#lmLegalAgreementModal{position:fixed;inset:0;z-index:14000;background:rgba(2,6,23,.68);backdrop-filter:blur(5px);display:grid;place-items:center;padding:18px;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}',
    '#lmLegalAgreementModal .lmleg-card{width:min(920px,96vw);max-height:92vh;background:#fff;color:#0f172a;border-radius:18px;overflow:hidden;box-shadow:0 26px 80px rgba(0,0,0,.35);display:flex;flex-direction:column}',
    '#lmLegalAgreementModal .lmleg-head,#lmLegalAgreementModal .lmleg-foot{padding:16px 18px;border-bottom:1px solid #e2e8f0}',
    '#lmLegalAgreementModal .lmleg-foot{border-top:1px solid #e2e8f0;border-bottom:0;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}',
    '#lmLegalAgreementModal .lmleg-body{padding:18px;overflow:auto}',
    '#lmLegalAgreementModal pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:55vh;overflow:auto}',
    '#lmLegalAgreementModal button{border:1px solid #cbd5e1;border-radius:10px;padding:9px 13px;font-weight:800;cursor:pointer;background:#fff;color:#0f172a}',
    '#lmLegalAgreementModal button.primary{background:#0f172a;color:#fff;border-color:#0f172a}',
    '#lmLegalAgreementModal button:disabled{opacity:.5;cursor:not-allowed}',
    '#lmLegalAgreementModal input[type="text"],#lmLegalAgreementModal input[type="email"],#lmLegalAgreementModal input[type="url"]{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:9px 10px;font:13px system-ui,-apple-system,Segoe UI,sans-serif}',
    '#lmLegalAgreementModal .lmleg-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}',
    '#lmLegalAgreementModal .lmleg-field label{display:block;font-size:11px;font-weight:800;color:#475569;margin-bottom:4px}',
    '@media(max-width:650px){#lmLegalAgreementModal .lmleg-grid{grid-template-columns:1fr}}',
    '.lmleg-sub{font-size:12px;color:#64748b}',
    '@media(max-width:720px){#lmLegalAgreementBanner{top:7px;padding:9px 10px}#lmLegalAgreementModal{padding:7px}}'
  ].join('');
  document.head.appendChild(s);
}
function clear(){const b=$('lmLegalAgreementBanner');if(b)b.remove();const m=$('lmLegalAgreementModal');if(m)m.remove()}
function banner(msg,button,handler){
  style();let b=$('lmLegalAgreementBanner');if(!b){b=document.createElement('div');b.id='lmLegalAgreementBanner';document.body.appendChild(b)}
  b.innerHTML='<div><strong>Juridisk aftale</strong><div style="margin-top:2px">'+esc(msg)+'</div></div>'+(button?'<button id="lmLegalOpen" type="button">'+esc(button)+'</button>':'');
  const o=$('lmLegalOpen');if(o)o.addEventListener('click',handler||openModal);
}
async function refresh(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{try{
    const s=await session();if(!s){clear();return}
    state=await edge({action:'status'});
    if(!state||!state.agreement_required){clear();return}
    if(state.agreement&&state.agreement.accepted){clear();return}
    const role=String(state.role||'').toLowerCase();
    if(!state.provider_identity_complete){banner('Databehandleraftalen er klargjort, men kan ikke accepteres før Lead Managers juridiske udbyderidentitet er verificeret.',state.platform_admin?'Udfyld juridiske oplysninger':null,state.platform_admin?openIdentityModal:null);return}
    if(!['owner','admin'].includes(role)){banner('Databehandleraftalen afventer accept fra en ejer/admin på jeres konto.',null);return}
    banner('Databehandleraftalen mangler accept. Gennemse og accepter den registrerede version.','Gennemse aftale');
  }catch(e){console.warn('legal agreement status',e)}})();
  try{return await refreshPromise}finally{refreshPromise=null}
}
function scheduleRefresh(delay=0){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{refreshTimer=null;refresh()},delay)}
async function openIdentityModal(){
  if(busy)return;busy=true;
  try{
    const d=await edge({action:'provider_identity_status'}),i=d.identity||{};style();
    const old=$('lmLegalAgreementModal');if(old)old.remove();
    const m=document.createElement('div');m.id='lmLegalAgreementModal';
    m.innerHTML='<div class="lmleg-card">'
      +'<div class="lmleg-head"><div style="font-size:18px;font-weight:900">Juridisk udbyderidentitet</div><div class="lmleg-sub">Disse oplysninger bliver den juridiske databehandlerpart i Lead Managers aftaler. Brug den registrerede juridiske enhed — ikke kun brandnavnet.</div></div>'
      +'<div class="lmleg-body"><div class="lmleg-grid">'
      +'<div class="lmleg-field"><label>Juridisk navn *</label><input id="lmPidLegalName" type="text" value="'+esc(i.legal_name||'')+'" placeholder="Virksomhedens registrerede navn"></div>'
      +'<div class="lmleg-field"><label>CVR *</label><input id="lmPidCvr" type="text" inputmode="numeric" value="'+esc(i.cvr||'')+'" placeholder="8 cifre"></div>'
      +'<div class="lmleg-field"><label>Adresse *</label><input id="lmPidStreet" type="text" value="'+esc(i.street_address||'')+'" placeholder="Vej og nr."></div>'
      +'<div class="lmleg-field"><label>Postnummer *</label><input id="lmPidPostal" type="text" value="'+esc(i.postal_code||'')+'" placeholder="Postnr."></div>'
      +'<div class="lmleg-field"><label>By *</label><input id="lmPidCity" type="text" value="'+esc(i.city||'')+'" placeholder="By"></div>'
      +'<div class="lmleg-field"><label>Land</label><input id="lmPidCountry" type="text" value="'+esc(i.country||'Danmark')+'"></div>'
      +'<div class="lmleg-field"><label>Privacy / GDPR e-mail *</label><input id="lmPidEmail" type="email" value="'+esc(i.privacy_email||'')+'" placeholder="privacy@firma.dk"></div>'
      +'<div class="lmleg-field"><label>Website</label><input id="lmPidWebsite" type="url" value="'+esc(i.website||'')+'" placeholder="https://..."></div>'
      +'</div><label style="display:flex;gap:9px;align-items:flex-start;margin-top:14px"><input id="lmPidAck" type="checkbox" style="margin-top:3px"><span>Jeg bekræfter, at oplysningerne er korrekte for den juridiske enhed, der leverer Lead Manager.</span></label><div id="lmPidMsg" class="lmleg-sub" style="margin-top:9px"></div></div>'
      +'<div class="lmleg-foot"><button id="lmPidClose" type="button">Luk</button><button id="lmPidSave" type="button" class="primary" disabled>Gem og verificér</button></div>'
      +'</div>';
    document.body.appendChild(m);
    const save=$('lmPidSave'),ack=$('lmPidAck');
    ack.onchange=()=>{save.disabled=!ack.checked};
    $('lmPidClose').onclick=()=>m.remove();
    save.onclick=async()=>{
      if(!ack.checked)return;
      save.disabled=true;$('lmPidMsg').textContent='Validerer og gemmer…';
      try{
        const result=await edge({
          action:'save_provider_identity',
          confirm_identity:true,
          identity:{
            legal_name:$('lmPidLegalName').value,
            cvr:$('lmPidCvr').value,
            street_address:$('lmPidStreet').value,
            postal_code:$('lmPidPostal').value,
            city:$('lmPidCity').value,
            country:$('lmPidCountry').value||'Danmark',
            privacy_email:$('lmPidEmail').value,
            website:$('lmPidWebsite').value
          }
        });
        if(!result.verified)throw new Error('Identiteten kunne ikke verificeres.');
        $('lmPidMsg').textContent='✓ Juridisk udbyderidentitet er verificeret.';
        setTimeout(()=>{m.remove();scheduleRefresh(0)},650);
      }catch(e){$('lmPidMsg').textContent=e.message||String(e);save.disabled=false}
    };
  }catch(e){console.warn('provider identity setup',e);banner(e.message||'Juridisk udbyderidentitet kunne ikke åbnes.',null)}
  finally{busy=false}
}
async function openModal(){
  if(busy)return;busy=true;
  try{
    const d=await edge({action:'preview'});state=d;style();
    const old=$('lmLegalAgreementModal');if(old)old.remove();
    const m=document.createElement('div');m.id='lmLegalAgreementModal';
    m.innerHTML='<div class="lmleg-card">'
      +'<div class="lmleg-head"><div style="font-size:18px;font-weight:900">'+esc((d.agreement&&d.agreement.title)||'Databehandleraftale')+'</div><div class="lmleg-sub">Version '+esc((d.agreement&&d.agreement.version)||'')+' · teksten nedenfor er den version, der registreres ved accept.</div></div>'
      +'<div class="lmleg-body"><pre>'+esc(d.rendered_text||'')+'</pre><label style="display:flex;gap:9px;align-items:flex-start;margin-top:12px"><input id="lmLegalAck" type="checkbox" style="margin-top:3px"><span>Jeg har gennemset aftalen og accepterer den på vegne af virksomheden.</span></label><div id="lmLegalMsg" class="lmleg-sub" style="margin-top:9px"></div></div>'
      +'<div class="lmleg-foot"><button id="lmLegalClose" type="button">Luk</button><button id="lmLegalAccept" type="button" class="primary" disabled>Accepter aftale</button></div>'
      +'</div>';
    document.body.appendChild(m);
    $('lmLegalAck').onchange=()=>{$('lmLegalAccept').disabled=!$('lmLegalAck').checked};
    $('lmLegalClose').onclick=()=>m.remove();
    $('lmLegalAccept').onclick=async()=>{
      if(!$('lmLegalAck').checked)return;
      $('lmLegalAccept').disabled=true;$('lmLegalMsg').textContent='Registrerer accept…';
      try{
        await edge({action:'accept',accept_ack:true,version:d.agreement.version,template_hash:d.agreement.template_hash});
        $('lmLegalMsg').textContent='✓ Aftalen er accepteret og dokumenteret.';
        setTimeout(()=>{m.remove();scheduleRefresh(0)},700);
      }catch(e){$('lmLegalMsg').textContent=e.message||String(e);$('lmLegalAccept').disabled=false}
    };
  }catch(e){console.warn('legal agreement preview',e);banner(e.message||'Aftalen kunne ikke åbnes.',null)}
  finally{busy=false}
}
window.addEventListener('lm:central-onboarding-required',()=>scheduleRefresh(900));
if(typeof supabase!=='undefined'&&supabase.auth&&supabase.auth.onAuthStateChange)supabase.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_IN'&&s)scheduleRefresh(900);if(ev==='SIGNED_OUT'){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;clear()}});
scheduleRefresh(1600);
})();