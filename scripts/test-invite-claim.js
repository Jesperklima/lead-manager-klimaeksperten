const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {webcrypto} = require('node:crypto');

const token = 'isolated-regression-invitation-token-20260917';
const email = 'invited@example.test';
const clientId = 'invited-workspace';

async function scenario(overrides = {}) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Buffer.from(digest).toString('hex');
  const tables = {
    crm_onboarding_invites:[{id:'invite', client_id:clientId, email, token_hash:tokenHash, plan_code:'business', status:'sent', expires_at:'2099-01-01', ...overrides.invite}],
    crm_users:[
      {client_id:'other-workspace', email, active:true, auth_user_id:null},
      {client_id:clientId, email, active:true, auth_user_id:null},
    ],
    crm_clients:[{id:clientId, name:'Invited company'}],
  };
  let usersCreated = 0;
  let serve;
  const admin = {
    from(table) {
      const filters = [];
      let changes;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        ilike(key, value) { filters.push(row => row[key].toLowerCase() === value.toLowerCase()); return query; },
        is(key, value) { return query.eq(key, value); },
        update(value) { changes = value; return query; },
        execute() {
          const rows = tables[table].filter(row => filters.every(filter => filter(row)));
          if (changes) rows.forEach(row => Object.assign(row, changes));
          return {data:rows[0] || null, error:null};
        },
        async maybeSingle() { return query.execute(); },
        async single() { return query.execute(); },
        then(resolve, reject) { return Promise.resolve(query.execute()).then(resolve, reject); },
      };
      return query;
    },
    auth:{admin:{
      async createUser(input) { usersCreated++; assert.equal(input.email, email); return {data:{user:{id:'created-user'}}, error:null}; },
      async deleteUser() { throw new Error('Unexpected rollback'); },
    }},
  };
  const source = fs.readFileSync('supabase/functions/saas-invite-claim/index.ts', 'utf8').replace(/^import .*\r?\n/, '');
  vm.runInNewContext(stripTypeScriptTypes(source), {
    createClient:() => admin, crypto:webcrypto, TextEncoder, Response, console,
    Deno:{env:{get:() => 'test-only'}, serve(callback) { serve = callback; }},
  });
  const response = await serve(new Request('https://example.test/claim', {method:'POST', body:JSON.stringify({token, email, password:'test-only-password', ...overrides.request})}));
  return {status:response.status, body:await response.json(), tables, usersCreated};
}

async function main() {
  const success = await scenario();
  assert.equal(success.status, 200);
  assert.equal(success.body.client_id, clientId);
  assert.equal(success.body.plan_code, 'business');
  assert.equal(success.tables.crm_users[0].auth_user_id, null);
  assert.equal(success.tables.crm_users[1].auth_user_id, 'created-user');
  assert.equal(success.tables.crm_onboarding_invites[0].status, 'claimed');
  for (const [input, status, code] of [
    [{request:{email:'different@example.test'}}, 403, 'EMAIL_MISMATCH'],
    [{invite:{status:'claimed'}}, 409, 'INVITE_USED'],
    [{invite:{status:'revoked'}}, 410, 'INVITE_REVOKED'],
    [{request:{token:'invalid'}}, 400, 'INVALID_INVITE'],
  ]) {
    const result = await scenario(input);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.usersCreated, 0);
    assert.equal(result.tables.crm_users[1].auth_user_id, null);
  }
  console.log('PASS isolated claim: correct workspace, Business plan, email match, single-use and invalid/revoked links');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
