import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`Ingest replay protection check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const migration = read('packages/db/migrations/0029_ingest_replay_protection.sql');
const telemetry = read('packages/db/migrations/0006_device_telemetry.sql');
const assets = read('packages/db/migrations/0012_asset_security.sql');

requireInvariant(telemetry.includes('CREATE UNIQUE INDEX idx_device_telemetry_event ON public.device_telemetry(device_id,event_id) WHERE event_id IS NOT NULL'), 'heartbeat idempotency unique index must remain present.');
requireInvariant(assets.includes('CREATE UNIQUE INDEX asset_positions_asset_event_uq ON asset_positions(asset_id,source_event_id) WHERE source_event_id IS NOT NULL'), 'asset position idempotency unique index must remain present.');
requireInvariant(migration.includes('ingest_device_heartbeat_legacy_impl'), 'heartbeat implementation must remain behind replay-safe wrapper.');
requireInvariant(migration.includes('ingest_asset_position_legacy_impl'), 'asset position implementation must remain behind replay-safe wrapper.');
requireInvariant(migration.includes("p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9._:-]{1,128}$'"), 'heartbeat event id must be mandatory and format-restricted.');
requireInvariant(migration.includes("p_source_event_id IS NULL OR p_source_event_id !~ '^[A-Za-z0-9._:-]{1,128}$'"), 'asset event id must be mandatory and format-restricted.');
requireInvariant(migration.includes("CASE WHEN x.transition='duplicate' THEN false ELSE x.accepted END"), 'heartbeat duplicate retry must report accepted=false.');
requireInvariant(migration.includes('EXCEPTION WHEN unique_violation'), 'heartbeat concurrent duplicate race must be handled idempotently.');
requireInvariant(migration.includes("'duplicate'::text"), 'duplicate result marker must remain explicit.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_device_heartbeat_legacy_impl[\s\S]*FROM PUBLIC, authenticated, anonymous;/.test(migration), 'legacy heartbeat implementation must not be browser-executable.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_asset_position_legacy_impl[\s\S]*FROM PUBLIC, authenticated, anonymous;/.test(migration), 'legacy asset implementation must not be browser-executable.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_device_heartbeat\([\s\S]*FROM PUBLIC, authenticated, anonymous;/.test(migration), 'heartbeat wrapper must remain server-side only.');
requireInvariant(/REVOKE EXECUTE ON FUNCTION public\.ingest_asset_position\([\s\S]*FROM PUBLIC, authenticated, anonymous;/.test(migration), 'asset wrapper must remain server-side only.');

console.log('Ingest replay protection check passed: stable event ids required, duplicate retries remain idempotent and ingest RPCs remain server-side only.');
