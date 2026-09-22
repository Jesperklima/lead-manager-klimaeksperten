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
const text = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const PROD = 'https://lead-manager-klimaeksperten.vercel.app';
const INVITE_VALIDITY_DAYS = 14;
const b64url = (bytes: Uint8Array) => {
  let bin = '';
  for (const value of bytes) bin += String.fromCharCode(value);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
).map(byte => byte.toString(16).padStart(2, '0')).join('');
const encodedWord = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return '=?UTF-8?B?' + btoa(bin) + '?=';
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Mangler login' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const actor = userData?.user;
    if (userError || !actor?.id || !actor.email) return json({ error: 'Ugyldigt login' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = text(body.action || 'list', 40).toLowerCase();
    const clientId = text(body.client_id, 100);
    if (!clientId) return json({ error: 'client_id mangler' }, 400);

    const { data: actorMemberships, error: actorMembershipError } = await admin
      .from('crm_users')
      .select('client_id,role,email,active,auth_user_id')
      .eq('auth_user_id', actor.id)
      .eq('active', true);
    if (actorMembershipError) throw actorMembershipError;

    let platformAdmin = false;
    for (const membership of actorMemberships || []) {
      if (!['owner', 'admin'].includes(String(membership.role || '').toLowerCase())) continue;
      const { data: limit, error: limitError } = await admin
        .from('crm_usage_limits')
        .select('plan_code')
        .eq('client_id', membership.client_id)
        .maybeSingle();
      if (limitError) throw limitError;
      if (limit?.plan_code === 'internal') {
        platformAdmin = true;
        break;
      }
    }

    const directMembership = (actorMemberships || []).find(m => String(m.client_id) === clientId);
    const hasWorkspaceAccess = !!directMembership || platformAdmin;
    const canManage = platformAdmin || ['owner', 'admin'].includes(String(directMembership?.role || '').toLowerCase());
    if (!hasWorkspaceAccess) return json({ error: 'Du har ikke adgang til dette workspace', code: 'WORKSPACE_FORBIDDEN' }, 403);

    const { data: client, error: clientError } = await admin
      .from('crm_clients')
      .select('id,name')
      .eq('id', clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return json({ error: 'Workspace findes ikke' }, 404);

    const requireManage = () => {
      if (!canManage) return json({ error: 'Kun Owner/Admin kan administrere brugere', code: 'ADMIN_ONLY' }, 403);
      return null;
    };

    const listUsers = async () => {
      const { data: users, error: usersError } = await admin
        .from('crm_users')
        .select('email,role,active,auth_user_id,created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true });
      if (usersError) throw usersError;

      const { data: invites, error: invitesError } = await admin
        .from('crm_onboarding_invites')
        .select('email,status,sent_at,expires_at,created_at,metadata')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (invitesError) throw invitesError;

      const latestWorkspaceInvite = new Map<string, any>();
      for (const invite of invites || []) {
        if (invite?.metadata?.invite_type !== 'workspace_user') continue;
        const key = String(invite.email || '').toLowerCase();
        if (!latestWorkspaceInvite.has(key)) latestWorkspaceInvite.set(key, invite);
      }

      return (users || []).map(member => {
        const invite = latestWorkspaceInvite.get(String(member.email || '').toLowerCase()) || null;
        const pending = !member.auth_user_id && member.active && !!invite && ['created', 'sent', 'send_failed'].includes(invite.status);
        return {
          email: member.email,
          role: member.role,
          active: member.active,
          activated: !!member.auth_user_id,
          pending,
          invite_status: invite?.status || null,
          invite_sent_at: invite?.sent_at || null,
          invite_expires_at: invite?.expires_at || null,
          created_at: member.created_at,
          is_self: String(member.email || '').toLowerCase() === String(actor.email || '').toLowerCase(),
        };
      });
    };

    const sendInvite = async (email: string, role: string) => {
      const { data: limit, error: limitError } = await admin
        .from('crm_usage_limits')
        .select('plan_code')
        .eq('client_id', clientId)
        .maybeSingle();
      if (limitError) throw limitError;
      const invitePlan = ['start', 'pro', 'business'].includes(String(limit?.plan_code || ''))
        ? String(limit?.plan_code)
        : 'business';

      const rawToken = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(rawToken);
      const expiresAt = new Date(Date.now() + INVITE_VALIDITY_DAYS * 86400000);

      const { data: previousInvites, error: previousError } = await admin
        .from('crm_onboarding_invites')
        .select('id,metadata,status,used_at')
        .eq('client_id', clientId)
        .ilike('email', email)
        .in('status', ['created', 'sent', 'send_failed']);
      if (previousError) throw previousError;
      const revokeIds = (previousInvites || [])
        .filter(invite => !invite.used_at && invite?.metadata?.invite_type === 'workspace_user')
        .map(invite => invite.id);
      if (revokeIds.length) {
        const { error: revokeError } = await admin
          .from('crm_onboarding_invites')
          .update({ status: 'revoked' })
          .in('id', revokeIds);
        if (revokeError) throw revokeError;
      }

      const metadata = {
        company_name: client.name,
        invite_type: 'workspace_user',
        role,
        invited_by: actor.email,
        onboarding_version: 'saas_v6',
      };
      const { data: invite, error: inviteError } = await admin
        .from('crm_onboarding_invites')
        .insert({
          client_id: clientId,
          email,
          token_hash: tokenHash,
          plan_code: invitePlan,
          status: 'created',
          expires_at: expiresAt.toISOString(),
          created_by_user_id: actor.id,
          created_by_email: actor.email,
          metadata,
        })
        .select('id')
        .single();
      if (inviteError || !invite) throw inviteError || new Error('Invitation kunne ikke oprettes');

      const { data: internalLimits, error: internalError } = await admin
        .from('crm_usage_limits')
        .select('client_id')
        .eq('plan_code', 'internal')
        .limit(20);
      if (internalError) throw internalError;

      let mailMaterial: any = null;
      for (const row of internalLimits || []) {
        const { data: material, error: materialError } = await admin.rpc('get_gmail_oauth_material', {
          p_client_id: row.client_id,
        });
        if (materialError) continue;
        if (material?.client_id && material?.client_secret && material?.refresh_token) {
          mailMaterial = material;
          break;
        }
      }
      if (!mailMaterial) {
        await admin.from('crm_onboarding_invites').update({ status: 'send_failed' }).eq('id', invite.id);
        throw new Error('Lead Managers systemmail er ikke forbundet');
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: String(mailMaterial.client_id),
          client_secret: String(mailMaterial.client_secret),
          refresh_token: String(mailMaterial.refresh_token),
          grant_type: 'refresh_token',
        }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token) {
        await admin.from('crm_onboarding_invites').update({ status: 'send_failed' }).eq('id', invite.id);
        throw new Error(String(tokenData?.error_description || tokenData?.error || 'Systemmail kunne ikke forny adgang'));
      }

      const roleLabel = role === 'admin' ? 'Admin' : 'Bruger';
      const inviteLink = PROD + '/api/app?onboarding=' + encodeURIComponent(rawToken);
      const plain =
        'Hej\n\n' +
        'Du er inviteret til Lead Manager for ' + client.name + ' som ' + roleLabel + '.\n\n' +
        'Klik på linket nedenfor for at oprette eller bekræfte dit login:\n' +
        inviteLink + '\n\n' +
        'Linket er aktivt i ' + INVITE_VALIDITY_DAYS + ' dage og udløber ' + expiresAt.toLocaleDateString('da-DK') + '.\n\n' +
        'Med venlig hilsen\nLead Manager';

      const from = String(mailMaterial.account || 'Lead Manager');
      const mime = [
        'From: ' + from,
        'To: ' + email,
        'Subject: ' + encodedWord('Du er inviteret til ' + client.name + ' i Lead Manager'),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        plain,
      ].join('\r\n');
      const raw = b64url(new TextEncoder().encode(mime));
      const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tokenData.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const sendData = await sendResponse.json().catch(() => ({}));
      if (!sendResponse.ok) {
        await admin.from('crm_onboarding_invites').update({ status: 'send_failed' }).eq('id', invite.id);
        throw new Error(String(sendData?.error?.message || 'Invitationen kunne ikke sendes'));
      }

      await admin.from('crm_onboarding_invites').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: { ...metadata, gmail_message_id: sendData.id || null },
      }).eq('id', invite.id);

      await admin.from('crm_activities').insert({
        client_id: clientId,
        type: 'Brugerinvitation',
        actor_type: 'user',
        actor_name: actor.email,
        summary: 'Brugerinvitation sendt til ' + email + ' som ' + roleLabel,
        metadata: { target_email: email, role, invite_id: invite.id, invite_type: 'workspace_user' },
      });

      return {
        sent: true,
        expires_at: expiresAt.toISOString(),
        invite_status: 'sent',
      };
    };

    if (action === 'list') {
      return json({
        ok: true,
        client_id: clientId,
        workspace_name: client.name,
        can_manage: canManage,
        actor_email: actor.email,
        users: await listUsers(),
      });
    }

    const manageError = requireManage();
    if (manageError) return manageError;

    if (action === 'invite') {
      const email = text(body.email, 320).toLowerCase();
      const role = text(body.role || 'user', 20).toLowerCase();
      if (!emailOk(email)) return json({ error: 'Ugyldig e-mail' }, 400);
      if (!['admin', 'user'].includes(role)) return json({ error: 'Rollen skal være Admin eller Bruger' }, 400);

      const { data: existing, error: existingError } = await admin
        .from('crm_users')
        .select('email,client_id,role,active,auth_user_id')
        .ilike('email', email)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing && String(existing.client_id) !== clientId) {
        return json({
          error: 'Denne e-mail er allerede knyttet til et andet workspace. Lead Manager understøtter endnu ikke samme login på flere workspaces.',
          code: 'EMAIL_OTHER_WORKSPACE',
        }, 409);
      }
      if (existing?.role === 'owner') {
        return json({ error: 'Workspace Owner kan ikke geninviteres som almindelig bruger', code: 'OWNER_PROTECTED' }, 409);
      }
      if (existing?.active && existing?.auth_user_id) {
        return json({ error: 'Brugeren er allerede aktiv i dette workspace', code: 'ALREADY_ACTIVE' }, 409);
      }

      if (existing) {
        const { error: updateError } = await admin.from('crm_users')
          .update({ role, active: true })
          .ilike('email', email)
          .eq('client_id', clientId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await admin.from('crm_users').insert({
          client_id: clientId,
          email,
          role,
          active: true,
          auth_user_id: null,
        });
        if (insertError) throw insertError;
      }

      const inviteResult = await sendInvite(email, role);
      return json({ ok: true, email, role, ...inviteResult, users: await listUsers() });
    }

    if (action === 'resend') {
      const email = text(body.email, 320).toLowerCase();
      if (!emailOk(email)) return json({ error: 'Ugyldig e-mail' }, 400);
      const { data: member, error: memberError } = await admin.from('crm_users')
        .select('email,client_id,role,active,auth_user_id')
        .eq('client_id', clientId)
        .ilike('email', email)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member || !member.active) return json({ error: 'Brugeren findes ikke eller er deaktiveret' }, 404);
      if (member.auth_user_id) return json({ error: 'Brugeren er allerede aktiveret', code: 'ALREADY_ACTIVE' }, 409);
      if (member.role === 'owner') return json({ error: 'Owner-invitation håndteres af kunde-onboarding', code: 'OWNER_PROTECTED' }, 409);
      const inviteResult = await sendInvite(email, member.role);
      return json({ ok: true, email, role: member.role, ...inviteResult, users: await listUsers() });
    }

    if (action === 'change_role') {
      const email = text(body.email, 320).toLowerCase();
      const role = text(body.role, 20).toLowerCase();
      if (!emailOk(email)) return json({ error: 'Ugyldig e-mail' }, 400);
      if (!['admin', 'user'].includes(role)) return json({ error: 'Rollen skal være Admin eller Bruger' }, 400);
      const { data: member, error: memberError } = await admin.from('crm_users')
        .select('email,role,active')
        .eq('client_id', clientId)
        .ilike('email', email)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return json({ error: 'Brugeren findes ikke' }, 404);
      if (member.role === 'owner') return json({ error: 'Owner-rollen er beskyttet', code: 'OWNER_PROTECTED' }, 409);
      const { error: updateError } = await admin.from('crm_users')
        .update({ role })
        .eq('client_id', clientId)
        .ilike('email', email);
      if (updateError) throw updateError;
      await admin.from('crm_activities').insert({
        client_id: clientId,
        type: 'Brugeradministration',
        actor_type: 'user',
        actor_name: actor.email,
        summary: 'Rolle ændret for ' + email + ': ' + member.role + ' → ' + role,
        metadata: { target_email: email, previous_role: member.role, next_role: role },
      });
      return json({ ok: true, email, role, users: await listUsers() });
    }

    if (action === 'deactivate') {
      const email = text(body.email, 320).toLowerCase();
      if (!emailOk(email)) return json({ error: 'Ugyldig e-mail' }, 400);
      if (email === String(actor.email || '').toLowerCase()) {
        return json({ error: 'Du kan ikke deaktivere din egen adgang', code: 'SELF_PROTECTED' }, 409);
      }
      const { data: member, error: memberError } = await admin.from('crm_users')
        .select('email,role,active')
        .eq('client_id', clientId)
        .ilike('email', email)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return json({ error: 'Brugeren findes ikke' }, 404);
      if (member.role === 'owner') return json({ error: 'Workspace Owner kan ikke deaktiveres her', code: 'OWNER_PROTECTED' }, 409);

      const { error: updateError } = await admin.from('crm_users')
        .update({ active: false })
        .eq('client_id', clientId)
        .ilike('email', email);
      if (updateError) throw updateError;

      const { data: pendingInvites } = await admin.from('crm_onboarding_invites')
        .select('id,metadata')
        .eq('client_id', clientId)
        .ilike('email', email)
        .in('status', ['created', 'sent', 'send_failed']);
      const revokeIds = (pendingInvites || [])
        .filter(invite => invite?.metadata?.invite_type === 'workspace_user')
        .map(invite => invite.id);
      if (revokeIds.length) {
        await admin.from('crm_onboarding_invites').update({ status: 'revoked' }).in('id', revokeIds);
      }

      await admin.from('crm_activities').insert({
        client_id: clientId,
        type: 'Brugeradministration',
        actor_type: 'user',
        actor_name: actor.email,
        summary: 'Bruger deaktiveret: ' + email,
        metadata: { target_email: email, previous_role: member.role },
      });
      return json({ ok: true, email, active: false, users: await listUsers() });
    }

    return json({ error: 'Ukendt handling' }, 400);
  } catch (error) {
    console.error('saas-workspace-users', { error: error instanceof Error ? error.message : String(error) });
    return json({ error: error instanceof Error ? error.message : String(error), code: 'WORKSPACE_USERS_FAILED' }, 500);
  }
});
