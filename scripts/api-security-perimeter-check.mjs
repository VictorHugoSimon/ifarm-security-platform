import { readFileSync } from 'node:fs';

const api = readFileSync('apps/api/src/index.ts', 'utf8');
const tests = readFileSync('apps/api/test/api.test.ts', 'utf8');
const docs = readFileSync('docs/security/sec-191-api-security-perimeter.md', 'utf8');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const fail = (message) => { console.error(`API security perimeter check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(rootPackage.scripts?.['api-security:check'] === 'node scripts/api-security-perimeter-check.mjs', 'root api-security:check script must remain registered.');

for (const expected of [
  'MAX_INGEST_BODY_BYTES = 32768',
  "mediaType !== 'application/json'",
  "error: 'unsupported_media_type'",
  "error: 'payload_too_large'",
  "error: 'method_not_allowed'",
  "error: 'not_found'",
  "c.header('cache-control', 'no-store')",
  "c.header('x-content-type-options', 'nosniff')",
  "c.header('x-frame-options', 'DENY')",
  "frame-ancestors 'none'",
  'distributedRateLimitingConfigured: rateLimiterConfigured(c.env)',
  'app.notFound('
]) req(api.includes(expected), `runtime perimeter invariant missing: ${expected}`);

for (const expected of [
  'oversized actual payload even without content-length',
  'unsupported media type',
  'wrong method with sanitized 405',
  'unknown endpoint returns sanitized 404',
  'all API responses carry defensive headers',
  'distributedRateLimitingConfigured'
]) req(tests.includes(expected), `test coverage missing: ${expected}`);

req(!api.includes('Access-Control-Allow-Origin: *'), 'wildcard CORS is forbidden on the ingest Worker.');
req(!api.includes("'access-control-allow-origin', '*'"), 'wildcard CORS header is forbidden on the ingest Worker.');
req(docs.includes('não substitui rate limiting distribuído'), 'documentation must state that application perimeter alone does not replace distributed rate limiting.');
req(docs.includes('SEC-193 — Distributed Rate Limiting'), 'SEC-191 documentation must delegate the real distributed control to SEC-193.');

console.log('API security perimeter check passed: body/media-type limits, method/not-found contracts, defensive headers and honest distributed-rate-limit status preserved.');
