import { readFileSync } from 'node:fs';

const api = readFileSync('apps/api/src/index.ts', 'utf8');
const config = readFileSync('apps/api/wrangler.stage.toml', 'utf8');
const workflow = readFileSync('.github/workflows/deploy-api-stage.yml', 'utf8');
const tests = readFileSync('apps/api/test/api.test.ts', 'utf8');
const docs = readFileSync('docs/security/sec-193-api-abuse-protection.md', 'utf8');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const fail = (message) => { console.error(`API abuse protection check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(rootPackage.scripts?.['abuse-protection:check'] === 'node scripts/api-abuse-protection-check.mjs', 'root abuse-protection:check script must remain registered.');

for (const expected of [
  'INGEST_ACTOR_RATE_LIMITER?: RateLimitBinding',
  'INGEST_ROUTE_ABUSE_GUARD?: RateLimitBinding',
  "env.APP_ENV === 'stage' || env.APP_ENV === 'production'",
  "key: `route:${routeKey}`",
  "key: `credential:${routeKey}:${keyHash}`",
  "error: 'rate_limited'",
  "error: 'rate_limiter_not_configured'",
  "error: 'rate_limiter_unavailable'",
  "c.header('retry-after'",
  'distributedRateLimitingConfigured(c.env)',
  "reason: 'rate_limiter_not_configured'"
]) req(api.includes(expected), `API rate-limit invariant missing: ${expected}`);

req(!api.includes('cf-connecting-ip'), 'IP address must not be the primary rate-limit identity for rural/shared networks.');
req(!/structuredLog\([^\n]+keyHash/.test(api), 'credential hash must never be logged.');
req(!/structuredLog\([^\n]+rawKey/.test(api), 'raw device key must never be logged.');

for (const expected of [
  'name = "INGEST_ACTOR_RATE_LIMITER"',
  'namespace_id = "193001"',
  'limit = 120',
  'name = "INGEST_ROUTE_ABUSE_GUARD"',
  'namespace_id = "193002"',
  'limit = 6000',
  'period = 60',
  'IFARM_SECURITY_RATE_LIMIT_NAMESPACES_APPROVED=true'
]) req(config.includes(expected), `STAGE rate-limit config missing: ${expected}`);

req(workflow.includes('vars.IFARM_SECURITY_RATE_LIMIT_NAMESPACES_APPROVED'), 'API deploy must require explicit namespace approval.');
req(workflow.includes('pnpm abuse-protection:check'), 'API deploy must run abuse protection gate.');
req(workflow.includes('"distributedRateLimitingConfigured":true'), 'API STAGE smoke must require configured distributed rate limiting.');

for (const expected of [
  'route abuse guard returns 429',
  'actor rate limiter uses a SHA-256 derived key',
  'actor limiter returns 429',
  'STAGE ingest fails closed when distributed limiter bindings are absent',
  'STAGE readiness fails closed when distributed limiter bindings are absent'
]) req(tests.includes(expected), `rate-limit test missing: ${expected}`);

req(docs.includes('não é mecanismo de faturamento'), 'documentation must state rate limiting is not accounting.');
req(docs.includes('por localização Cloudflare'), 'documentation must state Cloudflare locality semantics.');
req(docs.includes('não usar IP como identidade primária'), 'documentation must preserve rural/shared-network guidance.');

console.log('API abuse protection check passed: STAGE fail-closed bindings, hashed credential identity, route circuit breaker, 429 semantics and namespace approval gate preserved.');
