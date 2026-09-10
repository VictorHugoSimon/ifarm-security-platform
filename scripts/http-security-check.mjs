import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`HTTP security check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const headers = read('apps/web/public/_headers');
const robots = read('apps/web/public/robots.txt');
const index = read('apps/web/index.html');
const stageEnv = read('apps/web/.env.stage.example');

const env = Object.fromEntries(
  stageEnv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    })
);

for (const key of ['VITE_NEON_AUTH_URL', 'VITE_NEON_DATA_API_URL']) {
  requireInvariant(Boolean(env[key]), `${key} must exist in the STAGE public env contract.`);
}

const allowedConnectOrigins = [
  new URL(env.VITE_NEON_AUTH_URL).origin,
  new URL(env.VITE_NEON_DATA_API_URL).origin
];

const cspLine = headers.split(/\r?\n/).find((line) => line.trim().startsWith('Content-Security-Policy:'))?.trim() ?? '';
requireInvariant(cspLine, 'Content-Security-Policy header is required.');

for (const directive of [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests'
]) {
  requireInvariant(cspLine.includes(directive), `CSP missing directive: ${directive}`);
}

requireInvariant(!cspLine.includes("script-src 'self' 'unsafe-inline'"), 'script-src must not allow unsafe-inline.');
requireInvariant(!cspLine.includes("'unsafe-eval'"), 'CSP must not allow unsafe-eval.');
requireInvariant(!cspLine.includes('*'), 'CSP must not contain wildcard sources.');
requireInvariant(!cspLine.includes('http://'), 'CSP must not allow insecure HTTP origins.');
requireInvariant(!cspLine.includes('tile.openstreetmap.org'), 'STAGE CSP must not allow public map tiles.');
requireInvariant(!cspLine.includes('localhost'), 'STAGE CSP must not allow localhost.');

for (const origin of allowedConnectOrigins) {
  requireInvariant(cspLine.includes(origin), `CSP connect-src must allow STAGE endpoint origin ${origin}.`);
}

for (const requiredHeader of [
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Resource-Policy: same-origin',
  'Referrer-Policy: no-referrer',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'X-Robots-Tag: noindex, nofollow, noarchive',
  'X-Permitted-Cross-Domain-Policies: none',
  'Permissions-Policy: camera=(), microphone=(), geolocation=(self)',
  'Strict-Transport-Security: max-age=31536000'
]) {
  requireInvariant(headers.includes(requiredHeader), `missing security header: ${requiredHeader}`);
}

requireInvariant(!headers.includes('Access-Control-Allow-Origin:'), 'frontend static responses must not add permissive CORS headers.');
requireInvariant(headers.includes('/index.html\n  Cache-Control: no-store, max-age=0'), 'index.html must remain non-cacheable.');
requireInvariant(headers.includes('/assets/*\n  Cache-Control: public, max-age=31536000, immutable'), 'hashed assets must remain immutable-cacheable.');
requireInvariant(robots.trim() === 'User-agent: *\nDisallow: /', 'robots.txt must block indexing of the private portal.');
requireInvariant(index.includes('name="robots" content="noindex,nofollow,noarchive"'), 'index.html must include a noindex fallback meta tag.');

console.log('HTTP security check passed: strict CSP, anti-framing, privacy headers, noindex and cache policy preserved.');
