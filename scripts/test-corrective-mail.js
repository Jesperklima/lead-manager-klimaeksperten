const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{webcrypto}=require('node:crypto');
const cid='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
function microsoft({postprocessError=false,persistenceError=false,networkError=false}={}){
 let handler,sends=0;
 const jobs=[];
 const tables={crm_users:[{client_id:cid,auth_user_id:'user',active:true,email:'owner@example.test'}],crm_clients:[{id:cid,name:'Demo',settings:{mail_provider:'microsoft',mail:'owner@example.test'}}],
 crm_leads:[{id:'lead',client_id:cid,company_id:'company'}],crm_contacts:[{id:'contact',client_id:cid,company_id:'company',email:'customer@example.test'}],
 crm_usage_limits:[{client_id:cid,daily_mail_send_limit:100,allow_mail_send:true}],crm_mail_send_jobs:jobs,crm_approvals:[],crm_integrations:[]};
 function from(name){
  const filters=[];let operation='select',payload;
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},insert(v){operation='insert';payload=v;return q},update(v){operation='update';payload=v;return q},
  async run(){
   const rows=tables[name]||[],matching=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
   if(operation==='insert'){
    if(name==='crm_mail_send_jobs'&&rows.some(j=>j.client_id===payload.client_id&&j.send_id===payload.send_id))return{data:null,error:{code:'23505',message:'duplicate'}};
    const row={id:webcrypto.randomUUID(),...payload};rows.push(row);return{data:[row],error:null};
   }
   if(operation==='update'){
    if(persistenceError&&name==='crm_mail_send_jobs'&&payload.status==='sent_pending_postprocess')return{data:null,error:{message:'db unavailable'}};
    matching.forEach(r=>Object.assign(r,payload));
   }
   return{data:matching,error:null};
  },async single(){const r=await q.run();return {...r,data:r.data?.[0]||null}},
  async maybeSingle(){return q.single()},then(a,b){return q.run().then(a,b)}};
  return q;
 }
 const admin={from,auth:{getUser:async()=>({data:{user:{id:'user',email:'owner@example.test'}},error:null})},
 rpc:async(name)=>name==='crm_get_microsoft_oauth_material'?{data:{client_id:'test-app',client_secret:'test-secret',refresh_token:'test-refresh',account:'owner@example.test'},error:null}:
 name==='crm_usage_snapshot'?{data:{mail_sends_today:0},error:null}:{data:{status:'sent'},error:postprocessError?{message:'postprocess failed'}:null}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/microsoft-direct-send/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 vm.runInNewContext(code,{createClient:()=>admin,apiSessionGuard:async()=>({allowed:true}),Deno:{env:{get:()=> 'test'},serve:h=>handler=h},
 Request,Response,Headers,URLSearchParams,crypto:webcrypto,console:{error(){}},fetch:async(url)=>{
 if(url.includes('login.microsoftonline'))return Response.json({access_token:'test-access'});
 if(url.includes('/sendMail')){sends++;if(networkError)throw Error('network interrupted');return new Response(null,{status:202})}
 throw Error('Unexpected request');
 }});
 const request=()=>new Request('https://test',{method:'POST',headers:{Authorization:'Bearer jwt'},body:JSON.stringify({client_id:cid,request_id:rid,lead_id:'lead',to:'customer@example.test',subject:'Aftalt opfølgning',body:'Hej',purpose:'operational_relationship'})});
 return{run:()=>handler(request()),jobs,sends:()=>sends};
}
test('Microsoft duplicate concurrent requests submit only once',async()=>{
 const edge=microsoft();const res=await Promise.all([edge.run(),edge.run()]);
 assert.equal(edge.sends(),1);assert.equal(edge.jobs.length,1);
 assert.ok(res.some(r=>r.status===200));assert.ok(res.some(r=>r.status===202));
 const retry=await edge.run();assert.equal(retry.status,200);assert.equal(edge.sends(),1);
});
test('Microsoft postprocess failure preserves provider acknowledgement',async()=>{
 const edge=microsoft({postprocessError:true});const res=await edge.run(),data=await res.json();
 assert.equal(res.status,200);assert.equal(data.provider_accepted,true);assert.equal(data.postprocess_pending,true);assert.equal(edge.sends(),1);
 await edge.run();assert.equal(edge.sends(),1);
});
test('Microsoft persistence failure never reports a provider rejection',async()=>{
 const edge=microsoft({persistenceError:true});const data=await(await edge.run()).json();
 assert.equal(data.provider_accepted,true);assert.equal(data.code,'SEND_PERSISTENCE_PENDING');
 await edge.run();assert.equal(edge.sends(),1);
});
test('Microsoft network uncertainty cannot trigger a resend with the same ID',async()=>{
 const edge=microsoft({networkError:true});const res=await edge.run(),data=await res.json();
 assert.equal(res.status,202);assert.equal(data.status,'unknown');
 await edge.run();assert.equal(edge.sends(),1);
});
test('browser retains send identity after uncertainty and does not call provider automatically',async()=>{
 const sentBodies=[],store=new Map();
 const window={fetch:async(_url,init)=>{sentBodies.push(JSON.parse(init.body));return Response.json({sent:false,status:'unknown'},{status:202})}};
 vm.runInNewContext(fs.readFileSync('mail-send-safety-v1.js','utf8'),{window,document:{getElementById:()=>({value:'Første kontakt'})},sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},crypto:webcrypto,TextEncoder,Response,JSON,Map,Array,String,Uint8Array});
 const url='https://test/functions/v1/microsoft-direct-send',init={method:'POST',body:JSON.stringify({client_id:cid,to:'customer@example.test',subject:'Hej',body:'Hej'})};
 assert.equal(sentBodies.length,0);
 assert.equal((await window.fetch(url,init)).status,409);
 const retry={...init,body:JSON.stringify({...JSON.parse(init.body),request_id:rid})};
 assert.equal((await window.fetch(url,retry)).status,409);
 assert.equal(sentBodies[0].request_id,sentBodies[1].request_id);assert.notEqual(sentBodies[0].request_id,rid);assert.equal(sentBodies[0].purpose,'direct_marketing');
 await window.fetch(url,{...init,body:JSON.stringify({...JSON.parse(init.body),offer_id:'offer'})});
 assert.equal(sentBodies[2].purpose,'offer_followup');
 assert.equal(window.LMMailSendSafety.purpose('Tilbudsopfølgning'),'offer_followup');
});

test('read-only reconciliation requires a Sent-folder match and never retries delivery',async()=>{
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/mail-reconciliation.ts','utf8'),{mode:'transform'}).replaceAll('export ','');
 for(const found of [false,true]){
  const calls=[],patches=[];let finalized=0;
  const admin={rpc:async(name)=>name==='get_gmail_oauth_material'?{data:{client_id:'test',client_secret:'test',refresh_token:'test'},error:null}:(finalized++,{data:{},error:null}),
   from:()=>{const q={update(p){patches.push(p);return q},eq(){return q},in(){return q},select(){return q},maybeSingle:async()=>({data:{status:patches.at(-1).status},error:null})};return q}};
  const c={URLSearchParams,Date,Error,fetch:async(url,init)=>{calls.push({url,method:init?.method||'GET'});if(url.includes('oauth2'))return Response.json({access_token:'test'});return Response.json({messages:found?[{id:'sent-id',threadId:'thread'}]:[]})}};
  vm.runInNewContext(source,c);
  const result=await c.reconcileMailJob(admin,{id:'job',client_id:cid,provider:'gmail',message_rfc822_id:'<lm@test>'});
  assert.equal(result.status,found?'sent':'unknown');assert.equal(finalized,found?1:0);
  assert.equal(calls.length,2);assert.ok(decodeURIComponent(calls[1].url).includes('in:sent'));assert.equal(calls[1].method,'GET');
  assert.ok(calls.every(x=>!x.url.includes('/send')));
 }
});
test('recovery of a failed offer cannot submit another mail',()=>{
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/gmail-offer-send/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 const start=source.indexOf('async function retryFailedOfferJob('),end=source.indexOf('Deno.serve(',start);
 assert.ok(start>=0&&end>start);
 const fn=source.slice(start,end);
 assert.ok(!fn.includes('gmailSendMime('));assert.ok(fn.includes('RECOVERY_REQUIRES_EXPLICIT_SEND'));
});
test('enrichment worker cannot process a request claimed by another worker',async()=>{
 let handler,requests=0;
 const request={id:'job',payload:{action:'contact_enrichment'},status:'queued',client_id:cid,company_id:'company'};
 const q={select(){return q},eq(){return q},in(){return q},single:async()=>({data:request,error:null}),update(){return q},maybeSingle:async()=>({data:null,error:null})};
 const admin={rpc:async()=>({data:'worker-secret',error:null}),from:()=>q};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/lead-enrichment-worker/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 vm.runInNewContext(code,{createClient:()=>admin,Deno:{env:{get:()=> 'test'},serve:h=>handler=h},Request,Response,TextEncoder,URL,URLSearchParams,Date,fetch:async()=>{requests++;throw Error('No provider request expected')},console});
 const response=await handler(new Request('https://test',{method:'POST',headers:{'x-lead-worker-secret':'worker-secret'},body:JSON.stringify({request_id:'job'})}));
 assert.equal(response.status,200);assert.equal((await response.json()).already_claimed,true);assert.equal(requests,0);
});
