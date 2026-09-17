(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let lastClient=null,lastData=null,busy=false;
function clientId(){try{return state?.client?.id||null}catch{return null}}
function admin(){try{return !!window.LMPlatformAdmin?.active}catch{return false}}
function host(){return document.querySelector('#lmSystemView .lm-system-grid')}
function card(){let el=document.getElementById('lmComplianceCard');if(!el){el=document.createElement('div');el.id='lmComplianceCard';el.className='lm-system-card';host()?.appendChild(el)}return el}
function statusLine(label,value,kind=''){const cls=kind==='ok'?'color:#166534':kind==='warn'?'color:#92400e':kind==='bad'?'color:#991b1b':'';return `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-top:1px solid #e8eef2"><span>${esc(label)}</span><strong style="${cls}">${esc(value)}</strong></div>`}
function render(data,error){const el=card();if(!el)return;if(error){el.innerHTML=`<span class="lm-system-tag">Compliance</span><h2>GDPR & AI</h2><div class="sub">Compliance-status kunne ikke hentes.</div><div class="status">${esc(error)}</div>`;return}
 const ai=data?.ai_governance||{},subs=Array.isArray(data?.subprocessors)?data.subprocessors:[];
 const unverified=subs.filter(x=>String(x?.dpa_status||'').toLowerCase()!=='verified').length;
 const provenance=Number(data?.provenance_gaps||0),privacy=Number(data?.privacy_requests_open||0),review=Number(data?.retention_review_due||0),quarantine=Number(data?.retention_quarantined||0),incidents=Number(data?.open_compliance_incidents||0);
 const aiSafe=ai.human_review_required===true&&ai.ai_may_send_without_approval===false&&ai.ai_may_make_legal_effect_decisions===false&&ai.personal_credit_scoring_allowed===false;
 const gmailReady=subs.some(x=>x.provider==='Google'&&String(x.dpa_status||'').toLowerCase()==='verified');
 el.innerHTML=`<span class="lm-system-tag">Compliance</span><h2>GDPR & AI</h2><div class="sub">Live kontrol af provenance, retention, rettigheder, AI-regler og leverandører.</div><div class="status" style="margin-top:10px">${statusLine('Kilder til review',provenance,provenance?'warn':'ok')}${statusLine('Åbne privacy-sager',privacy,privacy?'warn':'ok')}${statusLine('Retention forfalden',review,review?'warn':'ok')}${statusLine('I karantæne',quarantine,quarantine?'warn':'ok')}${statusLine('Compliance-hændelser',incidents,incidents?'bad':'ok')}${statusLine('AI human review',aiSafe?'Låst til':'KONTROLLÉR',aiSafe?'ok':'bad')}${statusLine('Leverandører ikke verificeret',unverified,unverified?'warn':'ok')}${statusLine('Google/Gmail launch',gmailReady?'DPA-status verificeret':'EKSTERN VERIFIKATION MANGLER',gmailReady?'ok':'warn')}</div><div class="actions"><a class="btn" href="/privacy" target="_blank" rel="noopener">Privatlivsside</a><button class="btn" id="lmComplianceRefresh" type="button">Opdatér</button></div><div class="sub" style="margin-top:9px">Gmail readonly er restricted scope. Bred ekstern udrulning må ikke markeres klar, før Google-verifikation/sikkerhedsvurdering og dokumentation er på plads.</div>`;
 document.getElementById('lmComplianceRefresh')?.addEventListener('click',()=>load(true),{once:true});
}
async function load(force=false){if(!admin()||!host()||busy)return;const id=clientId();if(!id)return;if(!force&&lastClient===id&&lastData){render(lastData);return}busy=true;try{const {data,error}=await supabase.rpc('crm_compliance_dashboard',{p_client_id:id});if(error)throw error;lastClient=id;lastData=data;render(data)}catch(e){render(null,e?.message||String(e))}finally{busy=false}}
function tick(){if(admin()&&host()){card();load(false)}}
new MutationObserver(()=>setTimeout(tick,0)).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('lm:client-switched',()=>{lastClient=null;lastData=null;setTimeout(()=>load(true),50)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(tick,400),{once:true});else setTimeout(tick,400);
window.LMComplianceAdmin={refresh:()=>load(true)};
})();
