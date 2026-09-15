import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0026_controlled_admin_bootstrap.sql', 'utf8');
const ruralMigration = readFileSync('packages/db/migrations/0003_rural_structure.sql', 'utf8');
const authGate = readFileSync('apps/web/src/AuthGate.tsx', 'utf8');
const invitationMigration = readFileSync('packages/db/migrations/0019_access_invitations.sql', 'utf8');
const fail = (message) => { console.error(`Admin bootstrap check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes("u.role = 'admin_ifarm'"), 'platform admin must be derived from Neon Auth role.');
req(migration.includes('COALESCE(u."emailVerified", false) = true'), 'platform admin must require verified email at database authority.');
req(migration.includes('COALESCE(u.banned, false) = false'), 'platform admin must reject banned identities.');
req(migration.includes('REVOKE ALL ON FUNCTION public.app_is_platform_admin() FROM PUBLIC, anonymous, authenticated'), 'platform admin helper must not inherit PUBLIC execution.');
req(migration.includes('GRANT EXECUTE ON FUNCTION public.app_is_platform_admin() TO authenticated'), 'authenticated session must be able to evaluate platform-admin status.');
req(!migration.includes('app_finalize_first_platform_admin_bootstrap'), 'bootstrap-specific privileged finalizer must not exist.');

req(ruralMigration.includes('CREATE OR REPLACE FUNCTION app_ensure_platform_user()'), 'existing platform user materialization helper must remain present.');
req(ruralMigration.includes('IF NOT app_is_platform_admin() THEN'), 'materialization must depend on the hardened platform-admin authority.');
req(ruralMigration.includes('IF NOT COALESCE(v_verified, false) THEN'), 'materialization must independently require verified email.');
req(ruralMigration.includes('v_user := app_ensure_platform_user();'), 'organization creation must materialize the verified platform admin before tenant creation.');
req(ruralMigration.includes("VALUES (v_org, v_user, 'admin_ifarm', 'active')"), 'first tenant creation must bind the platform admin to the created organization for audit/operations.');

req(authGate.includes('user?.emailVerified !== true'), 'frontend verified-email gate must remain enabled.');
req(invitationMigration.includes("IF v_role IN ('admin_ifarm','authorized_authority','insurance_partner')"), 'tenant invitation flow must route admin_ifarm to separate onboarding.');
req(invitationMigration.includes("RAISE EXCEPTION 'invitation_role_requires_separate_onboarding'"), 'tenant invitation flow must reject admin_ifarm.');

console.log('Admin bootstrap check passed: Neon Auth is authoritative, platform admin requires verified/non-banned identity, no privileged bootstrap RPC exists, and tenant invitations cannot grant admin_ifarm.');
