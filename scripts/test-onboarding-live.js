const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const app=require('../api/app');
const configPath=path.resolve('.onboarding-test.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const api='https://ouqhostcsvdyrkjefiya.supabase.co';
const key='sb_publishable_reZRECu3Eg531rNn0yB6xQ_fXNyZ5CJ';
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 let bits='';
 for(const letter of secret.toUpperCase().replace(/[^A-Z2-7]/g,''))bits+=alphabet.indexOf(letter).toString(2).padStart(5,'0');
 const bytes=Buffer.from((bits.match(/.{8}/g)||[]).map(value=>parseInt(value,2)));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=crypto.createHmac('sha1',bytes).update(counter).digest(),offset=digest[digest.length-1]&15;
 return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
const server=http.createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(['/api/app','/index','/index.html'].includes(url.pathname)){
  response.status=value=>{response.statusCode=value;return response};response.send=value=>response.end(value);
  return app({query:Object.fromEntries(url.searchParams)},response);
 }
 const file=path.resolve(url.pathname==='/'||url.pathname==='/login'?'login.html':'.'+url.pathname);
 if(!file.startsWith(process.cwd()+path.sep)||url.pathname.includes('/.')||!fs.existsSync(file)){response.writeHead(404);return response.end();}
 response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
 response.end(fs.readFileSync(file));
});
async function run(){
 const loginResponse=await fetch(api+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:config.runner.email,password:config.runner.password})});
 if(!loginResponse.ok)throw new Error('Test runner login failed: '+loginResponse.status);
 const runner=await loginResponse.json();
 const blocked=await fetch(api+'/functions/v1/saas-invite-claim-preview',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({action:'inspect',token:config.invite.token})});
 assert.ok([401,403].includes(blocked.status),'Preview must require JWT');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext();
  const page=await context.newPage(),errors=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failures.push({status:response.status(),path:new URL(response.url()).pathname})});
  await context.route(api+'/functions/v1/saas-invite-claim',async route=>{
   const response=await route.fetch({url:api+'/functions/v1/saas-invite-claim-preview',headers:{...route.request().headers(),authorization:'Bearer '+runner.access_token}});
   const result=await response.json();
   if(result.session?.user?.id){
    if(config.createdUserId)assert.equal(result.session.user.id,config.createdUserId);
    else{config.createdUserId=result.session.user.id;fs.writeFileSync(configPath,JSON.stringify(config,null,2));}
   }
   await route.fulfill({response});
  });
  await context.route(api+'/functions/v1/saas-onboarding',async route=>{
   const response=await route.fetch({url:api+'/functions/v1/saas-onboarding-preview'});
   await route.fulfill({response});
  });
  await page.goto(origin+'/?onboarding='+config.invite.token);
  await page.locator('#oc4Email').waitFor();
  assert.equal(await page.locator('#oc4Email').inputValue(),'tha@vention.dk');
  assert.match(await page.locator('#lmClaim4').innerText(),/Vention.*business/s);
  await page.locator('#oc4Pass').fill(config.invite.password);
  if(await page.locator('#oc4Repeat').isVisible())await page.locator('#oc4Pass2').fill(config.invite.password);
  await page.locator('#oc4Go').click();
  await page.locator('#lmMfaCode').waitFor({timeout:30000});
  if(!config.totpSecret)await page.waitForFunction(()=>document.getElementById('lmMfaSecret')?.textContent?.trim());
  if(await page.locator('#lmMfaSecret').count()){
   config.totpSecret=await page.locator('#lmMfaSecret').innerText();fs.writeFileSync(configPath,JSON.stringify(config,null,2));
  }
  assert.ok(config.totpSecret);
  await page.locator('#lmMfaCode').fill(totp(config.totpSecret));
  await page.locator('#lmMfaVerify').click();
  await page.locator('#ob4LegalAck').waitFor({timeout:30000});
  assert.equal(await page.locator('[data-f="company_name"]').inputValue(),'Vention');
  await page.locator('[data-list="services"]').fill('ERP rådgivning');
  await page.locator('#ob4LegalAck').check();
  await page.locator('#ob4Next').click();
  await page.locator('[data-chip="industries"][data-value="IT / software"]').click();
  await page.locator('[data-mode="company_targets"]').click();
  await page.locator('#ob4Next').click();
  await page.locator('[data-mail="later"]').waitFor();
  await page.reload();
  await page.locator('[data-mail="later"]').waitFor();
  await page.locator('[data-mail="later"]').click();
  await page.locator('#ob4Next').click();
  await page.getByRole('button',{name:'Start Lead Manager',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('appShell').classList.contains('hidden'),{timeout:30000});
  assert.equal(await page.evaluate(()=>state.client.id),config.clientId);
  assert.equal(await page.evaluate(()=>state.session.user.email),'tha@vention.dk');
  assert.equal(await page.evaluate(()=>window.LM_ACCESS.plan.plan_code),'business');
  assert.equal(await page.evaluate(()=>window.LM_ACCESS.platform_admin),false);
  const isolation=await page.evaluate(async()=>{
   const result=await supabase.from('crm_clients').select('id');
   return result;
  });
  assert.equal(isolation.error,null);
  assert.deepEqual(isolation.data.map(row=>row.id),[config.clientId]);
  await page.evaluate(()=>supabase.auth.signOut({scope:'local'}));
  await page.goto(origin+'/?logged_out=1');
  await page.locator('#email').fill('tha@vention.dk');
  await page.locator('#password').fill(config.invite.password);
  await page.locator('#login').click();
  await page.locator('#lmMfaCode').waitFor();
  await page.locator('#lmMfaCode').fill(totp(config.totpSecret));
  await page.locator('#lmMfaVerify').click();
  await page.waitForFunction(()=>!document.getElementById('appShell').classList.contains('hidden'));
  assert.equal(await page.evaluate(()=>state.client.id),config.clientId);
  assert.deepEqual(errors,[]);
  assert.deepEqual(failures,[]);
  config.result={passed:true,at:new Date().toISOString(),checks:['fresh invitation','real Supabase signup','atomic membership','Business','real TOTP MFA','4 onboarding steps','server resume','workspace isolation','logout and new login']};
  fs.writeFileSync(configPath,JSON.stringify(config,null,2));
  console.log('PASS live E2E: Thomas/Vention signup, MFA, profile, Business, isolated workspace and subsequent login; no browser or HTTP errors');
 }catch(error){
  console.error(error.message);
  throw error;
 }finally{await browser.close();server.close();}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
