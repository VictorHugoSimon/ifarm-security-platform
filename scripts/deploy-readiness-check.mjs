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

requireInvariant(cloudflareContract.includes('NÃO criar deploy enquanto'), 'Cloudflare contract must keep the explicit deployment blocker.');

console.log('Deploy readiness check passed: Vite build, Cloudflare Pages contract, SPA fallback and public-only STAGE env preserved.');
