const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');

async function setup(options = {}) {
  const token = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  const linked = options.existing === true;
  const orphan = options.orphan === true;
  const tables = {
    crm_onboarding_invites: [{ id: 'invite', client_id: 'vention', email: 'tha@vention.dk', token_hash: hash,
      plan_code: 'business', status: 'sent', expires_at: new Date(Date.now() + 3600000).toISOString(), ...options.invite }],
    crm_users: [{ client_id: 'vention', email: 'tha@vention.dk', active: true, auth_user_id: linked ? 'thomas' : null }],
    crm_clients: [{ id: 'vention', name: 'Vention' }],
    crm_usage_limits: options.missingPlan ? [] : [{ client_id: 'vention', plan_code: 'business' }],
  };
  let account = (linked || orphan) ? { id: 'thomas', email: 'tha@vention.dk', password: 'old-pass' } : null;
  let created = 0, finalized = 0, recovered = 0, failFinalize = options.failFinalize;

  function filtered(table, filters) {
    return (tables[table] || []).filter(row => filters.every(filter => filter(row)));
  }

  const admin = {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        async maybeSingle() {
          const rows = filtered(table, filters);
          if (rows.length > 1) return { data: null, error: { message: 'Multiple rows' } };
          return { data: rows[0] || null, error: null };
        },
      };
      return query;
    },
    auth: { admin: {
      async listUsers() {
        return { data: { users: account ? [{ id: account.id, email: account.email }] : [] }, error: null };
      },
      async getUserById(id) {
        if (!account || account.id !== id) return { data: { user: null }, error: { message: 'User not found' } };
        return { data: { user: { id: account.id, email: account.email } }, error: null };
      },
      async updateUserById(id, input) {
        assert.equal(id, 'thomas');
        if (options.weakPassword) return { data: {}, error: { code: 'weak_password', message: 'Password is too weak' } };
        account.password = input.password;
        recovered++;
        return { data: { user: { id: account.id, email: account.email } }, error: null };
      },
      async createUser(input) {
        if (options.weakPassword) return { data: {}, error: { code: 'weak_password', message: 'Password is too weak' } };
        if (account) return { data: {}, error: { code: 'email_exists', message: 'Already registered' } };
        assert.equal(input.email, 'tha@vention.dk');
        account = { id: 'thomas', email: input.email, password: input.password };
        created++;
        return { data: { user: account }, error: null };
      },
    }, async signInWithPassword(input) {
      if (!account || input.password !== account.password) {
        return { data: {}, error: { code: 'invalid_credentials', message: 'Invalid credentials' } };
      }
      return { data: { user: { id: account.id, email: account.email }, session: {
        access_token: 'verified-session', refresh_token: 'refresh', user: { id: account.id, email: account.email },
      } }, error: null };
    } },
    async rpc(name, args) {
      assert.equal(name, 'crm_finalize_onboarding_invite');
      assert.equal(args.p_token_hash, hash);
      finalized++;
      if (failFinalize) {
        failFinalize = false;
        return { data: null, error: { message: 'Temporary database failure' } };
      }
      const invite = tables.crm_onboarding_invites[0];
      if (options.revokeDuringLogin) return { error: { message: 'INVITE_REVOKED' } };
      tables.crm_users[0].auth_user_id = args.p_user_id;
      invite.status = 'claimed';
      return { data: { ok: true, claimed: true, email: 'tha@vention.dk', client_id: 'vention', plan_code: 'business' }, error: null };
    },
  };

  let handler;
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/saas-invite-claim/index.ts', 'utf8').replace(/^import .*\r?\n/, '')), {
    crypto: webcrypto, TextEncoder, Response, console: { error() {} }, createClient: () => admin,
    Deno: { env: { get: () => 'test' }, serve(callback) { handler = callback; } },
  });

  return {
    tables,
    counts: () => ({ created, finalized, recovered }),
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
  assert.equal(inspected.body.email, 'tha@vention.dk');
  assert.equal(inspected.body.company_name, 'Vention');
  assert.equal(inspected.body.existing_login, false);
  assert.equal(inspected.body.recoverable_login, false);
  assert.deepEqual(state.counts(), { created: 0, finalized: 0, recovered: 0 });

  const claimed = await state.request();
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.plan_code, 'business');
  assert.equal(claimed.body.session.user.email, 'tha@vention.dk');
  assert.equal(claimed.body.recovered_stale_login, false);
  assert.equal(state.tables.crm_users[0].auth_user_id, 'thomas');

  const retry = await state.request();
  assert.equal(retry.status, 200);
  assert.equal(state.counts().created, 1);
  assert.equal((await state.request({ password: 'someone-elses-password' })).status, 409);
});

test('a stale auth account from an interrupted onboarding can choose a new password and continue', async () => {
  const state = await setup({ orphan: true });
  const inspected = await state.request({ action: 'inspect' });
  assert.equal(inspected.body.existing_login, false);
  assert.equal(inspected.body.recoverable_login, true);

  const claimed = await state.request({ password: 'New-password-2026!' });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.recovered_stale_login, true);
  assert.equal(state.tables.crm_users[0].auth_user_id, 'thomas');
  assert.deepEqual(state.counts(), { created: 0, finalized: 1, recovered: 1 });
});

test('a transient finalization error is recoverable even after the auth account was created', async () => {
  const state = await setup({ failFinalize: true });
  assert.equal((await state.request()).status, 500);
  assert.equal(state.tables.crm_users[0].auth_user_id, null);

  const retry = await state.request({ password: 'Another-password-2026!' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.recovered_stale_login, true);
  assert.equal(state.counts().created, 1);
  assert.equal(state.counts().recovered, 1);
});

test('existing linked passwords are verified rather than replaced', async () => {
  const state = await setup({ existing: true });
  const inspected = await state.request({ action: 'inspect' });
  assert.equal(inspected.body.existing_login, true);
  assert.equal(inspected.body.recoverable_login, false);

  assert.equal((await state.request()).status, 409);
  assert.equal((await state.request({ password: 'old-pass' })).status, 200);
  assert.equal(state.counts().created, 0);
  assert.equal(state.counts().recovered, 0);
});

test('weak passwords return a specific actionable error instead of a generic onboarding failure', async () => {
  const state = await setup({ weakPassword: true });
  const result = await state.request({ password: 'long-but-rejected-password' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'PASSWORD_WEAK');
  assert.match(result.body.error, /sikkerhedskravene/i);
  assert.equal(state.counts().finalized, 0);
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

