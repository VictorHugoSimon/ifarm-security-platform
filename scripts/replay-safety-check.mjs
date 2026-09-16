import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`Replay safety check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

const migration = read('packages/db/migrations/0029_replay_safe_ingestion.sql');
const api = read('apps/api/src/index.ts');

req((migration.match(/RAISE EXCEPTION 'invalid_event_id'/g) || []).length >= 2, 'both external ingest RPCs must require a valid event id.');
req(migration.includes('ON CONFLICT (device_id, event_id) WHERE event_id IS NOT NULL DO NOTHING'), 'heartbeat replay must use atomic ON CONFLICT.');
req(migration.includes('ON CONFLICT (asset_id, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING'), 'asset-position replay must use atomic ON CONFLICT.');
req((migration.match(/SELECT false,/g) || []).length >= 2, 'duplicate delivery must return accepted=false for heartbeat and asset position.');
req(migration.includes("'duplicate'::text"), 'duplicate transition must remain explicit.');
req(migration.includes('FOR UPDATE OF d'), 'device state changes must be serialized per device.');
req(migration.includes('FOR UPDATE OF a'), 'asset/geofence state changes must be serialized per asset.');
req(migration.includes("'historical'::text"), 'historical heartbeat transition must remain explicit.');
req(migration.includes("v_transition := 'historical'"), 'historical asset position transition must remain explicit.');
req(migration.includes('p_source_at < v_latest_effective'), 'older buffered heartbeat must not roll device state backwards.');
req(migration.includes('p_recorded_at >= v_last_position'), 'older buffered asset position must not roll asset state backwards.');
req(migration.includes('source_event_id'), 'security-event metadata must preserve source event identity.');
req(/REVOKE ALL ON FUNCTION public\.ingest_device_heartbeat[\s\S]*?FROM PUBLIC, anonymous, authenticated;/m.test(migration), 'heartbeat ingest RPC must remain outside browser execution.');
req(/REVOKE ALL ON FUNCTION public\.ingest_asset_position[\s\S]*?FROM PUBLIC, anonymous, authenticated;/m.test(migration), 'asset ingest RPC must remain outside browser execution.');
req(api.includes("message.includes('source_time_in_future') || message.includes('invalid_')"), 'heartbeat API must translate invalid_event_id to sanitized 400.');
req(api.includes("if (message.includes('invalid_')) return c.json({ error: 'invalid_position' }, 400);"), 'asset API must translate invalid_event_id to sanitized 400.');

console.log('Replay safety check passed: mandatory event identity, atomic deduplication, serialized state, historical-buffer protection and non-browser RPCs are preserved.');
