'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
const source=fs.readFileSync('supabase/functions/_shared/minuba-oauth.ts','utf8');
const {refreshMinubaAccess}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
async function run(responses,options={}){
 let calls=0,saved=null,updates=[],readCount=0;
 const admin={rpc:async(name,args)=>{
  if(name==='set_minuba_oauth_tokens'){saved=args;return {error:options.saveError?{}:null}}
  if(args.p_kind==='access_token')return {data:'rotated-access'};
  return {data:options.rotated&&++readCount>1?'rotated-refresh':'private-refresh'};
 },from:()=>({update:x=>{updates.push(x);const chain={eq:()=>chain,then:resolve=>resolve({})};return chain}})};
 global.fetch=async(url,init)=>{assert.equal(url,'https://auth.minuba.dk/oauth2/token');assert.equal(init.method,'POST');assert(init.signal);assert.equal(init.headers.Authorization,'Basic '+btoa('private-client:private-secret'));const v=responses[Math.min(calls++,responses.length-1)];return new Response(JSON.stringify(v.body),{status:v.status})};
 let value,error;try{value=await refreshMinubaAccess(admin,'tenant','private-client','private-secret')}catch(e){error=e}
 return {value,error,calls,saved,updates};
}
let r=await run([{status:500,body:{error_description:'private-secret'}},{status:200,body:{access_token:'new-access',refresh_token:'new-refresh',expires_in:3600}}]);
assert.equal(r.value,'new-access');assert.equal(r.calls,2);assert.equal(r.saved.p_refresh_token,'new-refresh');
r=await run([{status:500,body:{error_description:'private-secret private-refresh'}}]);assert.equal(r.error.code,'MINUBA_REFRESH_UNAVAILABLE');assert.equal(r.calls,2);assert.equal(r.updates[0].status,'error');assert(!JSON.stringify(r.updates).includes('private-'));assert(!r.error.message.includes('private-'));
r=await run([{status:400,body:{error:'invalid_grant'}}]);assert.equal(r.error.code,'MINUBA_RECONNECT_REQUIRED');assert.equal(r.calls,1);assert.equal(r.updates[0].status,'needs_reconnect');
r=await run([{status:401,body:{error:'invalid_client'}}]);assert.equal(r.error.code,'MINUBA_CREDENTIALS_REJECTED');assert.equal(r.updates[0].status,'oauth_credentials_rejected');
r=await run([{status:400,body:{error:'invalid_grant'}}],{rotated:true});assert.equal(r.value,'rotated-access');assert.equal(r.updates.length,0);
r=await run([{status:200,body:{access_token:'new-access'}}],{saveError:true});assert.equal(r.error.code,'MINUBA_TOKEN_STORAGE_ERROR');assert(!r.value);
const html=fs.readFileSync('index.html','utf8');
assert(!html.includes("callProtectedEdge('minuba-auth'"));
const query=html.slice(html.indexOf('  class Query'),html.indexOf('  const auth='));
let requested;
const Query=vm.runInNewContext(query+';Query',{URLSearchParams,refreshIfNeeded:async()=>{},request:async path=>{requested=path;return {data:[]}}});
await new Query('crm_marketing_connections').select('id,status').eq('client_id','tenant').neq('status','disabled');
assert(requested.includes('status=neq.disabled'));assert(requested.includes('client_id=eq.tenant'));
const start=fs.readFileSync('supabase/functions/minuba-oauth-start/index.ts','utf8');assert(start.includes('apiSessionGuard(token,tenantId'));assert(start.includes("&&!existing?.last_error"));
const callback=fs.readFileSync('supabase/functions/minuba-oauth-callback/index.ts','utf8');assert(callback.indexOf("select('state')")<callback.indexOf('const tokenRes='));assert(!callback.includes("String(tok.error_description"));
const pdf=fs.readFileSync('offer-mail-pdf-v1.js','utf8');assert(pdf.includes("renderSendStatus('error','Mailen blev ikke sendt'"));assert(pdf.includes('escapeHtml(status.error)'));
console.log('PASS: refresh recovery, provider error redaction, invalid grant/client, rotation race, durable token save, Query neq request, secure reconnect and persistent mail error');
})().catch(e=>{console.error(e);process.exitCode=1});
