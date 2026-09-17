const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handler = require('../api/app');
const config = require('../vercel.json');

async function main() {
  for (const pathname of ['/index.html', '/index']) {
    const route = config.routes.find(entry => entry.handle === 'filesystem' || new RegExp(entry.src).test(pathname));
    assert.equal(route.dest, '/api/app', `${pathname} must reach the composed app before static files`);
    assert.match(route.headers['Cache-Control'], /no-store/);
  }
  assert.equal(config.routes.find(entry => entry.src === '^/$').dest, '/login.html');
  const headers = {};
  let html = '';
  await handler({}, {
    setHeader(name, value) { headers[name] = value; },
    status(code) { assert.equal(code, 200); return this; },
    send(value) { html = value; },
  });
  assert.match(headers['Cache-Control'], /no-store/);
  assert.match(html, /<input id="authEmail" type="email"/);
  assert.doesNotMatch(html, /<input id="authEmail"[^>]*readonly/);
  assert.doesNotMatch(html, />Opret pilot-login<\/button>/);
  assert.equal((html.match(/src="\/saas-onboarding-v3\.js/g) || []).length, 1);
  assert.match(html, /src="\/tenant-isolation-v1\.js/);
  assert.match(html, /src="\/saas-admin-client-switcher-v1\.js/);
  const login = fs.readFileSync('login.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const pathname of ['/', '/login', '/login.html']) {
    let redirected;
    vm.runInNewContext(login, {
      URLSearchParams,
      document: {},
      location: {pathname, search:'?onboarding=test%2Btoken&logged_out=1', hash:'', replace(value) { redirected = value; }},
    });
    assert.equal(redirected, '/api/app?onboarding=test%2Btoken');
  }
  for (const signedIn of [false, true]) {
    const elements = new Map();
    const timers = [];
    let sessionReads = 0;
    const element = () => ({classList:{add() {}}, style:{}});
    const context = {
      URLSearchParams, console,
      location:{search:'?onboarding=test-token'}, window:{},
      document:{
        getElementById(id) { return elements.get(id); },
        createElement() { return element(); },
        head:{appendChild(node) { elements.set(node.id, node); }},
        body:{insertAdjacentHTML(position, markup) { for (const match of markup.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element()); }},
      },
      supabase:{auth:{
        async getSession() { sessionReads++; return {data:{session:signedIn ? {access_token:'existing-session'} : null}}; },
        onAuthStateChange() {},
      }},
      setTimeout(callback) { timers.push(callback); },
      fetch() { throw new Error('Invitation must not load another workspace'); },
    };
    vm.runInNewContext(fs.readFileSync('saas-onboarding-v3.js', 'utf8'), context);
    for (const callback of timers) await callback();
    assert.ok(elements.has('lmClaim3'));
    assert.ok(elements.has('ocEmail'));
    assert.ok(elements.has('ocPass'));
    assert.equal(sessionReads, 0, 'Invitation takes priority over an existing login');
  }
  if (process.argv.includes('--production')) {
    const origin = 'https://lead-manager-klimaeksperten.vercel.app';
    for (const pathname of ['/index.html', '/index', '/api/app']) {
      const response = await fetch(`${origin}${pathname}?onboarding=regression-invalid-token`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.text();
      assert.match(body, /src="\/saas-onboarding-v3\.js/);
      assert.doesNotMatch(body, /<input id="authEmail"[^>]*readonly/);
      console.log(`PASS production ${pathname}: composed onboarding frontend`);
    }
    const response = await fetch(origin + '/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="forgot"/);
    console.log('PASS production normal login and password recovery retained');
  }
  console.log('PASS onboarding routes, invitation preservation, session priority and composed app');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
