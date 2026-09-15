import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0028_device_ingest_key_lifecycle.sql', 'utf8');
const ui = readFileSync('apps/web/src/TelemetrySetup.tsx', 'utf8');
const api = readFileSync('apps/api/src/index.ts', 'utf8');
const docs = readFileSync('docs/security/sec-191-device-ingest-key-lifecycle.md', 'utf8');

const fail = (message) => { console.error(`Device ingest key lifecycle check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

for (const expected of [
  'ALTER COLUMN expires_at SET NOT NULL',
  'device_ingest_keys_hash_format',
  'device_ingest_keys_label_length',
  'device_ingest_keys_expiration_window',
  "now() + interval '90 days'",
  "now() + interval '365 days'",
  "'raw_key_stored', false",
  "THEN 'expired'"
]) req(migration.includes(expected), `migration missing invariant: ${expected}`);

req(migration.includes('SECURITY DEFINER'), 'registration RPC must remain SECURITY DEFINER after DML hardening.');
req(migration.includes('GRANT EXECUTE ON FUNCTION public.register_device_ingest_key') && migration.includes('TO authenticated'), 'authenticated management execute grant missing.');
req(migration.includes('REVOKE ALL ON FUNCTION public.register_device_ingest_key') && migration.includes('anonymous'), 'anonymous/public execute must remain revoked.');
req(!/RETURN QUERY[\s\S]{0,800}key_hash/i.test(migration), 'list RPC must not return key_hash.');

req(ui.includes('crypto.getRandomValues(new Uint8Array(32))'), 'raw key must be generated with Web Crypto.');
req(ui.includes("crypto.subtle.digest('SHA-256'"), 'raw key must be SHA-256 hashed before registration.');
req(ui.includes('p_key_hash: hash'), 'RPC must receive only the derived hash.');
req(ui.includes('p_expires_at: expiresAt'), 'UI must send explicit expiration.');
req(ui.includes('const [expiryDays, setExpiryDays] = useState<number>(90)'), 'UI default lifetime must remain 90 days.');
req(ui.includes('30, 60, 90, 180, 365'), 'approved expiration choices changed unexpectedly.');
req(ui.includes('Já configurei — ocultar'), 'one-generation hide control missing.');
req(!ui.includes('localStorage') && !ui.includes('sessionStorage'), 'raw device key must never enter browser persistent storage.');
req(!ui.includes('console.log(generatedKey') && !ui.includes('console.log(rawKey'), 'raw device key must never be logged.');

req(api.includes("deviceKeyFromAuthorization"), 'API Device authorization parser missing.');
req(api.includes('sha256Hex(rawKey)'), 'Worker must hash the raw Device key before database validation.');
req(!api.includes('structuredLog') || !/structuredLog\([^)]*rawKey/.test(api), 'Worker must never log raw device key.');
req(docs.includes('Admin Bairro não recebe acesso automático a chaves de câmeras privadas'), 'Community/private isolation rule missing from runbook.');

console.log('Device ingest key lifecycle check passed: bounded expiration, SHA-256-only persistence, one-generation raw secret handling, rotation guidance and scope isolation preserved.');
