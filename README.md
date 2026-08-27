# Lead Manager – Klimaeksperten

Canonical source repository for Klimaekspertens Lead Manager.

## Locked baseline

- Supabase project: `ouqhostcsvdyrkjefiya`
- Edge Function: `lead-manager-customer` v9
- Canonical snapshot: `lead_manager_canonical_baseline_20260827_1242`
- Active snapshot: `lead_manager_customer_v9_followup_recipient_fix`
- Canonical bytes: `164375`
- Canonical MD5: `a9d6fe79e1e3625392b7bdb3598006ef`

The canonical snapshot and active snapshot were verified identical before this repository bootstrap.

## Safety rules

- Never commit service-role keys, OAuth client secrets, API secrets, refresh tokens, or passwords.
- The Supabase publishable/anon browser key used by the existing frontend is public client configuration, not a server secret.
- Test preview before production.
- No automatic email sending: the user must explicitly approve/send.
- Do not mix Skarp Studio code or configuration into this repository.
