# Corrective release — 10 October 2026

This release closes confirmed access, consent, launch and mail-delivery gaps in the deployed Lead Manager.

- Privileged API actions check current database roles, an active login session and MFA before mutations or provider calls. Anonymous execution of five privileged RPCs is removed.
- Contact consent preserves explicit false and unknown values. Interest text alone cannot grant consent.
- Email purpose defaults to direct marketing. Operational exceptions require matching inbound dialogue or protected integration evidence. Browser writes cannot fabricate inbound sender or Minuba relationship evidence.
- Gmail and Microsoft submissions use stable identities and atomic daily reservations. Provider acceptance and confirmed delivery are separate states. Uncertain submissions never trigger an automatic resend.
- Every five minutes, reconciliation checks existing uncertain Gmail jobs against the Sent folder and finalizes already acknowledged jobs. Microsoft uncertainty requires provider verification.
- Contact workers claim queued work atomically. AI billing failures pause further dispatch. Lead Hunter requires actual agreement evidence or a reviewed internal model.
- Platform operations show actual worker failures, mail uncertainty, billing pause and configured schedules. Onboarding reports when an agreement blocks Lead Hunter.
- Pull requests and main-branch pushes run the complete release gate on a pinned Node runtime.

## Deployment and validation

Twenty-three Edge Functions and twelve database migrations were deployed to the existing Supabase project. Migration filenames use the versions actually returned by production. New function files that were missing from this repository preserve the deployed implementation before applying the corrective changes.

Run `bash scripts/release-gate.sh` with Node 24.15.0 and Python 3 available. On Windows, `PYTHON_BIN` can point to the installed Python executable. All existing release checks, five onboarding invitation tests and twenty-eight new behavioral tests pass.

`scripts/verify-corrective-database.sql` verifies session/MFA guards, protected integration and inbound evidence, withdrawal preservation, the operations snapshot and atomic mail capacity. Each transaction rolls back; it does not send mail. Run only against a database with representative fixtures and a current platform administrator session.

The first production reconciliation returned HTTP 200 and processed three legacy uncertain jobs. All three remain `unknown`; no matching Sent-folder evidence was found. No test emails were sent.

## Remaining evidence and external actions

This release is not a claim that every audit concern is resolved. Historical consent records need evidence review. Provider approval, billing remediation, pending agreement acceptance, leaked-password protection, a tested backup restore, retention policy execution and a full audit of the remaining function surface require further evidence or external action.

A successful queue dispatch does not prove successful work, and provider acceptance does not prove delivery. Keep uncertain legacy mail jobs visible until checked in the provider mailbox.

Rollback the website to its preceding Vercel deployment if necessary. Do not remove the database access/MFA guards or resume uncertain mail by deleting its send identity. Edge-function rollback must preserve the shared guard and consent protections.
