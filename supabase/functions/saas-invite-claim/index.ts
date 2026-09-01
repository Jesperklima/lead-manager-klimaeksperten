import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

const str = (value: unknown, max = 600) => String(value ?? '').trim().slice(0, max);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
).map((x) => x.toString(16).padStart(2, '0')).join('');

function logError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (typeof err === 'object' && err !== null) {
    const value = err as Record<string, unknown>;
    return {
      message: typeof value.message === 'string' ? value.message : 'Unknown object error',
      code: value.code,
      details: value.details,
      hint: value.hint,
    };
  }
  return { message: String(err) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const inviteToken = str(body.token, 1000);
    const email = str(body.email, 320).toLowerCase();
    const password = String(body.password || '');

    if (inviteToken.length < 30) return json({ error: 'Invitationslinket er ugyldigt', code: 'INVALID_INVITE' }, 400);
    if (!emailOk(email)) return json({ error: 'Indtast en gyldig e-mail' }, 400);
    if (password.length < 10) return json({ error: 'Password skal være mindst 10 tegn' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const hash = await sha256(inviteToken);

    const { data: invite, error: inviteError } = await admin
      .from('crm_onboarding_invites')
      .select('*')
      .eq('token_hash', hash)
      .maybeSingle();
    if (inviteError) throw inviteError;
    if (!invite) return json({ error: 'Invitationslinket findes ikke eller er allerede ugyldigt', code: 'INVALID_INVITE' }, 404);

    if (invite.status === 'claimed' || invite.used_at) return json({ error: 'Invitationslinket er allerede brugt', code: 'INVITE_USED' }, 409);
    if (invite.status === 'revoked') return json({ error: 'Invitationen er trukket tilbage', code: 'INVITE_REVOKED' }, 410);
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await admin.from('crm_onboarding_invites').update({ status: 'expired' }).eq('id', invite.id);
      return json({ error: 'Invitationslinket er udløbet. Bed om en ny invitation.', code: 'INVITE_EXPIRED' }, 410);
    }
    if (String(invite.email).toLowerCase() !== email) return json({ error: 'E-mailadressen matcher ikke invitationen', code: 'EMAIL_MISMATCH' }, 403);

    const { data: membership, error: membershipError } = await admin
      .from('crm_users')
      .select('email,client_id,role,active,auth_user_id')
      .eq('client_id', invite.client_id)
      .ilike('email', email)
      .eq('active', true)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return json({ error: 'Kundeadgangen blev ikke fundet', code: 'MEMBERSHIP_MISSING' }, 404);
    if (membership.auth_user_id) return json({ error: 'Denne invitation er allerede knyttet til et login', code: 'INVITE_USED' }, 409);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        lead_manager_client_id: invite.client_id,
        onboarding_invite_id: invite.id,
      },
    });

    if (createError || !created?.user) {
      const message = typeof createError?.message === 'string' ? createError.message : 'Login kunne ikke oprettes';
      if (/already|registered|exists/i.test(message)) {
        return json({
          error: 'Der findes allerede et login med denne e-mail. Kontakt administratoren, så invitationen kan nulstilles.',
          code: 'AUTH_USER_EXISTS',
        }, 409);
      }
      throw createError || new Error(message);
    }

    const userId = created.user.id;

    // crm_users intentionally has no surrogate id column. Bind the exact pre-invited
    // membership by tenant + invited email, and only while it is still unclaimed.
    const { data: bound, error: bindError } = await admin
      .from('crm_users')
      .update({ auth_user_id: userId })
      .eq('client_id', invite.client_id)
      .ilike('email', email)
      .eq('active', true)
      .is('auth_user_id', null)
      .select('email,client_id,auth_user_id')
      .maybeSingle();

    if (bindError || !bound || bound.auth_user_id !== userId) {
      await admin.auth.admin.deleteUser(userId);
      console.error('invite membership bind failed', logError(bindError || new Error('Membership was not bound')));
      return json({
        error: 'Kundeloginet kunne ikke knyttes til invitationen. Prøv igen.',
        code: 'MEMBERSHIP_BIND_FAILED',
      }, 500);
    }

    const { error: inviteUpdateError } = await admin
      .from('crm_onboarding_invites')
      .update({
        status: 'claimed',
        used_at: new Date().toISOString(),
        metadata: { ...(invite.metadata || {}), claimed_user_id: userId },
      })
      .eq('id', invite.id);

    if (inviteUpdateError) {
      // Roll the whole claim back so the same invitation can safely be retried.
      await admin.from('crm_users')
        .update({ auth_user_id: null })
        .eq('client_id', invite.client_id)
        .ilike('email', email)
        .eq('auth_user_id', userId);
      await admin.auth.admin.deleteUser(userId);
      throw inviteUpdateError;
    }

    const { data: client } = await admin.from('crm_clients').select('id,name').eq('id', invite.client_id).single();
    return json({
      ok: true,
      email,
      client_id: invite.client_id,
      company_name: client?.name || '',
      plan_code: invite.plan_code,
      claimed: true,
    });
  } catch (err) {
    console.error('saas-invite-claim failed', logError(err));
    return json({
      error: 'Login kunne ikke oprettes på grund af en teknisk fejl. Prøv igen.',
      code: 'CLAIM_FAILED',
    }, 500);
  }
});
