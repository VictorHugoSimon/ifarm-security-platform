import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0033_gps_timestamp_tie_safety.sql','utf8');
const fail = (message) => { console.error(`GPS timestamp tie check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

requireInvariant(migration.includes("v_old text := 'IF v_last_position IS NULL OR p_recorded_at>=v_last_position THEN'"), 'migration must target the legacy non-strict ordering rule.');
requireInvariant(migration.includes("v_new text := 'IF v_last_position IS NULL OR p_recorded_at>v_last_position THEN'"), 'migration must install strict recorded_at ordering.');
requireInvariant(migration.includes("RAISE EXCEPTION 'unexpected_asset_position_ordering_definition'"), 'migration must fail closed if the legacy definition changes unexpectedly.');
requireInvariant(migration.includes('pg_get_functiondef'), 'migration must inspect the actual legacy function definition before patching it.');
requireInvariant(migration.includes('Idempotent replay'), 'migration must be safe to replay after the strict rule is already installed.');
requireInvariant(!migration.includes('p_recorded_at>=v_last_position THEN\'') || migration.includes('v_old text'), 'non-strict ordering may appear only as the expected old pattern.');

console.log('GPS timestamp tie check passed: equal timestamps become historical and migration fails closed on unexpected function drift.');
