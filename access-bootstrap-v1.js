(()=>{
'use strict';
let bootPromise=null,rescuePromise=null,onboardingScriptPromise=null,adminBundlesPromise=null,settingsHubPromise=null,regressionCenterPromise=null,feedbackBundlePromise=null,creditCheckPromise=null,offerSearchPromise=null,mfaGatePromise=null;
const ADMIN_BUNDLES=[
 '/saas-platform-admin-v1.js?v=20260919-4',
 '/saas-compliance-admin-v1.js?v=20260919-6',
 '/saas-admin-client-switcher-v1.js?v=20260920-3',
 '/saas-admin-users-v1.js?v=20260919-3',
 '/saas-impersonation-v1.js?v=20260919-2',
 '/saas-marketing-connections-v1.js?v=20260919-4',
 '/saas-admin-ops-v2.js?v=20260920-1'
];
function loadLazyScript(src){
 return new Promise((resolve,reject)=>{
  if(document.querySelector('script[src="'+src+'"]')){resolve();return}
  const script=document.createElement('script');script.src=src;script.async=true;
  script.onload=()=>resolve();script.onerror=()=>reject(new Error('Modul kunne ikke indlæses: '+src));
  document.head.appendChild(script);
 });
}
function ensureMfaGate(){
 if(window.LMMfaGate)return Promise.resolve(window.LMMfaGate);
 if(mfaGatePromise)return mfaGatePromise;
 mfaGatePromise=loadLazyScript('/mfa-gate-v1.js?v=20260920-1').then(()=>window.LMMfaGate).catch(error=>{mfaGatePromise=null;throw error});
 return mfaGatePromise;
}
function ensureAdminBundles(){
 if(adminBundlesPromise)return adminBundlesPromise;
 adminBundlesPromise=Promise.all(ADMIN_BUNDLES.map(loadLazyScript)).catch(error=>{adminBundlesPromise=null;throw error});
 return adminBundlesPromise;
}
function ensureSettingsHub(){
 if(settingsHubPromise)return settingsHubPromise;
 const scripts=['/saas-settings-hub-v1.js?v=20260920-17','/saas-mail-providers-v1.js?v=20260919-3','/saas-gmail-platform-ui-v1.js?v=20260919-4','/saas-minuba-v1.js?v=20260919-3','/saas-mail-sender-name-v1.js?v=20260919-3','/saas-crm-integrations-v1.js?v=20260920-8','/saas-website-intake-v1.js?v=20260920-1','/saas-integrations-overview-v2.js?v=20260920-1'];
 settingsHubPromise=Promise.all(scripts.map(loadLazyScript)).catch(error=>{settingsHubPromise=null;throw error});
 return settingsHubPromise;
}
function settingsReturnCallback(){
 const q=new URLSearchParams(location.search);
 return !!(q.get('microsoft')||q.get('gmail')||q.get('google')||q.has('minuba'));
}
function ensureRegressionCenter(){
 if(regressionCenterPromise)return regressionCenterPromise;
 regressionCenterPromise=loadLazyScript('/saas-regression-center-v1.js?v=20260919-4').catch(error=>{regressionCenterPromise=null;throw error});
 return regressionCenterPromise;
}
function ensureFeedbackBundle(){
 if(feedbackBundlePromise)return feedbackBundlePromise;
 feedbackBundlePromise=Promise.all([
  loadLazyScript('/saas-feedback-v1.js?v=20260919-5'),
  ensureRegressionCenter()
 ]).catch(error=>{feedbackBundlePromise=null;throw error});
 return feedbackBundlePromise;
}
function ensureCreditCheck(){
 if(creditCheckPromise)return creditCheckPromise;
 creditCheckPromise=loadLazyScript('/saas-credit-check-v1.js?v=20260919-3').catch(error=>{creditCheckPromise=null;throw error});
 return creditCheckPromise;
}
function ensureOfferSearch(){
 if(offerSearchPromise)return offerSearchPromise;
 offerSearchPromise=Promise.all([
  loadLazyScript('/saas-offer-search-controls-v2.js?v=20260919-4'),
  loadLazyScript('/date-picker-click-v1.js?v=20260919-4')
 ]).catch(error=>{offerSearchPromise=null;throw error});
 return offerSearchPromise;
}
function onboardingToken(){return new URLSearchParams(location.search).get('onboarding')||''}
function ensureOnboardingScript(){
 if(onboardingScriptPromise)return onboardingScriptPromise;
 onboardingScriptPromise=(async()=>{
  if(!window.__LM_ONBOARDING_V6)await loadLazyScript('/saas-onboarding-v6.js?v=20260922-atomic-2');
  await loadLazyScript('/saas-onboarding-mail-account-sync-v1.js?v=20260919-3');
 })().catch(error=>{onboardingScriptPromise=null;throw error});
 return onboardingScriptPromise;
}
async function centralBootstrap(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)return {authenticated:false,next_route:'login'};
 const {data,error}=await supabase.rpc('crm_session_bootstrap');
 if(error)throw new Error(error.message||'Adgangskontrol fejlede');
 return data||{authenticated:false,next_route:'login'};
}
async function openWorkspace(access){
 const email=state.session?.user?.email||'';
 const preferred=access.platform_admin?(localStorage.getItem('lm_admin_active_client_v1')||localStorage.getItem('lm_admin_client_id')||''):'';
 let clientId=access.workspace_id||null;
 let cr=null;
 const valid=r=>!r?.error&&Array.isArray(r?.data)&&r.data.length>0;
 const fetchClient=async id=>{
  if(!id)return {data:[],error:null};
  return await supabase.from('crm_clients').select('*').eq('id',id).limit(1);
 };

 if(!access.platform_admin&&access.client&&String(access.client.id)===String(clientId)){
  cr={data:[access.client],error:null};
 }else if(access.platform_admin){
  const candidates=[];
  if(preferred)candidates.push(preferred);
  if(access.workspace_id&&!candidates.some(id=>String(id)===String(access.workspace_id)))candidates.push(access.workspace_id);
  for(const candidate of candidates){
   const result=await fetchClient(candidate);
   if(valid(result)){clientId=candidate;cr=result;break}
   if(String(candidate)===String(preferred)&&!result.error){
    localStorage.removeItem('lm_admin_active_client_v1');
    localStorage.removeItem('lm_admin_client_id');
   }
  }
  if(!valid(cr)){
   const fallback=await supabase.from('crm_clients').select('*').order('created_at',{ascending:true}).limit(1);
   if(valid(fallback)){
    cr=fallback;
    clientId=fallback.data[0].id;
    localStorage.setItem('lm_admin_active_client_v1',String(clientId));
   }else if(fallback.error){
    cr=fallback;
   }
  }
 }else if(clientId){
  cr=await fetchClient(clientId);
 }

 if(!clientId||!valid(cr))throw new Error(cr?.error?.message||'Workspace kunne ikke hentes');
 state.client=cr.data[0];
 const fallbackRole=access.platform_admin?'platform_admin':access.role==='workspace_owner'?'owner':access.role==='workspace_admin'?'admin':'member';
 state.userMap=access.membership||{email,client_id:clientId,role:fallbackRole,active:true,auth_user_id:state.session?.user?.id||null};
 document.body.dataset.lmRole=access.role||'';document.body.dataset.lmPlatformAdmin=access.platform_admin?'1':'0';
 document.getElementById('lmOb4')?.remove();document.getElementById('lmObError')?.remove();document.getElementById('lmBootRescueError')?.remove();
 showApp();
 if(document.getElementById('brandClient'))document.getElementById('brandClient').textContent=state.client.name+' · '+(access.platform_admin?'Platform admin':'Kundeworkspace');
 try{await loadAll({startup:true})}catch(loadErr){console.error('CRM dataindlæsning',loadErr);if(typeof toast==='function')toast('Workspace åbnet, men nogle data kunne ikke hentes endnu.')}
 window.dispatchEvent(new CustomEvent('lm:workspace-ready',{detail:{client_id:state.client?.id||clientId,platform_admin:!!access.platform_admin}}));
 if(!access.platform_admin&&document.getElementById('leadmanager')?.classList.contains('active'))ensureSettingsHub().catch(error=>console.warn('settings lazy load',error));
}
async function controlledStartApp(){
 if(onboardingToken())return;
 if(bootPromise)return bootPromise;
 bootPromise=(async()=>{
  const loading=document.getElementById('loading');if(loading)loading.classList.remove('hidden');
  try{
   let access=await centralBootstrap();
   const activating=new URLSearchParams(location.search).get('activated')==='1';
   if(activating&&access.authenticated&&access.next_route==='onboarding'){
    for(let i=0;i<5&&access.next_route==='onboarding';i++){await new Promise(r=>setTimeout(r,300));access=await centralBootstrap()}
   }
   window.LM_ACCESS=access;
   if(!access.authenticated){showAuth();return}
   if(access.next_route==='mfa'||(access.mfa_required===true&&access.mfa_satisfied!==true)){
    const gate=await ensureMfaGate();
    if(!gate?.show)throw new Error('MFA-modulet kunne ikke indlæses');
    await gate.show(access);
    return;
   }
   if(access.platform_admin)await ensureAdminBundles();
   window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
   if(access.next_route==='denied'){showAuth('Denne konto har ikke adgang til et workspace.');await supabase.auth.signOut();return}
   if(access.next_route==='onboarding'){
    await ensureOnboardingScript();
    document.getElementById('authScreen')?.classList.add('hidden');document.getElementById('appShell')?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('lm:central-onboarding-required',{detail:access}));
    return;
   }
   if(activating){const u=new URL(location.href);u.searchParams.delete('activated');history.replaceState({},'',u.pathname+(u.search||''))}
   await openWorkspace(access);
  }catch(e){console.error('Central adgangskontrol',e);showAuth('Lead Manager kunne ikke kontrollere din adgang. '+(e.message||e));}
  finally{if(loading)loading.classList.add('hidden');bootPromise=null}
 })();return bootPromise;
}
async function rescueActiveWorkspace(){
 if(onboardingToken())return;
 if(rescuePromise)return rescuePromise;
 if(bootPromise)return null;
 if(['onboarding','denied','login','mfa'].includes(window.LM_ACCESS?.next_route||''))return null;
 const app=document.getElementById('appShell');if(!app||!app.classList.contains('hidden'))return;
 rescuePromise=(async()=>{try{
  const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)return;
  state.session=session;
  const access=await centralBootstrap();window.LM_ACCESS=access;if(access.platform_admin)await ensureAdminBundles();window.dispatchEvent(new CustomEvent('lm:access-ready',{detail:access}));
  if(access.authenticated&&access.next_route==='app'){
   await openWorkspace(access);
   app.classList.remove('hidden');document.getElementById('authScreen')?.classList.add('hidden');
  }
 }catch(e){
  console.error('Workspace rescue',e);
  if(document.getElementById('lmBootRescueError'))return;
  const x=document.createElement('div');x.id='lmBootRescueError';x.style.cssText='position:fixed;inset:0;z-index:15000;background:#f5f7fb;display:grid;place-items:center;padding:24px';
  x.innerHTML='<div style="max-width:620px;background:#fff;padding:28px;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.12)"><h2>Lead Manager kunne ikke åbne workspace</h2><p id="lmBootRescueMsg"></p><button class="btn primary" type="button" onclick="location.reload()">Prøv igen</button></div>';
  document.body.appendChild(x);document.getElementById('lmBootRescueMsg').textContent=e?.message||String(e);
 }finally{rescuePromise=null}})();
 return rescuePromise;
}
startApp=controlledStartApp;
window.LMAccess={bootstrap:centralBootstrap,start:controlledStartApp,rescue:rescueActiveWorkspace,loadMfa:ensureMfaGate,loadOnboarding:ensureOnboardingScript,loadAdmin:ensureAdminBundles,loadSettings:ensureSettingsHub,loadRegression:ensureRegressionCenter,loadFeedback:ensureFeedbackBundle,loadCredit:ensureCreditCheck,loadOfferSearch:ensureOfferSearch};

function activateNavView(button){
 if(!button)return false;
 const viewId=String(button.dataset?.view||'');
 if(!viewId)return false;
 const view=document.getElementById(viewId);
 if(!view)return false;
 document.querySelectorAll('.nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button));
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===view));
 const label=button.textContent?.trim()||viewId;
 if(typeof setText==='function')setText('title',label);
 else{const title=document.getElementById('title');if(title)title.textContent=label}
 window.dispatchEvent(new CustomEvent('lm:navigation-changed',{detail:{view:viewId}}));
 return true;
}

async function hydrateNavView(viewId){
 if(viewId==='leadmanager'){
  await ensureSettingsHub();
  if(document.getElementById('leadmanager')?.classList.contains('active'))window.dispatchEvent(new Event('lm:settings-open-request'));
  return;
 }
 if(viewId==='feedback'){
  await ensureFeedbackBundle();
  if(document.getElementById('feedback')?.classList.contains('active'))window.dispatchEvent(new Event('lm:feedback-open-request'));
  return;
 }
 if(viewId==='creditcheck'){
  await ensureCreditCheck();
  if(document.getElementById('creditcheck')?.classList.contains('active'))window.dispatchEvent(new CustomEvent('lm:creditcheck-open-request'));
  return;
 }
 if(viewId==='offers'||viewId==='offerpipeline')await ensureOfferSearch();
}

document.addEventListener('click',event=>{
 const button=event.target.closest?.('.nav button[data-view]');
 if(!button)return;
 const viewId=String(button.dataset.view||'');
 if(!activateNavView(button))return;
 hydrateNavView(viewId).catch(error=>{
  console.warn('navigation hydrate failed',viewId,error);
  if(typeof toast==='function')toast('Visningen åbnede, men nogle funktioner kunne ikke indlæses endnu.');
 });
},true);

window.LMNavigation={open(viewId){
 const button=document.querySelector('.nav button[data-view="'+CSS.escape(String(viewId||''))+'"]');
 if(!activateNavView(button))return false;
 hydrateNavView(String(viewId||'')).catch(error=>console.warn('navigation hydrate failed',viewId,error));
 return true;
}};

window.addEventListener('lm:lead-opened',()=>ensureCreditCheck().catch(error=>console.warn('credit check lead load',error)));
document.addEventListener('click',event=>{if(!event.target.closest?.('[data-open-offer],.offer-pipe-card,[data-executive-offer]'))return;ensureOfferSearch().catch(error=>console.warn('offer search lazy load',error))},true);
async function initAccessBootstrap(){
 if(settingsReturnCallback())await ensureSettingsHub();
 if(onboardingToken()){
  await ensureOnboardingScript();
  try{if(window.__LM_ONBOARDING_CLAIM_PROMISE)await window.__LM_ONBOARDING_CLAIM_PROMISE}catch(error){console.warn('Onboarding invitation init',error)}
 }
 authInit();
 setTimeout(rescueActiveWorkspace,900);
 setTimeout(rescueActiveWorkspace,2200);
}
initAccessBootstrap().catch(error=>{console.error('Access bootstrap init',error);showAuth('Lead Manager kunne ikke starte onboarding. '+(error?.message||error))});
})();
