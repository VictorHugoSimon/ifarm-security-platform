import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`Ingest conflict response check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

const api = read('apps/api/src/index.ts');
const tests = read('apps/api/test/api.test.ts');
const docs = read('docs/security/sec-196-ingest-conflict-response.md');

requireInvariant(api.includes("export function isIdempotencyConflictError(message: string) { return message.includes('event_id_conflict'); }"), 'explicit conflict classifier must remain present.');
requireInvariant((api.match(/ingest_idempotency_conflict/g) || []).length === 2, 'heartbeat and asset-position must both emit the sanitized conflict log event.');
requireInvariant(api.includes("route: 'heartbeat'"), 'heartbeat conflict log must identify only the route.');
requireInvariant(api.includes("route: 'asset-position'"), 'asset conflict log must identify only the route.');
requireInvariant((api.match(/c\.json\(\{ error: 'event_id_conflict', requestId: c\.get\('requestId'\) \}, 409\)/g) || []).length === 2, 'both ingest endpoints must return sanitized 409 + requestId.');
requireInvariant(!/ingest_idempotency_conflict[^\n]*(?:rawKey|keyHash|metadataJson|deviceId|assetId|body|message)/.test(api), 'conflict log must not include credentials, payload, resource IDs or database message.');
requireInvariant(tests.includes("isIdempotencyConflictError('NeonDbError: event_id_conflict'), true"), 'classifier positive test must remain.');
requireInvariant(tests.includes("isIdempotencyConflictError('invalid_event_id'), false"), 'classifier negative test must remain.');
requireInvariant(docs.includes('HTTP `409 Conflict`'), 'SEC-196 documentation must preserve the 409 contract.');
requireInvariant(docs.includes('não prova automática de ataque'), 'SEC-196 must preserve the non-attribution principle.');

console.log('Ingest conflict response check passed: conflicts map to sanitized 409 responses and minimal structured logs.');
