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

const assertHtml = async (path, label) => {
  const url = new URL(path, base);
  const response = await fetch(url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  if (!contentType.includes('text/html')) throw new Error(`${label}: expected text/html, got ${contentType || 'unknown'}`);
  if (!body.includes('iFarm Security') && !body.includes('iFARM SECURITY')) throw new Error(`${label}: iFarm Security marker not found`);
  return { status: response.status, url: response.url };
};

try {
  const root = await assertHtml('/', 'root');
  const spa = await assertHtml('/__ifarm_security_spa_smoke__', 'spa-fallback');
  console.log(JSON.stringify({ ok: true, root, spa }, null, 2));
} catch (error) {
  console.error(`STAGE smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
