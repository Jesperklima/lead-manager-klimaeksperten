(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let lastClient=null,lastData=null,busy=false;
function clientId(){try{return state?.client?.id||null}catch{return null}}
function admin(){try{return !!window.LMPlatformAdmin?.active}catch{return false}}
function host(){return document.querySelector('#lmSystemView .lm-system-grid')}
function card(){let el=document.getElementById('lmComplianceCard');if(!el){el=document.createElement('div');el.id='lmComplianceCard';el.className='lm-system-card';host()?.appendChild(el)}return el}
function statusLine(label,value,kind=''){const cls=kind==='ok'?'color:#166534':kind==='warn'?'color:#92400e':kind==='bad'?'color:#991b1b':'';return `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-top:1px solid #e8eef2"><span>${esc(label)}</span><strong style="${cls}">${esc(value)}</strong></div>`}
function blockerList(items){if(!Array.isArray(items)||!items.length)return '<div class="sub" style="margin-top:10px;color:#166534"><strong>Ingen launch-blockers registreret.</strong></div>';return `<div style="margin-top:10px"><div class="sub"><strong>Launch-blockers</strong></div>${items.map(x=>`<div style="padding:7px 0;border-top:1px solid #e8eef2;color:${x?.severity==='high'?'#991b1b':'#92400e'}"><strong>${esc(x?.code||'kontrol')}</strong><br><span class="sub">${esc(x?.message||'Kræver review')}</span></div>`).join('')}</div>`}
function render(data,error){const el=card();if(!el)return;if(error){el.innerHTML=`<span class="lm-system-tag">Compliance</span><h2>GDPR & AI</h2><div class="sub">Compliance-status kunne ikke hentes.</div><div class="status">${esc(error)}</div>`;return}
 const ai=data?.ai_governance||{},subs=Array.isArray(data?.subprocessors)?data.subprocessors:[],blockers=Array.isArray(data?.launch_blockers)?data.launch_blockers:[];
 const vendorReview=subs.filter(x=>String(x?.dpa_status||'').toLowerCase()==='verify').length;
 const google=subs.find(x=>x?.provider==='Google')||{};
 const googleOauth=String(google?.oauth_verification_status||'required').toLowerCase();
 const googleSecurity=String(google?.security_assessment_status||'required').toLowerCase();
 const gmailReady=googleOauth==='verified'&&(googleSecurity==='verified'||googleSecurity==='not_applicable');
 const provenance=Number(data?.provenance_gaps||0),privacy=Number(data?.privacy_requests_open||0),review=Number(data?.retention_review_due||0),quarantine=Number(data?.retention_quarantined||0),incidents=Number(data?.open_compliance_incidents||0);
 const aiSafe=ai.human_review_required===true&&ai.ai_may_send_without_approval===false&&ai.ai_may_make_legal_effect_decisions===false&&ai.personal_credit_scoring_allowed===false;
 const launchReady=data?.launch_ready===true;
 el.innerHTML=`<span class="lm-system-tag">Compliance</span><h2>GDPR & AI</h2><div class="sub">Live kontrol af provenance, retention, rettigheder, AI-regler og eksterne launch-krav.</div><div style="margin:10px 0;padding:10px 12px;border-radius:10px;background:${launchReady?'#ecfdf5':'#fff7ed'};color:${launchReady?'#166534':'#9a3412'}"><strong>${launchReady?'KLAR TIL COMPLIANCE-LAUNCH':'LAUNCH BLOKERET'}</strong><div class="sub" style="margin-top:3px">${launchReady?'Alle registrerede gates er bestået.':'Der er '+blockers.length+' aktiv(e) compliance-blocker(e).'}</div></div><div class="status">${statusLine('Kilder til review',provenance,provenance?'warn':'ok')}${statusLine('Åbne privacy-sager',privacy,privacy?'warn':'ok')}${statusLine('Retention forfalden',review,review?'warn':'ok')}${statusLine('I karantæne',quarantine,quarantine?'warn':'ok')}${statusLine('Compliance-hændelser',incidents,incidents?'bad':'ok')}${statusLine('AI human review',aiSafe?'Låst til':'KONTROLLÉR',aiSafe?'ok':'bad')}${statusLine('Leverandør/DPA-review mangler',vendorReview,vendorReview?'warn':'ok')}${statusLine('Google OAuth-verifikation',googleOauth==='verified'?'VERIFICERET':googleOauth.toUpperCase(),googleOauth==='verified'?'ok':'warn')}${statusLine('Google/CASA sikkerhed',googleSecurity==='verified'||googleSecurity==='not_applicable'?googleSecurity.toUpperCase():googleSecurity.toUpperCase(),googleSecurity==='verified'||googleSecurity==='not_applicable'?'ok':'warn')}${statusLine('Gmail bred launch',gmailReady?'KLAR':'BLOKERET',gmailReady?'ok':'bad')}</div>${blockerList(blockers)}<div class="actions"><a class="btn" href="/privacy" target="_blank" rel="noopener">Privatlivsside</a><button class="btn" id="lmComplianceRefresh" type="button">Opdatér</button></div><div class="sub" style="margin-top:9px">DPA-status og Google-verifikation er separate kontroller. Gmail kan ikke blive grøn alene fordi Googles DPA er dokumenteret.</div>`;
 document.getElementById('lmComplianceRefresh')?.addEventListener('click',()=>load(true),{once:true});
}
async function load(force=false){if(!admin()||!host()||busy)return;const id=clientId();if(!id)return;if(!force&&lastClient===id&&lastData){render(lastData);return}busy=true;try{const {data,error}=await supabase.rpc('crm_compliance_dashboard',{p_client_id:id});if(error)throw error;lastClient=id;lastData=data;render(data)}catch(e){render(null,e?.message||String(e))}finally{busy=false}}
function tick(){if(admin()&&host()){card();load(false)}}
new MutationObserver(()=>setTimeout(tick,0)).observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('lm:client-switched',()=>{lastClient=null;lastData=null;setTimeout(()=>load(true),50)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(tick,400),{once:true});else setTimeout(tick,400);
window.LMComplianceAdmin={refresh:()=>load(true)};
})();
