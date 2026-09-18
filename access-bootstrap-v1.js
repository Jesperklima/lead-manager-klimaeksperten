(()=>{
'use strict';
const API=window.SUPABASE_URL||'https://ouqhostcsvdyrkjefiya.supabase.co';
const KEY=window.SUPABASE_KEY||'sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
let bootPromise=null;
async function centralBootstrap(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)return {authenticated:false,next_route:'login'};
 const r=await fetch(API+'/functions/v1/session-bootstrap',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}'});
 const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}};
 if(!r.ok)throw new Error(d.error||('Adgangskontrol fejlede ('+r.status+')'));
 return d;
}
async function controlledStartApp(){
 if(bootPromise)return bootPromise;
 bootPromise=(async()=>{
  const loading=document.getElementById('loading');if(loading)loading.classList.remove('hidden');
  try{
   const access=await centralBootstrap();window.LM_ACCESS=access;
   if(!access.authenticated){showAuth();return}
   if(access.next_route==='denied'){showAuth('Denne konto har ikke adgang til et workspace.');await supabase.auth.signOut();return}
   if(access.next_route==='onboarding'){
    document.getElementById('authScreen')?.classList.add('hidden');document.getElementById('appShell')?.classList.add('hidden');
    return;
   }
   let clientId=access.workspace_id||null;
   if(access.platform_admin){
    const preferred=localStorage.getItem('lm_admin_client_id')||'';
    if(preferred){const q=await supabase.from('crm_clients').select('*').eq('id',preferred);if(q.data?.length)clientId=preferred}
    if(!clientId){const email=state.session?.user?.email||'';const m=await supabase.from('crm_users').select('*').eq('email',email);clientId=m.data?.[0]?.client_id||null}
   }
   if(!clientId)throw new Error('Intet workspace kunne vælges.');
   const cr=await supabase.from('crm_clients').select('*').eq('id',clientId);if(cr.error||!cr.data?.length)throw new Error(cr.error?.message||'Workspace kunne ikke hentes');
   state.client=cr.data[0];
   const maps=await supabase.from('crm_users').select('*').eq('email',state.session?.user?.email||'');state.userMap=maps.data?.find(x=>x.client_id===clientId)||maps.data?.[0]||null;
   document.body.dataset.lmRole=access.role||'';document.body.dataset.lmPlatformAdmin=access.platform_admin?'1':'0';
   showApp();if(document.getElementById('brandClient'))document.getElementById('brandClient').textContent=state.client.name+' · '+(access.platform_admin?'Platform admin':'Kundeworkspace');
   await loadAll();
  }catch(e){console.error('Central adgangskontrol',e);showAuth('Lead Manager kunne ikke kontrollere din adgang. '+(e.message||e));}
  finally{if(loading)loading.classList.add('hidden');bootPromise=null}
 })();return bootPromise;
}
startApp=controlledStartApp;
window.LMAccess={bootstrap:centralBootstrap,start:controlledStartApp};
authInit();
})();