import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`Deploy readiness check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const rootPackage = JSON.parse(read('package.json'));
const webPackage = JSON.parse(read('apps/web/package.json'));
const viteConfig = read('apps/web/vite.config.ts');
const redirects = read('apps/web/public/_redirects').trim();
const headers = read('apps/web/public/_headers');
const robots = read('apps/web/public/robots.txt').trim();
const stageEnv = read('apps/web/.env.stage.example');
const cloudflareContract = read('infra/cloudflare/pages-stage.md');
const stageWorkflow = read('.github/workflows/deploy-stage.yml');

requireInvariant(rootPackage.scripts?.['deploy:check'] === 'node scripts/deploy-readiness-check.mjs', 'root deploy:check script must remain registered.');
requireInvariant(rootPackage.scripts?.['invitations:check'] === 'node scripts/access-invitation-check.mjs', 'invitation security gate must remain registered.');
requireInvariant(rootPackage.scripts?.['memberships:check'] === 'node scripts/membership-lifecycle-check.mjs', 'membership lifecycle security gate must remain registered.');
requireInvariant(rootPackage.scripts?.['http-security:check'] === 'node scripts/http-security-check.mjs', 'HTTP security invariant script must remain registered.');
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

for (const expected of [
  'Project: `ifarm-security-web-stage`',
  'Root directory: repository root',
  'Build command: `pnpm --filter @ifarm-security/web build`',
  'Build output directory: `apps/web/dist`',
  'Production branch: `stage`'
]) {
  requireInvariant(cloudflareContract.includes(expected), `Cloudflare STAGE contract missing: ${expected}`);
}

requireInvariant(cloudflareContract.includes('NÃO habilitar uso real enquanto'), 'Cloudflare contract must keep the explicit real-use blocker.');

for (const expected of [
  'IFARM_SECURITY_CF_PROJECT: ifarm-security-web-stage',
  'secrets.IFARM_SECURITY_CLOUDFLARE_API_TOKEN',
  'secrets.IFARM_SECURITY_CLOUDFLARE_ACCOUNT_ID',
  'wrangler@4.130.0 pages project create',
  'wranglerVersion: "4.130.0"',
  '--project-name=${{ env.IFARM_SECURITY_CF_PROJECT }} --branch=stage',
  'pnpm privileges:check',
  'pnpm invitations:check',
  'pnpm memberships:check',
  'pnpm http-security:check',
  'test -f apps/web/dist/_headers',
  'test -f apps/web/dist/robots.txt',
  'cmp apps/web/public/_headers apps/web/dist/_headers',
  'pnpm stage:smoke',
  "github.repository == 'VictorHugoSimon/ifarm-security-platform'",
  "github.ref == 'refs/heads/main'",
  '${{ github.event.repository.visibility }}',
  'iFarm Security repository must be private before any Cloudflare deployment'
]) {
  requireInvariant(stageWorkflow.includes(expected), `STAGE deploy workflow missing invariant: ${expected}`);
}

const privateGatePosition = stageWorkflow.indexOf('- name: Require private repository');
const credentialGatePosition = stageWorkflow.indexOf('- name: Require isolated Cloudflare credentials');
const cloudflareCallPosition = stageWorkflow.indexOf('wrangler@4.130.0 pages project list');
requireInvariant(privateGatePosition >= 0 && privateGatePosition < credentialGatePosition && credentialGatePosition < cloudflareCallPosition, 'repository privacy and dedicated credential gates must execute before every Cloudflare call.');

requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_API_TOKEN'), 'generic CLOUDFLARE_API_TOKEN secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'), 'generic CLOUDFLARE_ACCOUNT_ID secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!/(?:DATABASE_URL|POSTGRES_URL|NEON_API_KEY|NEON_DATABASE_URL)/.test(stageWorkflow), 'STAGE deploy workflow must not receive privileged database credentials.');

console.log('Deploy readiness check passed: private-repo gate, isolated Cloudflare credentials, access lifecycle gates, HTTP security artifact, pinned Wrangler, Pages contract and smoke gate preserved.');
