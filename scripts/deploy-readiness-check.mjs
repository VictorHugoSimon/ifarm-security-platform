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
const stageEnv = read('apps/web/.env.stage.example');
const cloudflareContract = read('infra/cloudflare/pages-stage.md');
const stageWorkflow = read('.github/workflows/deploy-stage.yml');

requireInvariant(rootPackage.scripts?.['deploy:check'] === 'node scripts/deploy-readiness-check.mjs', 'root deploy:check script must remain registered.');
requireInvariant(webPackage.scripts?.build === 'tsc -b && vite build', 'web build contract changed unexpectedly.');
requireInvariant(viteConfig.includes('defineConfig') && viteConfig.includes('react()'), 'web must remain a Vite React application.');
requireInvariant(redirects === '/* /index.html 200', 'Cloudflare Pages SPA fallback must rewrite unknown paths to index.html with status 200.');

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
  'pnpm stage:smoke',
  "github.repository == 'VictorHugoSimon/ifarm-security-platform'",
  "github.ref == 'refs/heads/main'"
]) {
  requireInvariant(stageWorkflow.includes(expected), `STAGE deploy workflow missing invariant: ${expected}`);
}

requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_API_TOKEN'), 'generic CLOUDFLARE_API_TOKEN secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!stageWorkflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'), 'generic CLOUDFLARE_ACCOUNT_ID secret name is forbidden; use the iFarm Security dedicated secret.');
requireInvariant(!/(?:DATABASE_URL|POSTGRES_URL|NEON_API_KEY|NEON_DATABASE_URL)/.test(stageWorkflow), 'STAGE deploy workflow must not receive privileged database credentials.');

console.log('Deploy readiness check passed: Pages contract, isolated Cloudflare credentials, pinned Wrangler, SPA fallback and smoke gate preserved.');
