import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0027_platform_admin_lifecycle.sql', 'utf8');
const bootstrap = readFileSync('packages/db/migrations/0026_controlled_admin_bootstrap.sql', 'utf8');
const invitations = readFileSync('packages/db/migrations/0019_access_invitations.sql', 'utf8');
const fail = (message) => { console.error(`Platform admin lifecycle check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes('app_platform_admin_identity_is_active'), 'audited active-state evaluator missing.');
req(migration.includes("u.role = 'admin_ifarm'"), 'Neon Auth admin_ifarm role requirement missing.');
req(migration.includes('COALESCE(u."emailVerified", false) = true'), 'verified email requirement missing.');
req(migration.includes('COALESCE(u.banned, false) = false'), 'banned identity rejection missing.');
req(migration.includes("a.action IN ('platform_admin.bootstrap.completed', 'platform_admin.promoted')"), 'authority must require active lifecycle audit state.');
req(migration.includes('CREATE OR REPLACE FUNCTION public.app_is_platform_admin()'), 'authoritative current-session helper must be replaced.');
req(migration.includes('app_platform_admin_revoke_preflight'), 'revocation preflight missing.');
req(migration.includes("RAISE EXCEPTION 'last_platform_admin_revoke_forbidden'"), 'last-admin revocation guard missing.');
req(migration.includes('app_finalize_platform_admin_change'), 'lifecycle audit finalizer missing.');
req(migration.includes("v_action NOT IN ('promote', 'revoke')"), 'lifecycle action allowlist missing.');
req(migration.includes("RAISE EXCEPTION 'additional_admin_requires_existing_admin'"), 'additional admin must require an existing audited-active admin.');
req(migration.includes("'platform_admin.promoted'"), 'promotion audit event missing.');
req(migration.includes("'platform_admin.revoked'"), 'revocation audit event missing.');
req(migration.includes("v_latest_action IS NULL"), 'revocation must fail closed when no prior active audit state exists.');
req(migration.includes("'control_plane', 'neon_auth_operator'"), 'control-plane attribution missing.');
req(migration.includes('REVOKE ALL ON FUNCTION public.app_platform_admin_identity_is_active(uuid)'), 'internal evaluator must be owner-only.');
req(migration.includes('REVOKE ALL ON FUNCTION public.app_platform_admin_revoke_preflight(uuid, text)'), 'preflight must be owner-only.');
req(migration.includes('REVOKE ALL ON FUNCTION public.app_finalize_platform_admin_change(text, uuid, text, text)'), 'finalizer must be owner-only.');
req(!migration.includes('GRANT EXECUTE ON FUNCTION public.app_platform_admin_revoke_preflight'), 'preflight must not be portal-executable.');
req(!migration.includes('GRANT EXECUTE ON FUNCTION public.app_finalize_platform_admin_change'), 'finalizer must not be portal-executable.');
req(!/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+neon_auth\."user"/i.test(migration), 'database migration must never mutate managed Neon Auth users.');
req(bootstrap.includes("'platform_admin.bootstrap.completed'"), 'SEC-185 bootstrap audit prerequisite missing.');
req(invitations.includes("IF v_role IN ('admin_ifarm','authorized_authority','insurance_partner')"), 'tenant invitations must continue excluding admin_ifarm.');

console.log('Platform admin lifecycle check passed: audited authority, owner-only lifecycle controls, last-admin protection and Neon Auth control-plane separation preserved.');
