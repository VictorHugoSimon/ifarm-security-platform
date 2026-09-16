import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0031_heartbeat_ordering_safety.sql', 'utf8');
const fail = (message) => { console.error(`Heartbeat ordering check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes('ADD COLUMN IF NOT EXISTS last_heartbeat_source_at timestamptz'), 'device heartbeat ordering watermark is missing.');
req(migration.includes('max(coalesce(t.source_at, t.received_at))'), 'existing telemetry must backfill the ordering watermark.');
req(migration.includes('FOR UPDATE OF d'), 'current device state must be serialized before heartbeat state changes.');
req(migration.includes('v_effective_source_at := coalesce(p_source_at, v_received)'), 'heartbeat ordering must use source time with receive-time fallback.');
req(migration.includes('v_effective_source_at <= v_last_heartbeat_source_at'), 'equal/older source timestamps must not supersede current state.');
req(migration.includes("SELECT true, v_old_status, v_received, 'historical'::text"), 'delayed heartbeat must be accepted as historical while preserving current status.');

const historicalPos = migration.indexOf('IF v_is_historical THEN');
const currentStateUpdatePos = migration.indexOf('UPDATE public.devices\n  SET status = p_status');
const eventInsertPos = migration.indexOf('INSERT INTO public.security_events');
req(historicalPos >= 0, 'historical branch missing.');
req(eventInsertPos > historicalPos, 'status event generation must happen only after historical early-return.');
req(currentStateUpdatePos > historicalPos, 'device current-state update must happen only after historical early-return.');
req(migration.includes('last_heartbeat_source_at = v_effective_source_at'), 'accepted current heartbeat must advance the ordering watermark.');
req(migration.includes('last_seen_at = v_received'), 'accepted current heartbeat must preserve receive-time health semantics.');
req(migration.includes('REVOKE EXECUTE ON FUNCTION public.ingest_device_heartbeat_legacy_impl'), 'internal ingest implementation must remain non-portal-executable.');
req(migration.includes('FROM PUBLIC, authenticated, anonymous'), 'internal ingest implementation must be revoked from browser roles.');

console.log('Heartbeat ordering check passed: delayed offline-sync telemetry is retained without regressing current device state or generating false status transitions.');
