import { readFileSync } from 'node:fs';

const compact = (text) => text.replace(/\s+/g, ' ').trim();
const migration = compact(readFileSync('packages/db/migrations/0018_privilege_hardening.sql', 'utf8'));
const fail = (message) => {
  console.error(`Privilege hardening check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

for (const signature of [
  'public.register_device_ingest_key(uuid,text,text,timestamptz)',
  'public.revoke_device_ingest_key(uuid)',
  'public.set_property_location(uuid,double precision,double precision)',
  'public.set_property_boundary(uuid,jsonb)',
  'public.set_area_boundary(uuid,jsonb)'
]) {
  requireInvariant(
    migration.includes(`ALTER FUNCTION ${signature} SECURITY DEFINER`),
    `${signature} must remain SECURITY DEFINER before browser DML is revoked.`
  );
}

requireInvariant(
  migration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated'),
  'authenticated direct DML must be revoked on public base tables.'
);
requireInvariant(
  migration.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anonymous'),
  'anonymous direct DML must be revoked on public base tables.'
);
requireInvariant(
  migration.includes("has_function_privilege('authenticated', r.oid, 'EXECUTE')") &&
    migration.includes('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC') &&
    migration.includes('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anonymous') &&
    migration.includes('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated'),
  'application function EXECUTE preservation/revocation loop changed unexpectedly.'
);
requireInvariant(
  migration.includes("d.classid = 'pg_proc'::regclass") && migration.includes("d.deptype = 'e'"),
  'extension-owned functions must stay outside application privilege rewriting.'
);
requireInvariant(
  migration.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'),
  'future application functions must not default to PUBLIC EXECUTE.'
);
requireInvariant(
  migration.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated'),
  'future tables must not default to authenticated direct DML.'
);

console.log('Privilege hardening check passed: anonymous app EXECUTE and direct browser DML are closed by SEC-172.');
