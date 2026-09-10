const rawUrl = process.env.IFARM_SECURITY_STAGE_URL;

if (!rawUrl) {
  console.error('IFARM_SECURITY_STAGE_URL is required. Example: https://<approved-stage-host>');
  process.exit(2);
}

let base;
try {
  base = new URL(rawUrl);
} catch {
  console.error('IFARM_SECURITY_STAGE_URL must be a valid absolute URL.');
  process.exit(2);
}

if (base.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
  console.error('STAGE smoke requires an approved HTTPS non-localhost origin.');
  process.exit(2);
}

const requiredHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-permitted-cross-domain-policies': 'none'
};

const assertSecurityHeaders = (response, label) => {
  for (const [name, expected] of Object.entries(requiredHeaders)) {
    const value = response.headers.get(name) ?? '';
    if (value !== expected) throw new Error(`${label}: ${name} expected ${expected}, got ${value || 'missing'}`);
  }

  const hsts = response.headers.get('strict-transport-security') ?? '';
  if (!hsts.includes('max-age=31536000')) throw new Error(`${label}: HSTS missing or unexpected`);

  const robots = response.headers.get('x-robots-tag') ?? '';
  for (const token of ['noindex', 'nofollow', 'noarchive']) {
    if (!robots.includes(token)) throw new Error(`${label}: X-Robots-Tag missing ${token}`);
  }

  const permissions = response.headers.get('permissions-policy') ?? '';
  for (const directive of ['camera=()', 'microphone=()', 'geolocation=(self)', 'payment=()', 'usb=()']) {
    if (!permissions.includes(directive)) throw new Error(`${label}: Permissions-Policy missing ${directive}`);
  }

  const csp = response.headers.get('content-security-policy') ?? '';
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    'https://ep-small-darkness-ac0fr7oc.neonauth.sa-east-1.aws.neon.tech',
    'https://ep-small-darkness-ac0fr7oc.apirest.sa-east-1.aws.neon.tech'
  ]) {
    if (!csp.includes(directive)) throw new Error(`${label}: CSP missing ${directive}`);
  }
  if (csp.includes("'unsafe-eval'") || csp.includes('http://') || csp.includes('tile.openstreetmap.org')) {
    throw new Error(`${label}: CSP contains forbidden source`);
  }
};

const assertHtml = async (path, label) => {
  const url = new URL(path, base);
  const response = await fetch(url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  if (!contentType.includes('text/html')) throw new Error(`${label}: expected text/html, got ${contentType || 'unknown'}`);
  if (!body.includes('iFarm Security') && !body.includes('iFARM SECURITY')) throw new Error(`${label}: iFarm Security marker not found`);
  if (!body.includes('noindex,nofollow,noarchive')) throw new Error(`${label}: noindex meta fallback not found`);
  assertSecurityHeaders(response, label);
  return { status: response.status, url: response.url };
};

const assertRobots = async () => {
  const response = await fetch(new URL('/robots.txt', base), { redirect: 'follow' });
  const body = (await response.text()).trim();
  if (!response.ok) throw new Error(`robots: HTTP ${response.status}`);
  if (body !== 'User-agent: *\nDisallow: /') throw new Error('robots: private portal must disallow all crawlers');
  return { status: response.status, url: response.url };
};

try {
  const root = await assertHtml('/', 'root');
  const spa = await assertHtml('/__ifarm_security_spa_smoke__', 'spa-fallback');
  const robots = await assertRobots();
  console.log(JSON.stringify({ ok: true, root, spa, robots, securityHeaders: true }, null, 2));
} catch (error) {
  console.error(`STAGE smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
