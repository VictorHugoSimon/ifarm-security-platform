# SEC-130 — DEV → STAGE Promotion Readiness

## Objective
Prepare a controlled first promotion of the iFarm Security database from DEV to STAGE without touching PROD and without reusing credentials, Auth, Data API, storage, tokens, users or secrets from another environment or project.

## Current snapshot — 2026-09-09
- DEV: migrations 0001 through 0016 applied/versioned.
- STAGE: 0 iFarm Security application tables.
- PROD: 0 iFarm Security application tables.
- Repository visibility: public by deliberate development decision.
- Public repository is allowed only while there are no real secrets, credentials, production endpoints with privileged access, private evidence, real camera data or customer data committed or wired into deploy automation.

## Hard gates before any STAGE promotion
1. Main CI green: security check, migration inventory, automated tests, typecheck and build.
2. Repository migration inventory contiguous from 0001 with no gaps or duplicates.
3. STAGE resources must be exclusive to iFarm Security.
4. Provision STAGE Neon Auth and Data API independently. Do not reuse DEV Auth/Data API configuration, users or credentials.
5. Confirm STAGE exposes the schemas/roles required by migration 0002 (`neon_auth`, auth integration and `authenticated` role) before applying it.
6. Confirm required extensions for the application schema, including `pgcrypto` and `postgis`.
7. Keep STAGE CORS limited to the future STAGE frontend origin; do not copy DEV localhost policy blindly.
8. Do not configure Cloudflare secrets, storage credentials, device keys, WhatsApp/SMS/e-mail providers or real customer data while the repository is public.
9. Promotion must be DEV → STAGE only. PROD remains untouched until a separate release approval.

## Promotion procedure
1. Record the exact `main` commit SHA approved for release.
2. Run `pnpm security:check`, `pnpm migrations:check`, `pnpm test`, `pnpm typecheck`, `pnpm build`.
3. Verify STAGE is empty or explicitly backed up. If it ever contains real data, require a backup/restore plan before migration.
4. Provision/validate STAGE Auth + Data API first.
5. Apply migrations strictly in filename order: 0001, 0002, ... through the approved last migration.
6. Stop immediately on the first SQL error. Do not skip a migration and do not apply later files out of order.
7. After schema creation, run smoke checks and negative authorization tests.
8. Compare DEV × STAGE schema. Investigate any unexpected difference before accepting STAGE.
9. Record release evidence: commit SHA, migration range, date/time, executor, test result and known deviations.

## Mandatory smoke checks
- `organizations`, `neighborhoods`, `properties`, `devices`, `security_events`, `incidents`, `evidence`, `assets`, community, insurance and SOS structures exist.
- RLS is enabled on tenant-sensitive tables.
- Unauthenticated/no-session access returns no tenant data.
- A neighborhood admin cannot read private-property devices solely because they administer the neighborhood.
- Community route points only reference `community_shared=true` devices with `property_id IS NULL`.
- `private_device_sharing_allowed` remains false.
- Device heartbeat/GPS ingestion functions are not executable by normal `authenticated` portal users.
- Evidence/recording catalog RPCs do not expose physical `storage_key` values.
- Government/biometric integration remains disabled/not configured.
- Operations overview keeps `human_monitoring_assumed=false` and `public_dispatch_enabled=false`.

## Rollback rule
For the first empty STAGE build, rollback means discarding/recreating the isolated STAGE branch/database from a known clean baseline and replaying the approved migrations. After STAGE contains meaningful data, destructive recreation is no longer acceptable without an explicit backup/restore and data-loss assessment.

## PROD gate
Do not promote to PROD until all of the following are separately approved: repository privatization, production Auth/MFA policy, production CORS, secrets management, private evidence/video storage, observability/incident response, pilot data policy, retention rules and legal/LGPD review where required.
