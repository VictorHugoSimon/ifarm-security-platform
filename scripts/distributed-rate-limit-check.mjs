import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`Distributed rate limiting check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

const api = read('apps/api/src/index.ts');
const stage = read('apps/api/wrangler.stage.toml');
const tests = read('apps/api/test/api.test.ts');
const ci = read('.github/workflows/ci.yml');

req(api.includes('INGEST_DEVICE_RATE_LIMITER?: RateLimit'), 'device limiter binding must remain declared.');
req(api.includes('INGEST_ROUTE_RATE_LIMITER?: RateLimit'), 'route limiter binding must remain declared.');
req(api.includes("env.APP_ENV === 'stage' || env.APP_ENV === 'production'"), 'STAGE/PROD must require distributed rate limiting.');
req(api.includes("error: 'rate_limiter_not_configured'"), 'missing limiter must fail closed in STAGE/PROD.');
req(api.includes("error: 'rate_limiter_unavailable'"), 'limiter failures must fail closed in STAGE/PROD.');
req(api.includes("error: 'rate_limited'"), 'rate limited requests must return a sanitized error.');
req(api.includes("c.header('retry-after', '60')"), '429 response must advertise retry-after.');
req(api.includes('await sha256Hex(rawKey)'), 'raw device credential must be hashed before being used as a rate-limit key.');
req(!api.includes('cf-connecting-ip'), 'IP address must not be used as the limiter identity.');
req(!api.includes("structuredLog('warn', 'ingest_rate_limited', { rawKey"), 'raw device credential must never be logged.');
req(api.includes('distributedRateLimitingConfigured: rateLimiterConfigured(c.env)'), 'system status must report live binding presence.');

for (const binding of ['INGEST_DEVICE_RATE_LIMITER', 'INGEST_ROUTE_RATE_LIMITER']) {
  req(stage.includes(`name = "${binding}"`), `STAGE config missing ${binding}.`);
}
req(stage.includes('namespace_id = "1932609161"'), 'device limiter namespace must stay project-exclusive.');
req(stage.includes('namespace_id = "1932609162"'), 'route limiter namespace must stay project-exclusive.');
req(stage.includes('limit = 120') && stage.includes('limit = 6000'), 'provisional STAGE limits changed without review.');
req((stage.match(/period = 60/g) || []).length === 2, 'both limiters must use the documented 60-second window.');

req(tests.includes('STAGE ingest fails closed when rate limiting bindings are missing'), 'missing-binding fail-closed test is required.');
req(tests.includes('rate limiting uses a hashed device credential and returns 429'), 'hashed-key/429 test is required.');
req(tests.includes('system status reports distributed rate limiting when both bindings exist'), 'status binding test is required.');
req(ci.includes('Validate API STAGE Worker config'), 'CI must dry-run the STAGE Worker configuration.');
req(ci.includes('wrangler@4.130.0 deploy --config apps/api/wrangler.stage.toml --dry-run'), 'CI must validate the STAGE rate-limit bindings through Wrangler dry-run.');

console.log('Distributed rate limiting check passed: STAGE bindings, fail-closed behavior, hashed device identity, dual limits, tests and Wrangler dry-run are preserved.');
