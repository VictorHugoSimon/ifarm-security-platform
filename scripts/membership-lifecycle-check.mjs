import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0020_membership_lifecycle.sql', 'utf8');
const compact = migration.replace(/\s+/g, ' ');
const fail = (message) => {
  console.error(`Membership lifecycle check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

for (const column of ['status_changed_at','status_changed_by_user_id','status_reason']) {
  requireInvariant(migration.includes(column), `memberships must keep ${column}.`);
}

requireInvariant(compact.includes("status IN ('active','suspended','revoked')"), 'membership status allowlist changed unexpectedly.');
requireInvariant(migration.includes('membership_revoked_terminal'), 'revoked membership must remain terminal.');
requireInvariant(migration.includes('membership_reason_required'), 'suspend/revoke must require a reason.');
requireInvariant(migration.includes("target.user_id IS DISTINCT FROM public.app_current_user_id()"), 'actors must not manage their own membership through the generic lifecycle surface.');

for (const role of ['admin_ifarm','authorized_authority','insurance_partner']) {
  requireInvariant(migration.includes(role), `${role} must remain outside generic membership lifecycle.`);
}

for (const role of ['admin_organization','admin_neighborhood','owner','family','employee','technician','monitoring']) {
  requireInvariant(migration.includes(`'${role}'`), `${role} tenant lifecycle role is missing.`);
}

requireInvariant(migration.includes("target.role <> 'admin_organization'"), 'tenant admins must not manage another Admin Organization.');
requireInvariant(migration.includes("target.property_id IS NULL") && migration.includes("target.role IN ('technician','monitoring')"), 'Admin Bairro must remain community-only for technician/monitoring management.');
requireInvariant(migration.includes("target.property_id IS NOT NULL") && migration.includes("target.role IN ('family','employee','technician','monitoring')"), 'Owner management must remain property-scoped and role-limited.');

for (const action of [
  'access.membership.suspended',
  'access.membership.revoked',
  'access.membership.reactivated'
]) {
  requireInvariant(migration.includes(action), `audit action missing: ${action}`);
}

requireInvariant(migration.includes('REVOKE ALL ON TABLE public.memberships FROM PUBLIC, anonymous, authenticated'), 'memberships table must not be directly exposed to browser roles.');
requireInvariant(migration.includes('REVOKE ALL ON FUNCTION public.app_can_manage_membership(uuid)'), 'internal membership helper must not be executable by browser roles.');
requireInvariant(migration.includes('GRANT EXECUTE ON FUNCTION public.list_managed_memberships(uuid)') && migration.includes('TO authenticated'), 'authenticated must receive list_managed_memberships EXECUTE.');
requireInvariant(migration.includes('GRANT EXECUTE ON FUNCTION public.set_membership_status(uuid,text,text)') && migration.includes('TO authenticated'), 'authenticated must receive set_membership_status EXECUTE.');

console.log('Membership lifecycle check passed: scoped management, terminal revoke, reason/audit trail and no direct browser table access preserved.');
