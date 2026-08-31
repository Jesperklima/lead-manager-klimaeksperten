# SaaS tenant hardening – 2026-08-31

This branch records the production SaaS hardening applied to the Lead Manager Supabase project before external pilot onboarding.

## Tenant isolation

- `crm_users.auth_user_id` binds CRM membership to Supabase Auth `auth.uid()` rather than mutable email identity.
- Core CRM RLS policies use `crm_has_client_access(client_id)`.
- Final cross-tenant test as the Klimaeksperten authenticated user returned:
  - own client visible: 1
  - foreign client visible: 0
  - foreign company visible: 0
  - foreign leads visible: 0
- Fake isolation tenant was created inside a transaction and rolled back.

## Fair use

Backend tables:
- `crm_usage_limits`
- `crm_usage_events`

Authenticated customers have SELECT-only access to their own usage data. They cannot insert, update or delete limits/events and cannot call `crm_apply_plan`. Plan changes are service-role only.

Default external limits:
- 100 delivered leads/month
- 4 Lead Hunter search runs/day
- 150 contact enrichments/month
- 100 manual CRM email sends/day
- no automatic mass-mail sending

Package feature gates:
- Start: lead CRM + manual CRM email send
- Pro: Start + mail monitoring
- Business: Pro + tender search + Minuba access

Lead quota is enforced from immutable backend `lead_delivered` usage events, so deleting CRM leads cannot reset the monthly quota.

## Generic customer-specific AI engines

The production Lead Hunter, Lead Enricher, Gmail flow and AI mail assistant were changed so they use the current client's profile/data rather than Klimaeksperten-specific assumptions.

Lead Hunter requirements include:
- customer-specific geography
- `capability_profile.lead_trigger_capabilities`
- `capability_profile.documented_segments`
- `capability_profile.supporting_capabilities`
- `capability_profile.hard_exclusions`
- buyer/user vs provider/competitor filtering
- evidence-backed source/location validation

A separate dry-run test profile (`DemoSoft Sales ApS`) using ERP/lagerstyring and Danish production/grossist segments produced only profile-relevant non-cooling leads, proving the engine does not fall back to Klimaeksperten's cooling profile.

## Deployed Supabase Edge Function versions

- `autonomous-lead-hunter-v2` v7 – generic profile-driven buyer-only Lead Hunter; SHA256 `b6eb926058e7f556aaee9f724220c363214bda2f9c20acb01d937d4047617a1b`
- `lead-enrichment-worker` v3 – profile-driven contact enrichment with evidence verification and fair-use; SHA256 `0b97a1d237270f9c2b83f8c5822bdbbbe6a4216b21487c372e6794595bac45fb`
- `gmail-direct-auth` v6 – auth.uid tenant membership and client-specific Gmail account; SHA256 `5d922d24cb131ec5206d36cc237b52b3ef2e978ca63dd9422e2dc1fdfb87fa09`
- `gmail-oauth-callback` v4 – tenant-specific return/account flow; SHA256 `f54614e02f632923a387872c1ea0d59aff00fee4f789fb504f1a743b12ef0866`
- `gmail-direct-send` v5 – client-specific sender/account, fair-use, no hardcoded Jesper assignment; SHA256 `6952cd2fc7e402590277d646db850a8e64d9530b8e4522fdeaefd85141f1b986`
- `crm-ai-mail` v6 – tenant-specific company/tone/context; SHA256 `5a5a6c1b488a3d9afd8d82ae2d7b89bbaf81c9002d4bf331999b2aa286fbefbf`

## Known remaining items before broad public launch

- OpenAI Lead Hunter occasionally returns `invalid_json` for individual search tracks; retry logic exists but reliability should be improved further.
- Minuba external OAuth client currently returns `401 invalid_client`; integration gating is safe, but Minuba is not end-to-end operational until credentials/approval are resolved.
- TOTP/MFA work is still isolated in the existing security PR and is not yet active in production.
- Supabase leaked-password protection is currently disabled.
- `pg_net` remains installed in the public schema and should be reviewed before broad launch.
- A neutral self-service onboarding UI/customer provisioning flow is still required before scalable customer signup.

Do not merge this branch merely from documentation; verify deployed source and migration state against Supabase first.