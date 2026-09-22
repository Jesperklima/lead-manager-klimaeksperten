# Onboarding chain verification, 2026-09-22

## Release scope

- One invitation-owned entry point: `/api/app?onboarding=...`; invitation inspection supplies the email, workspace and actual plan.
- Password-authenticated identity, membership binding and token consumption are finalized using a service-role-only transaction. Retries cannot reset an existing password or delete an account.
- The browser adopts the verified session, resets stale workspace state, passes the existing MFA gate, and resumes the four-step onboarding from persisted state.
- Save errors stop progression. Missing plans are explicit errors rather than an implicit Start downgrade.
- Removed unused onboarding v2-v5 and the old pilot signup/email lock. Removed the legacy startup substitution that produced an invalid inline script after `else if`.
- Invitation reissue revokes only pending invitations for that workspace/email and retains workspace data, plan and memberships.

## Evidence before release

- Full `scripts/release-gate.sh`: PASS, including existing workspace, admin, mail and performance regressions and script syntax audits.
- `node --test scripts/test-onboarding-chain.js`: PASS; signup, retry after transient finalization failure, existing login, invalid/revoked/expired tokens, email mismatch, password validation, revocation during login and concurrent claims.
- `node scripts/test-onboarding-browser.js`: PASS twice; real application scripts with mocked external services, MFA, all onboarding steps, failed-save recovery, reload/resume, used and invalid links, and no global signout or browser exceptions.
- `node scripts/test-onboarding-live.js`: PASS at 2026-09-21T17:59:29.159Z against the real Supabase project using JWT-protected, identity-scoped preview functions and a newly issued Vention/Thomas invitation.
- Live test covered account creation, TOTP enrollment and challenge, all four steps, Business plan, Vention-only workspace visibility through RLS, logout and subsequent password/MFA login. No JavaScript exceptions or failed HTTP responses were recorded.
- Automated lead dispatch/activation was suppressed in the preview to avoid generating business activity. Mail connection was skipped. Sending real mail and lead generation are not claimed as tested by this onboarding test.

## Cleanup and preservation

- Deleted the temporary runner and only the Thomas auth account created by this test; removed their sessions and refresh tokens first.
- Revoked the consumed test invitation and restored Vention's original profile, legal profile and unbound Thomas membership. Business limits remained unchanged.
- Removed the two specifically identified test audit/activity records.
- Verified zero remaining test auth accounts and unchanged settings/membership/plan fingerprints for Klimaeksperten ApS, Minuba, Skarp Studio and kontorfunktionen. No claim is made that unrelated live business activity was frozen.
- Both temporary preview functions were replaced with inert HTTP 410 handlers with JWT protection retained. They contain no database or auth operations. Physical deletion is not available through the connected tools and requires a dashboard session or an authenticated Supabase CLI.
- The live-test configuration is ignored and is not part of this repository. Re-running the live test requires a newly approved, fresh test setup; never reuse its consumed token.

## Coordinated release

1. Add the service-role-only SQL functions; these are additive and do not affect existing callers. The live project received `atomic_onboarding_claim` followed by `onboarding_verified_auth_identity`; the repository migration contains the resulting final definitions.
2. Require green regression and browser checks before release.
3. Deploy the tested `saas-invite-claim`, `saas-onboarding` and `saas-admin-invite` functions. Preserve their existing JWT settings: claim uses its invitation/password authentication; the other two require JWTs.
4. Merge the tested frontend and verify the production Vercel deployment uses the merged commit.
5. Issue a new, unused invitation for Thomas and inspect it without consuming it. Check production entry routes and the actual rendered form.

Do not run a blanket database rollback or restore: other workspaces are live. If application rollback is required, restore only the previous frontend/function versions; leave the additive service-role-only SQL functions in place.

## Production verification and visual follow-up

- PR #106 merged as `df2a26ba7331b4201a316b9ce3f5e4b29625e226`; Vercel production deployment `dpl_HKuhXMUGzu4uw4fq64PNQx6gPoUE` was READY on the canonical domain.
- Released Supabase versions: `saas-invite-claim` 4, `saas-onboarding` 15, `saas-admin-invite` 7.
- Production `/`, `/login`, `/index`, `/api/app` and both onboarding startup bundles returned HTTP 200. Fresh invitation inspection returned Thomas/Vention/Business with `claimed:false` and `existing_login:false`; wrong-email and invalid-token requests were rejected.
- Visual inspection found inherited dark-theme text on the light onboarding card. Scoped colors now isolate onboarding from the application theme; browser tests enforce at least 4.5:1 contrast for heading, secondary text, labels and links, plus a 375px mobile form-fit check. The covered background login is excluded from accessibility and keyboard focus.
- The full browser chain and release gate were repeated after this visual correction. The correction changes no backend or invitation state.
- Supabase advisors confirm no warnings for the two new service-only functions. Separate pre-existing warnings include `pg_net` in public and anonymous execution on other SECURITY DEFINER functions; those unrelated database definitions were not changed. Review: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
