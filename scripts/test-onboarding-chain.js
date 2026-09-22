const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');

async function setup(options = {}) {
  const token = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  const tables = {
    crm_onboarding_invites: [{ id: 'invite', client_id: 'vention', email: 'tha@vention.dk', token_hash: hash,
      plan_code: 'business', status: 'sent', expires_at: new Date(Date.now() + 3600000).toISOString(), ...options.invite }],
    crm_users: [{ client_id: 'vention', email: 'tha@vention.dk', active: true, auth_user_id: options.existing ? 'thomas' : null }],
    crm_clients: [{ id: 'vention', name: 'Vention' }],
    crm_usage_limits: options.missingPlan ? [] : [{ client_id: 'vention', plan_code: 'business' }],
  };
  let account = options.existing ? { id: 'thomas', email: 'tha@vention.dk', password: 'old-pass' } : null;
  let created = 0, finalized = 0, failFinalize = options.failFinalize;
  const admin = {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        async maybeSingle() { return { data: tables[table].find(row => filters.every(filter => filter(row))) || null, error: null }; },
      };
      return query;
    },
    auth: { admin: { async createUser(input) {
      if (account) return { data: {}, error: { code: 'email_exists', message: 'Already registered' } };
      assert.equal(input.email, 'tha@vention.dk');
      account = { id: 'thomas', email: input.email, password: input.password }; created++;
      return { data: { user: account }, error: null };
    } }, async signInWithPassword(input) {
      if (!account || input.password !== account.password) return { data: {}, error: { message: 'Invalid credentials' } };
      return { data: { user: { id: account.id, email: account.email }, session: {
        access_token: 'verified-session', refresh_token: 'refresh', user: { id: account.id, email: account.email },
      } }, error: null };
    } },
    async rpc(name, args) {
      assert.equal(name, 'crm_finalize_onboarding_invite'); assert.equal(args.p_token_hash, hash);
      finalized++;
      if (failFinalize) { failFinalize = false; return { data: null, error: { message: 'Temporary database failure' } }; }
      const invite = tables.crm_onboarding_invites[0];
      if (options.revokeDuringLogin) return { error: { message: 'INVITE_REVOKED' } };
      tables.crm_users[0].auth_user_id = args.p_user_id; invite.status = 'claimed';
      return { data: { ok: true, claimed: true, email: 'tha@vention.dk', client_id: 'vention', plan_code: 'business' }, error: null };
    },
  };
  let handler;
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/saas-invite-claim/index.ts', 'utf8').replace(/^import .*\r?\n/, '')), {
    crypto: webcrypto, TextEncoder, Response, console: { error() {} }, createClient: () => admin,
    Deno: { env: { get: () => 'test' }, serve(callback) { handler = callback; } },
  });
  return {
    tables, counts: () => ({ created, finalized }),
    async request(body = {}) {
      const response = await handler(new Request('https://test/claim', { method: 'POST',
        body: JSON.stringify({ token, email: 'tha@vention.dk', password: 'Fresh-password-2026', ...body }) }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('fresh invitation binds the correct workspace and returns a verified session', async () => {
  const state = await setup();
  const inspected = await state.request({ action: 'inspect' });
  assert.equal(inspected.body.email, 'tha@vention.dk'); assert.equal(inspected.body.company_name, 'Vention');
  assert.deepEqual(state.counts(), { created: 0, finalized: 0 });
  const claimed = await state.request();
  assert.equal(claimed.status, 200); assert.equal(claimed.body.plan_code, 'business');
  assert.equal(claimed.body.session.user.email, 'tha@vention.dk');
  assert.equal(state.tables.crm_users[0].auth_user_id, 'thomas');
  const retry = await state.request(); assert.equal(retry.status, 200);
  assert.equal(state.counts().created, 1);
  assert.equal((await state.request({ password: 'someone-elses-password' })).status, 409);
});

test('a transient finalization error is recoverable without resetting or deleting auth', async () => {
  const state = await setup({ failFinalize: true });
  assert.equal((await state.request()).status, 500);
  assert.equal(state.tables.crm_users[0].auth_user_id, null);
  assert.equal((await state.request()).status, 200);
  assert.equal(state.counts().created, 1);
});

test('existing passwords are verified rather than replaced', async () => {
  const state = await setup({ existing: true });
  assert.equal((await state.request()).status, 409);
  assert.equal((await state.request({ password: 'old-pass' })).status, 200);
  assert.equal(state.counts().created, 0);
});

test('invalid, expired, revoked, wrong-email and short-password requests never create users', async () => {
  for (const [options, input, code] of [
    [{}, { token: 'invalid' }, 'INVALID_INVITE'],
    [{ invite: { status: 'revoked' } }, {}, 'INVITE_REVOKED'],
    [{ invite: { status: 'expired' } }, {}, 'INVITE_EXPIRED'],
    [{ invite: { expires_at: 'not-a-date' } }, {}, 'INVITE_EXPIRED'],
    [{ invite: { expires_at: new Date(0).toISOString() } }, {}, 'INVITE_EXPIRED'],
    [{ invite: { status: 'send_failed' } }, {}, 'INVALID_INVITE'],
    [{}, { email: 'js@klimaeksperten.dk' }, 'EMAIL_MISMATCH'],
    [{}, { password: 'short' }, 'PASSWORD_TOO_SHORT'],
  ]) {
    const state = await setup(options);
    assert.equal((await state.request(input)).body.code, code);
    assert.equal(state.counts().created, 0);
  }
});

test('revocation between inspection and finalization is enforced by the transaction', async () => {
  const state = await setup({ revokeDuringLogin: true });
  assert.equal((await state.request()).body.code, 'INVITE_REVOKED');
  assert.equal(state.tables.crm_users[0].auth_user_id, null);
});

test('parallel claims converge on one account', async () => {
  const state = await setup();
  const results = await Promise.all([state.request(), state.request()]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(state.counts().created, 1);
});
