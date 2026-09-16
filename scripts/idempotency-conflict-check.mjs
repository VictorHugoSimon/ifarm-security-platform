import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`Idempotency conflict check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

const migration = read('packages/db/migrations/0030_idempotency_conflict_detection.sql');

requireInvariant(migration.includes("RAISE EXCEPTION 'event_id_conflict'"), 'conflicting retry must raise event_id_conflict.');
requireInvariant(migration.includes("v_existing.status IS DISTINCT FROM p_status"), 'heartbeat duplicate must compare status.');
requireInvariant(migration.includes("v_existing.source_at IS DISTINCT FROM p_source_at"), 'heartbeat duplicate must compare source timestamp.');
requireInvariant(migration.includes("v_existing.metadata IS DISTINCT FROM coalesce(p_metadata,'{}'::jsonb)"), 'heartbeat duplicate must compare metadata.');
requireInvariant(migration.includes('v_existing.device_id IS DISTINCT FROM p_device_id'), 'asset duplicate must compare linked GPS device.');
requireInvariant(migration.includes('v_existing.recorded_at IS DISTINCT FROM p_recorded_at'), 'asset duplicate must compare recorded time.');
requireInvariant(migration.includes('v_existing.latitude IS DISTINCT FROM p_latitude'), 'asset duplicate must compare latitude.');
requireInvariant(migration.includes('v_existing.longitude IS DISTINCT FROM p_longitude'), 'asset duplicate must compare longitude.');
requireInvariant(migration.includes('ST_Y(ap.position::geometry)'), 'asset duplicate must derive stored latitude.');
requireInvariant(migration.includes('ST_X(ap.position::geometry)'), 'asset duplicate must derive stored longitude.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_device_heartbeat\([\s\S]*FROM PUBLIC,authenticated,anonymous;/.test(migration), 'heartbeat wrapper must remain server-side only.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_asset_position\([\s\S]*FROM PUBLIC,authenticated,anonymous;/.test(migration), 'asset wrapper must remain server-side only.');

console.log('Idempotency conflict check passed: repeated event ids may only repeat the original semantic payload.');
