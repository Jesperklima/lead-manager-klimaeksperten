import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
};
const fail = (code: string) => json({ code, error: failures[code][1] }, failures[code][0]);
const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
).map(byte => byte.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => null);
    const action = body?.action || 'claim';
    const token = body?.token;
    if (!['inspect', 'claim'].includes(action)) return json({ error: 'Ukendt handling' }, 400);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return fail('INVALID_INVITE');
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const hash = await sha256(token);
    const { data: invite, error: lookupError } = await admin.from('crm_onboarding_invites')
      .select('*').eq('token_hash', hash).maybeSingle();
    if (lookupError) throw lookupError;
    if (!invite) return fail('INVALID_INVITE');
    if (invite.status === 'revoked') return fail('INVITE_REVOKED');
    const expiresAt = Date.parse(invite.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || invite.status === 'expired') return fail('INVITE_EXPIRED');
    if (!['created', 'sent', 'claimed'].includes(invite.status)) return fail('INVALID_INVITE');
    const inviteEmail = String(invite.email).trim().toLowerCase();
    if (body.email && String(body.email).trim().toLowerCase() !== inviteEmail) return fail('EMAIL_MISMATCH');
    const [clientResult, memberResult, planResult] = await Promise.all([
      admin.from('crm_clients').select('id,name').eq('id', invite.client_id).maybeSingle(),
      admin.from('crm_users').select('email,client_id,auth_user_id,active')
        .eq('client_id', invite.client_id).eq('email', invite.email).eq('active', true).maybeSingle(),
      admin.from('crm_usage_limits').select('plan_code').eq('client_id', invite.client_id).maybeSingle(),
    ]);
    for (const result of [clientResult, memberResult, planResult]) if (result.error) throw result.error;
    const client = clientResult.data;
    const membership = memberResult.data;
    if (!client) return fail('WORKSPACE_MISSING');
    if (!membership) return fail('MEMBERSHIP_MISSING');
    const claimed = invite.status === 'claimed' || !!invite.used_at;
    if (action === 'inspect') return json({
      ok: true, status: invite.status, claimed, email: inviteEmail,
      company_name: client.name, client_id: invite.client_id,
      plan_code: planResult.data?.plan_code || invite.plan_code,
      existing_login: !!membership.auth_user_id, expires_at: invite.expires_at,
    });

    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 256) return json({ code: 'PASSWORD_INVALID', error: 'Indtast en adgangskode på højst 256 tegn.' }, 400);
    const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let reusedExistingLogin = true;
    let userId = membership.auth_user_id;
    if (!userId && !claimed) {
      if (password.length < 10) return json({ code: 'PASSWORD_TOO_SHORT', error: 'Password skal være mindst 10 tegn.' }, 400);
      const created = await admin.auth.admin.createUser({
        email: inviteEmail, password, email_confirm: true,
        app_metadata: { onboarding_invite_id: invite.id },
      });
      if (created.error && !['email_exists', 'user_already_exists'].includes(created.error.code || '')
        && !/already|registered|exists/i.test(created.error.message)) throw created.error;
      if (created.data?.user) {
        userId = created.data.user.id;
        reusedExistingLogin = false;
      }
    }
    const { data: login, error: loginError } = await authClient.auth.signInWithPassword({ email: inviteEmail, password });
    if (loginError || !login?.user || !login?.session) {
      return json({
        code: loginError?.status === 429 ? 'RATE_LIMITED' : 'EXISTING_LOGIN_PASSWORD_REQUIRED',
        error: loginError?.status === 429 ? 'For mange forsøg. Vent lidt og prøv igen.' : 'Login kunne ikke bekræftes. Brug dit eksisterende password, eller vælg Glemt adgangskode.',
        existing_login: true,
      }, loginError?.status === 429 ? 429 : 409);
    }
    if (userId && userId !== login.user.id) return fail('MEMBERSHIP_USER_MISMATCH');
    const { data: result, error: finalizeError } = await admin.rpc('crm_finalize_onboarding_invite', {
      p_token_hash: hash, p_user_id: login.user.id, p_verified_email: login.user.email,
    });
    if (finalizeError) {
      const code = Object.keys(failures).find(value => finalizeError.message.includes(value));
      if (code) return fail(code);
      throw finalizeError;
    }
    return json({ ...result, reused_existing_login: reusedExistingLogin, session: login.session });
  } catch (error) {
    console.error('saas-invite-claim', { code: (error as { code?: string })?.code || 'CLAIM_FAILED' });
    return json({ code: 'CLAIM_FAILED', error: 'Login kunne ikke færdiggøres. Prøv igen med samme adgangskode.' }, 500);
  }
});
