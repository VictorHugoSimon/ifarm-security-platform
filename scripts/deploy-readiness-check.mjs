import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => { console.error(`Deploy readiness check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

const rootPackage = JSON.parse(read('package.json'));
const webPackage = JSON.parse(read('apps/web/package.json'));
const viteConfig = read('apps/web/vite.config.ts');
const redirects = read('apps/web/public/_redirects').trim();
const headers = read('apps/web/public/_headers');
const robots = read('apps/web/public/robots.txt').trim();
const stageEnv = read('apps/web/.env.stage.example');
const cloudflareContract = read('infra/cloudflare/pages-stage.md');
const stageWorkflow = read('.github/workflows/deploy-stage.yml');
const apiStageWorkflow = read('.github/workflows/deploy-api-stage.yml');

requireInvariant(rootPackage.scripts?.['deploy:check'] === 'node scripts/deploy-readiness-check.mjs', 'root deploy:check script must remain registered.');
requireInvariant(rootPackage.scripts?.['invitations:check'] === 'node scripts/access-invitation-check.mjs', 'invitation security gate must remain registered.');
requireInvariant(rootPackage.scripts?.['memberships:check'] === 'node scripts/membership-lifecycle-check.mjs', 'membership lifecycle security gate must remain registered.');
requireInvariant(rootPackage.scripts?.['access-audit:check'] === 'node scripts/access-audit-check.mjs', 'access audit security gate must remain registered.');
requireInvariant(rootPackage.scripts?.['navigation:check'] === 'node scripts/navigation-check.mjs', 'navigation gate must remain registered.');
requireInvariant(rootPackage.scripts?.['access-navigation:check'] === 'node scripts/access-aware-navigation-check.mjs', 'access-aware navigation gate must remain registered.');
requireInvariant(rootPackage.scripts?.['access-landing:check'] === 'node scripts/access-landing-check.mjs', 'access landing gate must remain registered.');
requireInvariant(rootPackage.scripts?.['support:check'] === 'node scripts/support-maintenance-check.mjs', 'support/maintenance gate must remain registered.');
requireInvariant(rootPackage.scripts?.['privacy:check'] === 'node scripts/privacy-retention-check.mjs', 'privacy/retention gate must remain registered.');
requireInvariant(rootPackage.scripts?.['pilot:check'] === 'node scripts/pilot-readiness-check.mjs', 'pilot readiness gate must remain registered.');
requireInvariant(rootPackage.scripts?.['http-security:check'] === 'node scripts/http-security-check.mjs', 'HTTP security invariant script must remain registered.');
requireInvariant(rootPackage.scripts?.['auth-provider:check'] === 'node scripts/auth-provider-contract-check.mjs', 'auth provider contract gate must remain registered.');
requireInvariant(rootPackage.scripts?.['admin-bootstrap:check'] === 'node scripts/admin-bootstrap-check.mjs', 'controlled admin bootstrap gate must remain registered.');
requireInvariant(rootPackage.scripts?.['admin-lifecycle:check'] === 'node scripts/platform-admin-lifecycle-check.mjs', 'platform admin lifecycle gate must remain registered.');
requireInvariant(rootPackage.scripts?.['backup:check'] === 'node scripts/backup-readiness-check.mjs', 'backup/restore readiness gate must remain registered.');
requireInvariant(rootPackage.scripts?.['evidence-storage:check'] === 'node scripts/evidence-storage-readiness-check.mjs', 'evidence storage readiness gate must remain registered.');
requireInvariant(rootPackage.scripts?.['alert-delivery:check'] === 'node scripts/alert-delivery-readiness-check.mjs', 'alert delivery readiness gate must remain registered.');
requireInvariant(rootPackage.scripts?.['api-stage:check'] === 'node scripts/api-stage-readiness-check.mjs', 'API STAGE readiness gate must remain registered.');
requireInvariant(rootPackage.scripts?.['api-security:check'] === 'node scripts/api-security-perimeter-check.mjs', 'API security perimeter gate must remain registered.');
requireInvariant(rootPackage.scripts?.['rate-limit:check'] === 'node scripts/distributed-rate-limit-check.mjs', 'distributed rate limiting gate must remain registered.');
requireInvariant(rootPackage.scripts?.['device-keys:check'] === 'node scripts/device-key-rotation-check.mjs', 'device key lifecycle gate must remain registered.');
requireInvariant(rootPackage.scripts?.['replay:check'] === 'node scripts/ingest-replay-protection-check.mjs', 'ingest replay protection gate must remain registered.');
requireInvariant(rootPackage.scripts?.['idempotency:check'] === 'node scripts/idempotency-conflict-check.mjs', 'idempotency conflict gate must remain registered.');
requireInvariant(rootPackage.scripts?.['ingest-conflict:check'] === 'node scripts/ingest-conflict-response-check.mjs', 'ingest conflict response gate must remain registered.');
requireInvariant(rootPackage.scripts?.['api-idempotency:check'] === 'node scripts/api-idempotency-contract-check.mjs', 'API idempotency contract gate must remain registered.');
requireInvariant(rootPackage.scripts?.['heartbeat-ordering:check'] === 'node scripts/heartbeat-ordering-safety-check.mjs', 'heartbeat ordering safety gate must remain registered.');
requireInvariant(webPackage.scripts?.build === 'tsc -b && vite build', 'web build contract changed unexpectedly.');
requireInvariant(viteConfig.includes('defineConfig') && viteConfig.includes('react()'), 'web must remain a Vite React application.');
requireInvariant(redirects === '/* /index.html 200', 'Cloudflare Pages SPA fallback must rewrite unknown paths to index.html with status 200.');
requireInvariant(headers.includes('Content-Security-Policy:'), 'Cloudflare Pages _headers must include CSP.');
requireInvariant(headers.includes("frame-ancestors 'none'"), 'CSP must block framing.');
requireInvariant(headers.includes('X-Frame-Options: DENY'), 'legacy anti-framing header must remain enabled.');
requireInvariant(headers.includes('X-Robots-Tag: noindex, nofollow, noarchive'), 'private portal must remain noindex.');
requireInvariant(robots === 'User-agent: *\nDisallow: /', 'private portal robots.txt must block crawlers.');

const stageDataLines = stageEnv.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
requireInvariant(stageDataLines.length === 2, 'STAGE browser environment must still contain only public Auth/Data API URLs.');
requireInvariant(!/(?:DATABASE_URL|POSTGRES_URL|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/i.test(stageDataLines.join('\n')), 'STAGE browser environment contains privileged material.');

for (const expected of ['Project: `ifarm-security-web-stage`','Root directory: repository root','Build command: `pnpm --filter @ifarm-security/web build`','Build output directory: `apps/web/dist`','Production branch: `stage`']) requireInvariant(cloudflareContract.includes(expected), `Cloudflare STAGE contract missing: ${expected}`);
requireInvariant(cloudflareContract.includes('NÃO habilitar uso real enquanto'), 'Cloudflare contract must keep the explicit real-use blocker.');

for (const expected of [
  'IFARM_SECURITY_CF_PROJECT: ifarm-security-web-stage','secrets.IFARM_SECURITY_CLOUDFLARE_API_TOKEN','secrets.IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID','wrangler@4.130.0 pages project create','wranglerVersion: "4.130.0"','--project-name=${{ env.IFARM_SECURITY_CF_PROJECT }} --branch=stage',
  'pnpm privileges:check','pnpm invitations:check','pnpm memberships:check','pnpm access-audit:check','pnpm navigation:check','pnpm access-navigation:check','pnpm access-landing:check','pnpm support:check','pnpm privacy:check','pnpm pilot:check','pnpm http-security:check','pnpm auth:check','pnpm auth-provider:check','pnpm admin-bootstrap:check','pnpm admin-lifecycle:check','pnpm backup:check','pnpm evidence-storage:check','pnpm alert-delivery:check','pnpm rate-limit:check','pnpm device-keys:check','pnpm replay:check','pnpm idempotency:check','pnpm ingest-conflict:check','pnpm api-idempotency:check','pnpm heartbeat-ordering:check',
  'test -f apps/web/dist/_headers','test -f apps/web/dist/robots.txt','cmp apps/web/public/_headers apps/web/dist/_headers','pnpm stage:smoke',
  "github.repository == 'VictorHugoSimon/ifarm-security-platform'","github.ref == 'refs/heads/main'",'${{ github.event.repository.visibility }}','iFarm Security repository must be private before any Cloudflare deployment'
]) requireInvariant(stageWorkflow.includes(expected), `STAGE Pages deploy workflow missing invariant: ${expected}`);

const privateGatePosition = stageWorkflow.indexOf('- name: Require private repository');
const credentialGatePosition = stageWorkflow.indexOf('- name: Require isolated Cloudflare credentials');
const cloudflareCallPosition = stageWorkflow.indexOf('wrangler@4.130.0 pages project list');
requireInvariant(privateGatePosition >= 0 && privateGatePosition < credentialGatePosition && credentialGatePosition < cloudflareCallPosition, 'repository privacy and dedicated credential gates must execute before every Pages Cloudflare call.');
requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_API_TOKEN'), 'generic CLOUDFLARE_API_TOKEN secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'), 'generic CLOUDFLARE_ACCOUNT_ID secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!/(?:DATABASE_URL|POSTGRES_URL|NEON_API_KEY|NEON_DATABASE_URL)/.test(stageWorkflow), 'STAGE Pages workflow must not receive privileged database credentials.');

for (const expected of [
  'IFARM_SECURITY_API_STAGE_WORKER: ifarm-security-api-stage','secrets.IFARM_SECURITY_CLOUDFLARE_API_TOKEN','secrets.IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID','secrets.IFARM_SECURITY_STAGE_DATABASE_URL','pnpm api-stage:check','pnpm api-security:check','pnpm rate-limit:check','pnpm device-keys:check','pnpm replay:check','pnpm idempotency:check','pnpm ingest-conflict:check','pnpm api-idempotency:check','pnpm heartbeat-ordering:check','--config apps/api/wrangler.stage.toml','--secrets-file "$SECRET_FILE"','-D "$HEALTH_HEADERS" "$API_URL/health"','curl --fail --silent --show-error --max-time 20 "$API_URL/ready"','"distributedRateLimitingConfigured":true','"error":"method_not_allowed"'
]) requireInvariant(apiStageWorkflow.includes(expected), `STAGE API deploy workflow missing invariant: ${expected}`);
const apiPrivateGate = apiStageWorkflow.indexOf('- name: Require private repository');
const apiCredentialGate = apiStageWorkflow.indexOf('- name: Require isolated deployment credentials');
const apiDeployStep = apiStageWorkflow.indexOf('- name: Deploy isolated API Worker');
requireInvariant(apiPrivateGate >= 0 && apiPrivateGate < apiCredentialGate && apiCredentialGate < apiDeployStep, 'API repository privacy and dedicated credential gates must execute before Worker deployment.');
requireInvariant(!apiStageWorkflow.includes('secrets.CLOUDFLARE_API_TOKEN'), 'generic Cloudflare token is forbidden in API workflow.');
requireInvariant(!apiStageWorkflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'), 'generic Cloudflare account secret is forbidden in API workflow.');
requireInvariant(!apiStageWorkflow.includes('secrets.DATABASE_URL'), 'generic database secret is forbidden in API workflow.');
requireInvariant(!apiStageWorkflow.includes('ifarm-security-api-prod'), 'PROD API Worker must remain outside STAGE deploy workflow.');

console.log('Deploy readiness check passed: Pages and API STAGE remain isolated behind private-repo, dedicated credentials, distributed rate limiting, replay/idempotency/conflict-response/API-idempotency/heartbeat-ordering protection, security/readiness/device-key gates and smoke checks.');
