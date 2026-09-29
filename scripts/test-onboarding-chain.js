const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');

async function hex(value) {
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
}

async function setup(options = {}) {
  const token = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const tokenHash = await hex(token);
  const code = 'ABCD2345';
  const codeHash = await hex(code);
  const client = { id: 'demo-client', name: 'Demo Kunde ApS' };
  const member = { client_id: client.id, email: 'owner@example.test', active: true, auth_user_id: 'demo-user' };
  const invite = {
    id: 'invite',
    client_id: client.id,
    email: member.email,
    token_hash: tokenHash,
    plan_code: 'business',
    status: 'sent',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    used_at: null,
    metadata: {
      first_login_mode: 'one_time_code',
      otp_hash: codeHash,
      otp_expires_at: new Date(Date.now() + 3600000).toISOString(),
      otp_attempts: 0,
      otp_max_attempts: 5,
    },
    ...options.invite,
  };
  const tables = {
    crm_onboarding_invites: [invite],
    crm_users: [member],
    crm_clients: [client],
    crm_usage_limits: [{ client_id: client.id, plan_code: 'business' }],
  };
  let password = 'server-only-bootstrap-password';
  let passwordUpdates = 0;
  let finalized = 0;

  function matches(row, filters) {
    return filters.every(({ type, key, value }) => type === 'ilike'
      ? String(row[key] || '').toLowerCase() === String(value || '').toLowerCase()
      : row[key] === value);
  }
  function query(table) {
    const filters = [];
    let updatePayload = null;
    const q = {
      select() { return q; },
      eq(key, value) { filters.push({ type: 'eq', key, value }); return q; },
      ilike(key, value) { filters.push({ type: 'ilike', key, value }); return q; },
      update(payload) { updatePayload = payload; return q; },
      async maybeSingle() {
        const rows = (tables[table] || []).filter(row => matches(row, filters));
        if (rows.length > 1) return { data: null, error: { message: 'Multiple rows' } };
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) {
        try {
          const rows = (tables[table] || []).filter(row => matches(row, filters));
          if (updatePayload) rows.forEach(row => Object.assign(row, updatePayload));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return q;
  }

  const admin = {
    from: query,
    auth: { admin: {
      async getUserById(id) {
        if (id !== member.auth_user_id) return { data: { user: null }, error: { message: 'not found' } };
        return { data: { user: { id, email: member.email, app_metadata: { lead_manager_first_login_pending: true } } }, error: null };
      },
      async updateUserById(id, attrs) {
        assert.equal(id, member.auth_user_id);
        if (options.weakPassword) return { data: {}, error: { code: 'weak_password', message: 'Password is weak' } };
        password = attrs.password;
        passwordUpdates++;
        return { data: { user: { id, email: member.email } }, error: null };
      },
    }, async signInWithPassword(input) {
      if (input.email !== member.email || input.password !== password) {
        return { data: {}, error: { code: 'invalid_credentials', message: 'Invalid credentials' } };
      }
      return { data: { user: { id: member.auth_user_id, email: member.email }, session: {
        access_token: 'verified-session',
        refresh_token: 'refresh',
        user: { id: member.auth_user_id, email: member.email },
      } }, error: null };
    } },
    async rpc(name, args) {
      if (name === 'crm_verify_onboarding_code') {
        assert.equal(args.p_token_hash, tokenHash);
        if (invite.metadata.otp_locked_at || invite.metadata.otp_attempts >= 5) {
          return { data: { ok: false, code: 'CODE_LOCKED', attempts_remaining: 0 }, error: null };
        }
        if (args.p_code_hash !== codeHash) {
          invite.metadata.otp_attempts++;
          if (invite.metadata.otp_attempts >= 5) invite.metadata.otp_locked_at = new Date().toISOString();
          return { data: {
            ok: false,
            code: invite.metadata.otp_attempts >= 5 ? 'CODE_LOCKED' : 'CODE_INVALID',
            attempts_remaining: Math.max(0, 5 - invite.metadata.otp_attempts),
          }, error: null };
        }
        invite.metadata.otp_verified_at = new Date().toISOString();
        invite.metadata.password_ticket_hash = args.p_ticket_hash;
        invite.metadata.password_ticket_expires_at = args.p_ticket_expires_at;
        return { data: { ok: true, code: 'CODE_VERIFIED', ticket_expires_at: args.p_ticket_expires_at }, error: null };
      }
      assert.equal(name, 'crm_finalize_onboarding_invite');
      assert.equal(args.p_token_hash, tokenHash);
      finalized++;
      invite.status = 'claimed';
      invite.used_at = new Date().toISOString();
      invite.metadata.claimed_user_id = args.p_user_id;
      return { data: { ok: true, claimed: true, email: member.email, client_id: client.id, company_name: client.name, plan_code: 'business' }, error: null };
    },
  };

  let handler;
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/saas-invite-claim/index.ts', 'utf8').replace(/^import .*\r?\n/, '')), {
    crypto: webcrypto,
    TextEncoder,
    Response,
    console: { error() {} },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    createClient: () => admin,
    Deno: { env: { get: () => 'test' }, serve(callback) { handler = callback; } },
  });

  return {
    invite,
    token,
    code,
    counts: () => ({ passwordUpdates, finalized }),
    async request(body = {}) {
      const response = await handler(new Request('https://test/claim', {
        method: 'POST',
        body: JSON.stringify({ token, email: member.email, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('fresh invite requires code before password and never supports direct claim', async () => {
  const state = await setup();
  const inspected = await state.request({ action: 'inspect' });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.company_name, 'Demo Kunde ApS');
  assert.equal(inspected.body.otp_required, true);
  assert.equal(inspected.body.attempts_remaining, 5);

  const bypass = await state.request({ action: 'claim', password: 'Some-password-2026!' });
  assert.equal(bypass.status, 409);
  assert.equal(bypass.body.code, 'CODE_REQUIRED');

  const noTicket = await state.request({ action: 'set_password', password: 'Some-password-2026!' });
  assert.equal(noTicket.status, 403);
  assert.equal(noTicket.body.code, 'VERIFICATION_REQUIRED');
  assert.deepEqual(state.counts(), { passwordUpdates: 0, finalized: 0 });
});

test('correct one-time code issues a ticket, then password activates login', async () => {
  const state = await setup();
  const verified = await state.request({ action: 'verify_code', code: 'ABCD-2345' });
  assert.equal(verified.status, 200);
  assert.match(verified.body.verification_ticket, /^[A-Za-z0-9_-]{43}$/);

  const short = await state.request({ action: 'set_password', verification_ticket: verified.body.verification_ticket, password: 'short' });
  assert.equal(short.status, 400);
  assert.equal(short.body.code, 'PASSWORD_TOO_SHORT');

  const activated = await state.request({
    action: 'set_password',
    verification_ticket: verified.body.verification_ticket,
    password: 'Safe-password-2026!',
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.password_set, true);
  assert.equal(activated.body.session.user.email, 'owner@example.test');
  assert.equal(state.invite.status, 'claimed');
  assert.ok(state.invite.metadata.password_set_at);
  assert.equal(state.invite.metadata.otp_hash, null);
  assert.deepEqual(state.counts(), { passwordUpdates: 1, finalized: 1 });
});

test('five incorrect codes lock the invitation code', async () => {
  const state = await setup();
  for (let i = 0; i < 4; i++) {
    const wrong = await state.request({ action: 'verify_code', code: 'ZZZZ-9999' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.code, 'CODE_INVALID');
    assert.equal(wrong.body.attempts_remaining, 4 - i);
  }
  const locked = await state.request({ action: 'verify_code', code: 'ZZZZ-9999' });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.code, 'CODE_LOCKED');
  const correctAfterLock = await state.request({ action: 'verify_code', code: state.code });
  assert.equal(correctAfterLock.status, 423);
  assert.equal(correctAfterLock.body.code, 'CODE_LOCKED');
  assert.deepEqual(state.counts(), { passwordUpdates: 0, finalized: 0 });
});

test('expired code cannot issue password ticket', async () => {
  const state = await setup({ invite: { metadata: {
    first_login_mode: 'one_time_code',
    otp_hash: await hex('ABCD2345'),
    otp_expires_at: new Date(0).toISOString(),
    otp_attempts: 0,
    otp_max_attempts: 5,
  } } });
  const result = await state.request({ action: 'verify_code', code: state.code });
  assert.equal(result.status, 410);
  assert.equal(result.body.code, 'CODE_EXPIRED');
});

test('weak password returns a specific error after valid code', async () => {
  const state = await setup({ weakPassword: true });
  const verified = await state.request({ action: 'verify_code', code: state.code });
  const result = await state.request({
    action: 'set_password',
    verification_ticket: verified.body.verification_ticket,
    password: 'Long-but-rejected-2026!',
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'PASSWORD_WEAK');
  assert.deepEqual(state.counts(), { passwordUpdates: 0, finalized: 0 });
});
