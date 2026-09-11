import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`Access audit check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const migration = read('packages/db/migrations/0021_access_audit_center.sql');
const ui = read('apps/web/src/AccessAuditCenter.tsx');

for (const expected of [
  'CREATE OR REPLACE FUNCTION public.app_can_view_access_audit',
  'CREATE OR REPLACE FUNCTION public.audit_access_invitation_accepted',
  'CREATE OR REPLACE FUNCTION public.list_access_audit_events',
  "'access.invitation.accepted'",
  'REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anonymous, authenticated',
  'GRANT EXECUTE ON FUNCTION public.list_access_audit_events(uuid,integer)',
  'p_property_id IS NULL',
  "m.role = 'admin_neighborhood'",
  "m.role = 'owner'"
]) {
  requireInvariant(migration.includes(expected), `migration missing invariant: ${expected}`);
}

requireInvariant(migration.includes('SECURITY DEFINER'), 'audit functions must remain SECURITY DEFINER with explicit scope checks.');
requireInvariant(!migration.includes('GRANT SELECT ON TABLE public.audit_logs'), 'direct SELECT grant on audit_logs is forbidden.');
requireInvariant(!migration.includes('TO anonymous;') || !migration.includes('list_access_audit_events(uuid,integer)\n  TO anonymous'), 'anonymous must not execute access audit RPC.');

requireInvariant(ui.includes("neon.rpc('list_access_audit_events'"), 'UI must consume the sanitized access audit RPC.');
requireInvariant(!ui.includes("from('audit_logs')"), 'UI must never read audit_logs directly.');
requireInvariant(!ui.includes('.details'), 'UI must never receive/render raw audit details.');
requireInvariant(!/email|ip_hash|request_id|email_sha256/i.test(ui), 'audit UI must not expose email/IP/request/hash fields.');

console.log('Access audit check passed: raw audit_logs access revoked, scoped sanitized RPC preserved, invitation acceptance audited, and sensitive fields excluded from browser UI.');
