# Gmail restricted-scope readiness — Lead Manager — 2026-09-17

Status: preparation checklist. This document does not claim that Google verification, CASA/security assessment or restricted-scope approval has been completed.

## Current integration scope

Lead Manager has code paths that request Gmail read access (`https://www.googleapis.com/auth/gmail.readonly`) when mail monitoring is enabled. Gmail restricted scopes require additional Google verification/security handling for many external production use cases, especially where restricted data is transmitted to or stored by a server.

## Before broad external rollout

### OAuth application and identity
- Confirm the final Google Cloud project and commercial entity that owns the OAuth app.
- Use verified production domains controlled by that entity.
- Ensure app name, homepage, support contact, privacy-policy URL and terms URL are consistent.
- Remove stale development/test redirect URIs and test accounts that are no longer required.
- Verify every redirect URI exactly matches the deployed production callback.

### Scope minimisation
- Keep Gmail read access disabled unless the customer's plan/feature actually requires mail monitoring.
- Request only the Gmail scopes needed for the enabled feature.
- Keep sending and reading purposes separate where technically possible.
- Document why each requested scope is necessary and what user-visible feature depends on it.

### Data handling evidence
Prepare evidence showing:
- which Gmail fields/content are accessed;
- where data is stored;
- tenant isolation/RLS;
- encryption in transit and at rest;
- retention/minimisation policy;
- deletion/offboarding flow;
- data-subject/privacy-request handling;
- logging and incident response;
- subprocessors that may receive Gmail-derived data;
- AI usage boundaries, if Gmail content can be sent to an AI processor.

### Security verification/CASA readiness
If Google requires a security assessment for the final architecture/use case, prepare:
- architecture/data-flow diagram;
- penetration/security testing evidence;
- dependency and vulnerability-management process;
- access-control/RBAC evidence;
- secrets management;
- audit logging;
- incident response;
- backup/deletion procedures;
- least-privilege demonstration;
- public privacy policy and data-use disclosures that match the actual product.

Do not mark the platform as verified until Google/assessor evidence exists.

### User controls
Customers should be able to:
- see whether Gmail is connected;
- understand what access is requested and why;
- disconnect the integration;
- understand what stored/synchronised data remains after disconnect;
- request deletion/offboarding according to the retention policy.

### Google API Services User Data Policy review
Before submission, review the then-current Google API Services User Data Policy, OAuth verification requirements and restricted-scope requirements. Requirements can change and must be rechecked against the current official Google documentation rather than this dated checklist.

## Technical release gate

The Gmail integration is not considered broad-launch ready until:
1. production scopes and OAuth client are confirmed;
2. privacy/terms links are live;
3. required Google verification is completed;
4. any required security assessment is completed;
5. data retention/deletion is demonstrably implemented;
6. tenant isolation and OAuth state/PKCE/callback controls are tested;
7. the subprocessor/DPA register is reviewed for the actual Gmail data path.
