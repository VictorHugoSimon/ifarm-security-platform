import { readFileSync } from 'node:fs';

const config = readFileSync('apps/api/wrangler.stage.toml', 'utf8');
const workflow = readFileSync('.github/workflows/deploy-api-stage.yml', 'utf8');
const api = readFileSync('apps/api/src/index.ts', 'utf8');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const fail = (message) => { console.error(`API STAGE readiness check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(config.includes('name = "ifarm-security-api-stage"'), 'STAGE Worker name must remain exclusive.');
req(config.includes('main = "src/index.ts"'), 'STAGE Worker entrypoint changed unexpectedly.');
req(config.includes('APP_ENV = "stage"'), 'APP_ENV must be stage.');
req(config.includes('APP_NAME = "iFarm Security"'), 'APP_NAME changed unexpectedly.');
req(config.includes('crons = ["*/5 * * * *"]'), '5-minute stale-device reconciliation cron must remain configured.');
req(config.includes('workers_dev = true'), 'workers.dev endpoint must remain enabled until a dedicated API domain is approved.');
req(config.includes('preview_urls = false'), 'preview URLs must remain disabled for the STAGE ingest Worker.');
req(!/postgres(?:ql)?:\/\//i.test(config), 'database URL must never be committed in Wrangler config.');
req(!/^\s*DATABASE_URL\s*=/m.test(config), 'DATABASE_URL must not be a plaintext Wrangler var.');

req(rootPackage.scripts?.['api-stage:check'] === 'node scripts/api-stage-readiness-check.mjs', 'root api-stage:check script must remain registered.');
req(rootPackage.scripts?.['api-security:check'] === 'node scripts/api-security-perimeter-check.mjs', 'root api-security:check script must remain registered.');

for (const expected of [
  "github.repository == 'VictorHugoSimon/ifarm-security-platform'",
  "github.ref == 'refs/heads/main'",
  '${{ github.event.repository.visibility }}',
  'IFARM_SECURITY_API_STAGE_WORKER: ifarm-security-api-stage',
  'secrets.IFARM_SECURITY_CLOUDFLARE_API_TOKEN',
  'secrets.IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID',
  'secrets.IFARM_SECURITY_STAGE_DATABASE_URL',
  '--config apps/api/wrangler.stage.toml',
  '--secrets-file "$SECRET_FILE"',
  '--strict',
  'pnpm api-stage:check',
  'pnpm api-security:check',
  '-D "$HEALTH_HEADERS" "$API_URL/health"',
  'curl --fail --silent --show-error --max-time 20 "$API_URL/ready"',
  'curl --fail --silent --show-error --max-time 20 "$API_URL/api/v1/system/status"',
  '"distributedRateLimitingConfigured":false',
  '"error":"method_not_allowed"'
]) req(workflow.includes(expected), `API STAGE workflow missing invariant: ${expected}`);

const privateGate = workflow.indexOf('- name: Require private repository');
const credentialsGate = workflow.indexOf('- name: Require isolated deployment credentials');
const deployStep = workflow.indexOf('- name: Deploy isolated API Worker');
req(privateGate >= 0 && privateGate < credentialsGate && credentialsGate < deployStep, 'private repo and dedicated credential gates must precede API deployment.');
req(!workflow.includes('secrets.CLOUDFLARE_API_TOKEN'), 'generic Cloudflare token secret is forbidden.');
req(!workflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'), 'generic Cloudflare account secret is forbidden.');
req(!workflow.includes('secrets.DATABASE_URL'), 'generic DATABASE_URL GitHub secret is forbidden.');
req(!workflow.includes('ifarm-security-api-prod'), 'PROD Worker must not be part of STAGE readiness.');

for (const expected of [
  "app.get('/health'",
  "app.get('/ready'",
  "app.get('/api/v1/system/status'",
  "app.post('/api/v1/ingest/devices/:deviceId/heartbeat'",
  "app.post('/api/v1/ingest/assets/:assetId/position'",
  'scheduled(_controller, env, ctx)',
  'distributedRateLimitingConfigured: false',
  'MAX_INGEST_BODY_BYTES = 32768',
  'app.notFound('
]) req(api.includes(expected), `API runtime readiness primitive missing: ${expected}`);

req(api.includes('humanMonitoringAssumed: false') && api.includes('publicDispatchEnabled: false') && api.includes('governmentIntegration: false') && api.includes('biometricMatching: false'), 'API system safety flags must remain fail-closed.');

console.log('API STAGE readiness check passed: isolated Worker contract, server-only database secret, security perimeter, dry-run, smoke endpoints and fail-closed safety flags preserved.');
