# Lead Manager release process

> Status: PREPARED, NOT ACTIVE.
> Continue the existing release/deployment workflow until Jesper explicitly activates the staging model.

## Prepared future model

- `feature/*`, `fix/*`, `security/*`, `ops/*`: development branches.
- `staging`: future isolated release-candidate environment.
- `main`: production.

When activated, the intended flow is:

1. Build work on a feature/fix branch.
2. Run GitHub baseline, required-feature and onboarding checks.
3. Merge approved work to `staging`.
4. Run the full release gate and browser/API smoke against isolated staging.
5. Promote/merge `staging -> main` only when green.
6. Verify production and retain the previous READY deployment for rollback.

## Current mode

The staging enforcement, staging-only Vercel branch policy and mandatory staging-to-main gate are intentionally disabled.
The existing Lead Manager workflow remains active until Jesper asks to enable the staging model.

## Future database safety

Before staging is activated for write-capable testing, it must use a separate Supabase development branch/project. Production customer data must not be the destructive test environment.
