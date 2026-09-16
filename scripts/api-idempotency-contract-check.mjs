import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`API idempotency contract check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

const api = read('apps/api/src/index.ts');
const tests = read('apps/api/test/api.test.ts');
const docs = read('docs/security/sec-197-api-idempotency-contract.md');

requireInvariant(api.includes("const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;"), 'Worker event id regex must match the database contract.');
requireInvariant(api.includes("export function isValidEventId(value: unknown): value is string"), 'event id validator must remain explicit and testable.');
requireInvariant((api.match(/if \(!isValidEventId\(eventId\)\) return c\.json\(\{ error: 'invalid_event_id' \}, 400\);/g) || []).length === 2, 'both ingest routes must reject missing/unsafe event ids before SQL.');
requireInvariant((api.match(/\$\{eventId\}::text/g) || []).length === 2, 'both SQL calls must use the already validated event id.');
requireInvariant(!api.includes('${body.eventId ?? null}::text'), 'nullable event id must never reach ingest SQL.');
requireInvariant(tests.includes("isValidEventId(undefined), false"), 'tests must cover missing event id.');
requireInvariant(tests.includes("isValidEventId('a'.repeat(128)), true"), 'tests must preserve 128-character upper bound.');
requireInvariant(tests.includes("isValidEventId('a'.repeat(129)), false"), 'tests must reject event ids over 128 characters.');
requireInvariant(tests.includes("isValidEventId('bad id with spaces'), false"), 'tests must reject spaces.');
requireInvariant(tests.includes("isValidEventId('bad/route'), false"), 'tests must reject slash characters.');
requireInvariant(docs.includes('não gera `eventId` automaticamente'), 'documentation must preserve device-generated idempotency semantics.');

console.log('API idempotency contract check passed: stable safe event ids are mandatory before database access.');
