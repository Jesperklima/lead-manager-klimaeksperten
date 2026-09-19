(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let state=null,busy=false,refreshPromise=null,lastRefreshAt=0;
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
    '.lmleg-sub{font-size:12px;color:#64748b}',
    '@media(max-width:720px){#lmLegalAgreementBanner{top:7px;padding:9px 10px}#lmLegalAgreementModal{padding:7px}}'
  ].join('');
  document.head.appendChild(s);
}
function clear(){const b=$('lmLegalAgreementBanner');if(b)b.remove();const m=$('lmLegalAgreementModal');if(m)m.remove()}
function banner(msg,button){
  style();let b=$('lmLegalAgreementBanner');if(!b){b=document.createElement('div');b.id='lmLegalAgreementBanner';document.body.appendChild(b)}
  b.innerHTML='<div><strong>Juridisk aftale</strong><div style="margin-top:2px">'+esc(msg)+'</div></div>'+(button?'<button id="lmLegalOpen" type="button">'+esc(button)+'</button>':'');
  const o=$('lmLegalOpen');if(o)o.addEventListener('click',openModal);
}
async function refresh(force=false){
  if(refreshPromise)return refreshPromise;
  if(!force&&lastRefreshAt&&Date.now()-lastRefreshAt<10000)return state;
  refreshPromise=(async()=>{
  try{
    const s=await session();if(!s){clear();return}
    state=await edge({action:'status'});
    if(!state||!state.agreement_required){clear();return}
    if(state.agreement&&state.agreement.accepted){clear();return}
    const role=String(state.role||'').toLowerCase();
    if(!state.provider_identity_complete){banner('Databehandleraftalen er klargjort, men kan ikke accepteres før Lead Managers juridiske udbyderidentitet er verificeret.',null);return}
    if(!['owner','admin'].includes(role)){banner('Databehandleraftalen afventer accept fra en ejer/admin på jeres konto.',null);return}
    banner('Databehandleraftalen mangler accept. Gennemse og accepter den registrerede version.','Gennemse aftale');
  }catch(e){console.warn('legal agreement status',e)}
  finally{lastRefreshAt=Date.now()}
  return state
  })();
  try{return await refreshPromise}finally{refreshPromise=null}
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
        setTimeout(()=>{m.remove();refresh()},700);
      }catch(e){$('lmLegalMsg').textContent=e.message||String(e);$('lmLegalAccept').disabled=false}
    };
  }catch(e){console.warn('legal agreement preview',e);banner(e.message||'Aftalen kunne ikke åbnes.',null)}
  finally{busy=false}
}
window.addEventListener('lm:central-onboarding-required',()=>setTimeout(refresh,1200));
if(typeof supabase!=='undefined'&&supabase.auth&&supabase.auth.onAuthStateChange)supabase.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_IN'&&s)setTimeout(refresh,1200);if(ev==='SIGNED_OUT')clear()});
setTimeout(refresh,1400);setTimeout(refresh,4000);
})();