import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0026_controlled_admin_bootstrap.sql', 'utf8');
const authGate = readFileSync('apps/web/src/AuthGate.tsx', 'utf8');
const invitationMigration = readFileSync('packages/db/migrations/0019_access_invitations.sql', 'utf8');
const fail = (message) => { console.error(`Admin bootstrap check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes("u.role = 'admin_ifarm'"), 'platform admin must be derived from Neon Auth role.');
req(migration.includes('COALESCE(u."emailVerified", false) = true'), 'platform admin must require verified email at database authority.');
req(migration.includes('COALESCE(u.banned, false) = false'), 'platform admin must reject banned identities.');
req(migration.includes('app_finalize_first_platform_admin_bootstrap'), 'owner-only bootstrap finalizer missing.');
req(migration.includes("RAISE EXCEPTION 'bootstrap_already_recorded'"), 'bootstrap must be one-time after audit completion.');
req(migration.includes("RAISE EXCEPTION 'first_admin_must_be_unique'"), 'first platform admin must be unique.');
req(migration.includes("RAISE EXCEPTION 'auth_user_email_mismatch'"), 'bootstrap must bind auth_user_id to expected email.');
req(migration.includes("'platform_admin.bootstrap.completed'"), 'bootstrap audit action missing.');
req(migration.includes("'control_plane', 'neon_auth_operator'"), 'audit must identify Neon Auth as the control plane.');
req(migration.includes('REVOKE ALL ON FUNCTION public.app_finalize_first_platform_admin_bootstrap(uuid, text, text)\n  FROM PUBLIC, anonymous, authenticated'), 'bootstrap finalizer must not be portal-executable.');
req(!migration.includes('GRANT EXECUTE ON FUNCTION public.app_finalize_first_platform_admin_bootstrap'), 'bootstrap finalizer must never be granted to portal roles.');
req(authGate.includes('user?.emailVerified !== true'), 'frontend verified-email gate must remain enabled.');
req(invitationMigration.includes("IF v_role IN ('admin_ifarm','authorized_authority','insurance_partner')"), 'tenant invitation flow must route admin_ifarm to separate onboarding.');
req(invitationMigration.includes("RAISE EXCEPTION 'invitation_role_requires_separate_onboarding'"), 'tenant invitation flow must reject admin_ifarm.');

console.log('Admin bootstrap check passed: verified/non-banned platform authority, owner-only one-time finalizer, email binding, audit trail and tenant invitation exclusion preserved.');
