const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handler = require('../api/app');
const config = require('../vercel.json');
async function main() {
  for (const pathname of ['/index.html', '/index']) {
    const route = config.routes.find(entry => entry.handle === 'filesystem' || (entry.src && !entry.continue && new RegExp(entry.src).test(pathname)));
    assert.equal(route.dest, '/api/app');
    assert.match(route.headers['Cache-Control'], /no-store/);
  }
  let html;
  await handler({}, {setHeader(){},status(value){assert.equal(value,200);return this;},send(value){html=value;}});
  assert.doesNotMatch(html, /Opret pilot-login|id="signupBtn"|id="authEmail"[^>]*readonly/);
  for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
  assert.equal((html.match(/src="\/access-bootstrap-v1.js/g)||[]).length,1);
  assert.doesNotMatch(html, /src="\/saas-onboarding-v[2345].js/);
  const login=fs.readFileSync('login.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const pathname of ['/','/login','/login.html']){
    let redirected;
    vm.runInNewContext(login,{URLSearchParams,document:{},location:{pathname,search:'?onboarding=test-token&logged_out=1',hash:'',replace(value){redirected=value;}}});
    assert.equal(redirected,'/api/app?onboarding=test-token');
  }
  console.log('PASS canonical routes, token preservation, composed script syntax and single startup owner');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
