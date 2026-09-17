import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0032_asset_position_concurrency_safety.sql','utf8');
const fail = (message) => { console.error(`Asset position ordering check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

requireInvariant(migration.includes("pg_advisory_xact_lock("), 'GPS ingest must acquire a transaction-scoped advisory lock.');
requireInvariant(migration.includes("hashtext('ifarm_security_asset_position')"), 'lock namespace must remain dedicated to iFarm Security asset positions.');
requireInvariant(migration.includes('hashtext(p_asset_id::text)'), 'lock must be scoped by asset id.');
requireInvariant(migration.includes('ingest_asset_position_legacy_impl'), 'existing historical/geofence ordering implementation must remain the semantic source.');
requireInvariant(migration.includes("v_row.transition='duplicate'"), 'idempotent duplicate handling must remain present.');
requireInvariant(migration.includes("RAISE EXCEPTION 'event_id_conflict'"), 'conflicting retries must remain blocked.');
requireInvariant(/REVOKE EXECUTE[\s\S]*FROM PUBLIC,authenticated,anonymous/i.test(migration), 'GPS ingest RPC must remain server-side only.');
requireInvariant(!migration.includes('GRANT EXECUTE') && !migration.includes(' TO authenticated'), 'migration must not expose GPS ingest to portal roles.');

console.log('Asset position ordering check passed: per-asset transaction serialization, replay conflict detection and server-only ingest preserved.');
