import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0028_device_key_rotation.sql', 'utf8');
const ui = readFileSync('apps/web/src/TelemetrySetup.tsx', 'utf8');
const docs = readFileSync('docs/security/sec-192-device-key-rotation.md', 'utf8');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const fail = (message) => { console.error(`Device key rotation check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(rootPackage.scripts?.['device-keys:check'] === 'node scripts/device-key-rotation-check.mjs', 'root device-keys:check script must remain registered.');

for (const expected of [
  'ADD COLUMN IF NOT EXISTS rotated_from_key_id',
  'ux_device_ingest_keys_single_rotation_child',
  'CREATE OR REPLACE FUNCTION public.rotate_device_ingest_key',
  "p_overlap_minutes < 5 OR p_overlap_minutes > 1440",
  "RAISE EXCEPTION 'predecessor_already_rotated'",
  "RAISE EXCEPTION 'active_predecessor_key_required'",
  "SET expires_at = v_overlap_until",
  "'device.ingest_key.rotation_started'",
  "'raw_key_stored', false",
  'REVOKE ALL ON FUNCTION public.rotate_device_ingest_key',
  'GRANT EXECUTE ON FUNCTION public.rotate_device_ingest_key'
]) req(migration.includes(expected), `rotation migration invariant missing: ${expected}`);

req(!migration.includes("'key_hash',"), 'audit payload must never include key_hash.');
req(!migration.includes("'raw_key',"), 'audit payload must never include raw key material.');
req(!/RETURN(?:\s+QUERY)?[\s\S]{0,120}p_new_key_hash/i.test(migration), 'rotation RPC must never return the new hash.');

for (const expected of [
  'crypto.getRandomValues(new Uint8Array(32))',
  'sha256Hex(rawKey)',
  "neon.rpc('rotate_device_ingest_key'",
  'p_predecessor_key_id',
  'p_overlap_minutes: rotationOverlapMinutes',
  'EXIBIDA UMA ÚNICA VEZ',
  'Rotacionar'
]) req(ui.includes(expected), `rotation UI invariant missing: ${expected}`);

req(!ui.includes('localStorage.setItem') && !ui.includes('sessionStorage.setItem'), 'raw device key must not be persisted in browser storage.');
req(docs.includes('chave bruta nunca é enviada ao banco'), 'documentation must preserve raw-key isolation.');
req(docs.includes('5 minutos a 24 horas'), 'documentation must preserve the bounded overlap window.');
req(docs.includes('não substitui um processo operacional de atualização do gateway'), 'documentation must not imply automatic device reconfiguration.');

console.log('Device key rotation check passed: client-only raw key generation, hash-only storage, bounded overlap, single successor and audit isolation preserved.');
