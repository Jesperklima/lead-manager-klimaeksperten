const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const app = require('../api/app');
const token = 'a'.repeat(43);
const client = { id: 'vention-test', name: 'Vention', services: [], settings: {
  mail: 'tha@vention.dk', saas: { onboarding_completed: false, account_mode: 'self_service_paid', onboarding_version: 'saas_v6' },
} };
const plan = { plan_code: 'business', allow_offers: true, allow_offer_pipeline: true, allow_activity_report: true, allow_approvals: true };
const user = { id: 'thomas-test', email: 'tha@vention.dk', email_confirmed_at: new Date().toISOString() };
const jwt = level => 'header.' + Buffer.from(JSON.stringify({ aal: level })).toString('base64url') + '.signature';
const session = level => ({ access_token: jwt(level), refresh_token: 'test-refresh', expires_at: Math.floor(Date.now()/1000)+3600, user });
let claimed = false, savedStep = 1, savedDraft = {}, failSave = true, claimCalls = 0, accountCreates = 0, bootstrapBeforeClaim = 0, globalLogout = 0;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (['/api/app', '/index', '/index.html'].includes(url.pathname)) {
    response.status = value => { response.statusCode=value;return response; };
    response.send = value => response.end(value);
    return app({ query: Object.fromEntries(url.searchParams) }, response);
  }
  const file = path.resolve(url.pathname === '/' || url.pathname === '/login' ? 'login.html' : '.'+url.pathname);
  if (!file.startsWith(process.cwd()+path.sep) || !fs.existsSync(file)) {response.writeHead(404);return response.end();}
  response.setHeader('Content-Type', file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  response.end(fs.readFileSync(file));
});
async function assertReadableOnboarding(page, selector) {
  const colors = await page.locator(selector).evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
  assert.ok(colors.length > 0, 'Expected visible onboarding text');
  for (const color of colors) {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    assert.ok(1.05 / (luminance + 0.05) >= 4.5, 'Unreadable text on white onboarding card: ' + color);
  }
}
async function run() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true});
  try {
    const context=await browser.newContext();
    const errors=[];
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('https://ouqhostcsvdyrkjefiya.supabase.co/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      const body=request.postDataJSON()||{};
      const send=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':'*'}});
      if(request.method()==='OPTIONS')return send({});
      if(url.pathname==='/auth/v1/logout'){globalLogout++;return send({});}
      if(url.pathname==='/auth/v1/user')return send({...user,factors:[]});
      if(url.pathname.endsWith('/factors'))return send({id:'factor',totp:{secret:'TESTSECRET',qr_code:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}});
      if(url.pathname.endsWith('/challenge'))return send({id:'challenge'});
      if(url.pathname.endsWith('/verify'))return send(session('aal2'));
      if(url.pathname==='/auth/v1/token')return send(session('aal1'));
      if(url.pathname.endsWith('/saas-invite-claim')){
        if(body.token!==token)return send({code:'INVALID_INVITE',error:'Invitationslinket er ugyldigt'},404);
        if(body.action==='inspect')return send({email:user.email,client_id:client.id,company_name:client.name,plan_code:'business',claimed,existing_login:claimed});
        claimCalls++;if(!claimed){accountCreates++;claimed=true;}
        return send({ok:true,email:user.email,client_id:client.id,plan_code:'business',session:session('aal1')});
      }
      if(url.pathname.endsWith('/crm_session_bootstrap')){
        if(!claimed)bootstrapBeforeClaim++;
        const aal=request.headers().authorization?.includes(jwt('aal2'))?'aal2':'aal1';
        return send({authenticated:true,platform_admin:false,role:'workspace_owner',workspace_id:client.id,client,plan,
          mfa_required:true,mfa_satisfied:aal==='aal2',next_route:aal==='aal1'?'mfa':client.settings.saas.onboarding_completed?'app':'onboarding'});
      }
      if(url.pathname.endsWith('/saas-onboarding')){
        if(body.action==='status')return send({client,plan,membership:{email:user.email,role:'owner'},onboarding:{step:savedStep,draft:savedDraft}});
        if(body.action==='save_progress'){
          if(failSave){failSave=false;return send({error:'Simuleret netværksfejl'},503);}
          savedStep=body.step;savedDraft=body.draft;return send({ok:true,step:savedStep,last_saved_at:new Date().toISOString()});
        }
        if(body.action==='complete'){assert.equal(body.mail_provider,'later');assert.equal(body.legal_model_ack,true);client.settings.saas.onboarding_completed=true;return send({ok:true});}
      }
      if(url.pathname.endsWith('/mail-provider-auth'))return send({accounts:[]});
      if(url.pathname.endsWith('/crm_startup_snapshot'))return send({});
      if(url.pathname.includes('/rest/v1/'))return send([]);
      return send({});
    });
    await page.goto(origin+'/?onboarding='+token);
    await page.locator('#oc4Email').waitFor();
    assert.equal(await page.locator('#oc4Email').inputValue(),user.email);
    await assertReadableOnboarding(page, '#lmClaim4 h1, #lmClaim4 .sub, #lmClaim4 label, #lmClaim4 a');
    assert.equal(await page.getByRole('button',{name:'Log ind',exact:true}).count(),0);
    await page.setViewportSize({width:375,height:812});
    const card = await page.locator('.ob4card').boundingBox();
    assert.ok(card.x >= 0 && card.x + card.width <= 375, 'Invitation form overflows mobile viewport');
    await page.setViewportSize({width:1280,height:720});
    await page.locator('#oc4Pass').fill('short');
    await page.locator('#oc4Pass2').fill('short');
    await page.locator('#oc4Go').click();
    await page.getByText('Password skal være mindst 10 tegn.',{exact:true}).waitFor();
    await page.locator('#oc4Pass').fill('Test-password-2026');
    await page.locator('#oc4Pass2').fill('different');
    await page.locator('#oc4Go').click();
    await page.getByText('Passwords er ikke ens.',{exact:true}).waitFor();
    await page.locator('#oc4Pass2').fill('Test-password-2026');
    await page.locator('#oc4Go').click();
    await page.locator('#lmMfaCode').waitFor();
    assert.equal(accountCreates,1);assert.equal(claimCalls,1);assert.equal(bootstrapBeforeClaim,0);assert.equal(globalLogout,0);
    await page.locator('#lmMfaCode').fill('123456');
    await page.locator('#lmMfaVerify').click();
    await page.locator('#ob4LegalAck').waitFor();
    await assertReadableOnboarding(page, '#lmOb4 h1, #lmOb4 .sub, #lmOb4 .ob4field label');
    await page.locator('[data-list="services"]').fill('ERP rådgivning');
    await page.locator('#ob4LegalAck').check();
    await page.locator('#ob4Next').click();
    await page.getByText(/Oplysningerne blev ikke gemt/).waitFor();
    assert.equal(savedStep,1);
    await page.locator('#ob4Next').click();
    await page.locator('[data-chip="industries"][data-value="IT / software"]').click();
    await page.locator('[data-mode="company_targets"]').click();
    await page.locator('#ob4Next').click();
    await page.locator('[data-mail="later"]').waitFor();
    await page.reload();
    await page.locator('[data-mail="later"]').waitFor();
    assert.equal(savedStep,3);
    await page.locator('#ob4Next').click();
    await page.getByRole('button',{name:'Start Lead Manager',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('appShell').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>state.client.id),client.id);
    assert.equal(await page.evaluate(()=>state.session.user.email),user.email);
    assert.equal(new URL(page.url()).searchParams.has('onboarding'),false);
    await page.goto(origin+'/?onboarding='+token);
    await page.getByRole('heading',{name:'Fortsæt med dit Lead Manager-login'}).waitFor();
    assert.equal(await page.locator('#oc4Email').inputValue(),user.email);
    assert.equal(globalLogout,0);
    await page.goto(origin+'/?onboarding='+'b'.repeat(43));
    await page.getByRole('heading',{name:'Invitationen kunne ikke åbnes'}).waitFor();
    await assertReadableOnboarding(page, '#lmClaim4 h1, #lmClaim4 a');
    assert.equal(await page.locator('#oc4Pass').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS browser: fresh invitation → password → MFA → four steps → failed save/retry → reload/resume → correct workspace; used/invalid links; no global signout');
  } finally {await browser.close();server.close();}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
