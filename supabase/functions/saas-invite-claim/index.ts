import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const failures: Record<string, [number, string]> = {
  INVALID_INVITE: [404, 'Invitationslinket er ugyldigt. Bed om en ny invitation.'],
  INVITE_REVOKED: [410, 'Invitationen er trukket tilbage. Bed om en ny invitation.'],
  INVITE_EXPIRED: [410, 'Invitationen er udløbet. Bed om en ny invitation.'],
  INVITE_USED: [409, 'Invitationen er allerede brugt. Gå til login.'],
  EMAIL_MISMATCH: [403, 'E-mailadressen matcher ikke invitationen.'],
  MEMBERSHIP_MISSING: [409, 'Kundeadgangen mangler. Kontakt administratoren.'],
  MEMBERSHIP_USER_MISMATCH: [409, 'Login og kundeadgang matcher ikke. Kontakt administratoren.'],
  WORKSPACE_MISSING: [409, 'Virksomheden kunne ikke findes. Kontakt administratoren.'],
  CODE_NOT_CONFIGURED: [409, 'Invitationen mangler en engangskode. Bed om en ny invitation.'],
  CODE_EXPIRED: [410, 'Engangskoden er udløbet. Bed om en ny invitation.'],
  CODE_LOCKED: [423, 'Engangskoden er låst efter for mange forkerte forsøg. Bed om en ny invitation.'],
  VERIFICATION_REQUIRED: [403, 'Bekræft engangskoden igen, før du vælger adgangskode.'],
  VERIFICATION_EXPIRED: [410, 'Bekræftelsen er udløbet. Indtast engangskoden igen.'],
};
const fail = (code: string) => {
  const item = failures[code] || [400, 'Onboarding kunne ikke fortsætte.'];
  return json({ code, error: item[1] }, item[0]);
};

const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
).map(byte => byte.toString(16).padStart(2, '0')).join('');

const b64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const normEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const normCode = (value: unknown) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function isWeakPasswordError(error: any) {
  const code = String(error?.code || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'weak_password'
    || code === 'password_too_short'
    || name.includes('weakpassword')
    || (message.includes('password') && /(weak|length|character|digit|uppercase|lowercase|symbol)/i.test(message));
}

const weakPassword = () => json({
  code: 'PASSWORD_WEAK',
  error: 'Adgangskoden opfylder ikke sikkerhedskravene. Brug mindst 10 tegn og gerne store og små bogstaver, tal og specialtegn.',
}, 400);

async function contextFor(admin: any, token: string, bodyEmail?: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { response: fail('INVALID_INVITE') };
  }

  const hash = await sha256(token);
  const { data: invite, error: lookupError } = await admin.from('crm_onboarding_invites')
    .select('*')
    .eq('token_hash', hash)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!invite) return { response: fail('INVALID_INVITE') };
  if (invite.status === 'revoked') return { response: fail('INVITE_REVOKED') };

  const expiresAt = Date.parse(invite.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || invite.status === 'expired') {
    return { response: fail('INVITE_EXPIRED') };
  }
  if (!['created', 'sent', 'claimed'].includes(invite.status)) {
    return { response: fail('INVALID_INVITE') };
  }

  const inviteEmail = normEmail(invite.email);
  if (bodyEmail && normEmail(bodyEmail) !== inviteEmail) {
    return { response: fail('EMAIL_MISMATCH') };
  }

  const [clientResult, memberResult, planResult] = await Promise.all([
    admin.from('crm_clients').select('id,name').eq('id', invite.client_id).maybeSingle(),
    admin.from('crm_users').select('email,client_id,auth_user_id,active')
      .eq('client_id', invite.client_id)
      .ilike('email', invite.email)
      .eq('active', true)
      .maybeSingle(),
    admin.from('crm_usage_limits').select('plan_code').eq('client_id', invite.client_id).maybeSingle(),
  ]);
  for (const result of [clientResult, memberResult, planResult]) if (result.error) throw result.error;

  if (!clientResult.data) return { response: fail('WORKSPACE_MISSING') };
  if (!memberResult.data) return { response: fail('MEMBERSHIP_MISSING') };

  return {
    hash,
    invite,
    inviteEmail,
    client: clientResult.data,
    membership: memberResult.data,
    planCode: planResult.data?.plan_code || invite.plan_code,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => null);
    const action = body?.action || 'inspect';
    if (!['inspect', 'verify_code', 'set_password', 'claim'].includes(action)) {
      return json({ error: 'Ukendt handling' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const ctx = await contextFor(admin, body?.token, body?.email);
    if ('response' in ctx) return ctx.response;

    const { hash, invite, inviteEmail, client, membership, planCode } = ctx as any;
    const metadata = invite.metadata || {};
    const claimed = invite.status === 'claimed' || !!invite.used_at;
    const otpExpiresAt = metadata.otp_expires_at || null;
    const maxAttempts = Math.max(1, Number(metadata.otp_max_attempts || 5));
    const attempts = Math.max(0, Number(metadata.otp_attempts || 0));
    const codeLocked = Boolean(metadata.otp_locked_at) || attempts >= maxAttempts;
    const codeExpired = otpExpiresAt ? Date.parse(otpExpiresAt) <= Date.now() : false;

    if (action === 'inspect') {
      return json({
        ok: true,
        status: invite.status,
        claimed,
        email: inviteEmail,
        company_name: client.name,
        client_id: invite.client_id,
        plan_code: planCode,
        first_login_mode: metadata.first_login_mode || (metadata.otp_hash ? 'one_time_code' : 'legacy_password'),
        otp_required: Boolean(metadata.otp_hash) && !claimed,
        code_status: claimed ? 'consumed' : codeLocked ? 'locked' : codeExpired ? 'expired' : metadata.otp_hash ? 'ready' : 'missing',
        code_expires_at: otpExpiresAt,
        attempts_remaining: Math.max(0, maxAttempts - attempts),
        expires_at: invite.expires_at,
      });
    }

    if (action === 'claim') {
      if (metadata.otp_hash) {
        return json({
          code: 'CODE_REQUIRED',
          error: 'Denne invitation bruger engangskode. Åbn invitationslinket igen og indtast koden fra mailen.',
        }, 409);
      }
      return json({
        code: 'LEGACY_INVITE_UNSUPPORTED',
        error: 'Denne gamle invitation skal erstattes af en ny invitation med engangskode.',
      }, 409);
    }

    if (claimed) return fail('INVITE_USED');

    if (action === 'verify_code') {
      if (!metadata.otp_hash) return fail('CODE_NOT_CONFIGURED');
      if (codeLocked) return fail('CODE_LOCKED');
      if (codeExpired) return fail('CODE_EXPIRED');

      const code = normCode(body?.code);
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        return json({
          code: 'CODE_INVALID',
          error: 'Indtast den 8-tegns engangskode fra mailen.',
          attempts_remaining: Math.max(0, maxAttempts - attempts),
        }, 400);
      }

      const ticket = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const ticketExpires = new Date(Date.now() + 15 * 60 * 1000);
      const { data: verified, error: verifyError } = await admin.rpc('crm_verify_onboarding_code', {
        p_token_hash: hash,
        p_code_hash: await sha256(code),
        p_ticket_hash: await sha256(ticket),
        p_ticket_expires_at: ticketExpires.toISOString(),
      });
      if (verifyError) throw verifyError;

      if (!verified?.ok) {
        const codeName = String(verified?.code || 'CODE_INVALID');
        if (codeName === 'CODE_INVALID') {
          const remaining = Math.max(0, Number(verified?.attempts_remaining || 0));
          return json({
            code: codeName,
            error: remaining === 1
              ? 'Engangskoden er forkert. Du har 1 forsøg tilbage.'
              : `Engangskoden er forkert. Du har ${remaining} forsøg tilbage.`,
            attempts_remaining: remaining,
          }, 400);
        }
        if (failures[codeName]) return fail(codeName);
        return json({ code: codeName, error: 'Engangskoden kunne ikke bekræftes.' }, 400);
      }

      return json({
        ok: true,
        code: 'CODE_VERIFIED',
        verification_ticket: ticket,
        verification_expires_at: verified.ticket_expires_at || ticketExpires.toISOString(),
      });
    }

    const ticket = String(body?.verification_ticket || '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return fail('VERIFICATION_REQUIRED');

    const fresh = await admin.from('crm_onboarding_invites')
      .select('*')
      .eq('id', invite.id)
      .maybeSingle();
    if (fresh.error) throw fresh.error;
    if (!fresh.data) return fail('INVALID_INVITE');

    const freshMeta = fresh.data.metadata || {};
    const ticketHash = String(freshMeta.password_ticket_hash || '');
    const ticketExpiresAt = Date.parse(String(freshMeta.password_ticket_expires_at || ''));
    if (!freshMeta.otp_verified_at || !ticketHash) return fail('VERIFICATION_REQUIRED');
    if (!Number.isFinite(ticketExpiresAt) || ticketExpiresAt <= Date.now()) return fail('VERIFICATION_EXPIRED');
    if (await sha256(ticket) !== ticketHash) return fail('VERIFICATION_REQUIRED');

    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 256) {
      return json({ code: 'PASSWORD_INVALID', error: 'Indtast en adgangskode på højst 256 tegn.' }, 400);
    }
    if (password.length < 10) {
      return json({ code: 'PASSWORD_TOO_SHORT', error: 'Password skal være mindst 10 tegn.' }, 400);
    }

    const userId = membership.auth_user_id;
    if (!userId) return fail('MEMBERSHIP_MISSING');

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError) throw userError;
    const authUser = userData?.user;
    if (!authUser || normEmail(authUser.email) !== inviteEmail) return fail('MEMBERSHIP_USER_MISMATCH');

    const nextAppMetadata = {
      ...(authUser.app_metadata || {}),
      lead_manager_first_login_pending: false,
    };
    const updated = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      app_metadata: nextAppMetadata,
    });
    if (updated.error) {
      if (isWeakPasswordError(updated.error)) return weakPassword();
      throw updated.error;
    }

    const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: login, error: loginError } = await authClient.auth.signInWithPassword({
      email: inviteEmail,
      password,
    });
    if (loginError || !login?.user || !login?.session) {
      if (isWeakPasswordError(loginError)) return weakPassword();
      if (loginError?.status === 429) {
        return json({ code: 'RATE_LIMITED', error: 'For mange loginforsøg. Vent lidt og prøv igen.' }, 429);
      }
      return json({ code: 'PASSWORD_SET_LOGIN_FAILED', error: 'Adgangskoden blev gemt, men login kunne ikke startes. Prøv igen med samme adgangskode.' }, 500);
    }
    if (login.user.id !== userId) return fail('MEMBERSHIP_USER_MISMATCH');

    const { data: result, error: finalizeError } = await admin.rpc('crm_finalize_onboarding_invite', {
      p_token_hash: hash,
      p_user_id: login.user.id,
      p_verified_email: login.user.email,
    });
    if (finalizeError) {
      const known = Object.keys(failures).find(value => finalizeError.message.includes(value));
      if (known) return fail(known);
      throw finalizeError;
    }

    const finalMetadata = {
      ...freshMeta,
      password_set_at: new Date().toISOString(),
      otp_consumed_at: new Date().toISOString(),
      otp_hash: null,
      otp_verified_at: freshMeta.otp_verified_at || new Date().toISOString(),
      password_ticket_hash: null,
      password_ticket_expires_at: null,
    };
    const { error: metaError } = await admin.from('crm_onboarding_invites')
      .update({ metadata: finalMetadata })
      .eq('id', invite.id);
    if (metaError) console.error('password metadata cleanup failed', { code: metaError.code });

    return json({
      ...result,
      password_set: true,
      first_login_mode: 'one_time_code',
      session: login.session,
    });
  } catch (error) {
    console.error('saas-invite-claim', {
      code: (error as { code?: string })?.code || 'CLAIM_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
    return json({
      code: 'CLAIM_FAILED',
      error: 'Onboarding-login kunne ikke færdiggøres. Prøv igen, eller bed om en ny invitation.',
    }, 500);
  }
});
