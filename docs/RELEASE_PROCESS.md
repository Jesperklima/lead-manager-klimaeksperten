# Lead Manager release process

## Branches

- `feature/*`, `fix/*`, `security/*`, `ops/*`: development only. GitHub CI runs, but Vercel does not build them.
- `staging`: release candidate. This is the only non-production branch allowed to build on Vercel.
- `main`: production only.

## Normal release

1. Build work on a feature/fix branch.
2. Open PR to `staging`.
3. Require baseline, required-feature, onboarding and Release gate to pass.
4. Deploy `staging` once and run browser/API smoke tests.
5. Only after staging is green, open PR `staging -> main`.
6. Main deploys once to production.
7. Verify production and keep the previous READY deployment available for rollback.

## Hotfix

Critical production fixes may use `hotfix/* -> main`, but must still pass Release gate before merge.

## Vercel build budget

Vercel Git deployments are disabled for all branches except `staging` and `main`.
This avoids preview builds for every development commit and reduces build-rate-limit incidents.

## Database safety

Do not use production data as a destructive test environment.
Staging must use a separate Supabase development branch/project before write-capable browser testing is enabled.
