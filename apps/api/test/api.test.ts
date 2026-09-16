import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/index.ts';

const baseEnv = { APP_ENV: 'test', APP_NAME: 'iFarm Security' };
const fakeDbEnv = { ...baseEnv, DATABASE_URL: 'postgresql://placeholder.invalid/ifarm_security' };
const validId = '11111111-1111-4111-8111-111111111111';
const rawDeviceKey = 'x'.repeat(32);
const validDeviceKey = `Device ${rawDeviceKey}`;

async function json(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

test('health is liveness and does not require database', async () => {
  const response = await app.request('/health', {}, baseEnv);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.ok, true);
  assert.equal(body.type, 'liveness');
  assert.equal(body.environment, 'test');
  assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/i);
});

test('all API responses carry defensive headers', async () => {
  const response = await app.request('/health', {}, baseEnv);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
});

test('safe request id is propagated, unsafe request id is replaced', async () => {
  const safe = await app.request('/health', { headers: { 'x-request-id': 'pilot.test-123' } }, baseEnv);
  assert.equal(safe.headers.get('x-request-id'), 'pilot.test-123');
  const unsafe = await app.request('/health', { headers: { 'x-request-id': 'bad id with spaces' } }, baseEnv);
  assert.notEqual(unsafe.headers.get('x-request-id'), 'bad id with spaces');
  assert.match(unsafe.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/i);
});

test('ready fails closed when database is not configured', async () => {
  const response = await app.request('/ready', {}, baseEnv);
  assert.equal(response.status, 503);
  const body = await json(response);
  assert.equal(body.ready, false);
  assert.equal(body.databaseConfigured, false);
  assert.equal(body.reason, 'database_not_configured');
});

test('system status keeps sensitive integrations disabled', async () => {
  const response = await app.request('/api/v1/system/status', {}, baseEnv);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.databaseConfigured, false);
  assert.equal(body.storageConfigured, false);
  assert.equal(body.distributedRateLimitingConfigured, false);
  assert.equal(body.humanMonitoringAssumed, false);
  assert.equal(body.publicDispatchEnabled, false);
  assert.equal(body.governmentIntegration, false);
  assert.equal(body.biometricMatching, false);
  const modules = body.modules as string[];
  assert.ok(modules.includes('insurance'));
  assert.ok(modules.includes('community'));
  assert.ok(modules.includes('operations'));
});

test('system status reports distributed rate limiting when both bindings exist', async () => {
  const allow = { limit: async () => ({ success: true }) };
  const response = await app.request('/api/v1/system/status', {}, {
    ...baseEnv,
    INGEST_DEVICE_RATE_LIMITER: allow,
    INGEST_ROUTE_RATE_LIMITER: allow
  });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.distributedRateLimitingConfigured, true);
});

test('known endpoint rejects wrong method with sanitized 405', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'GET' }, fakeDbEnv);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  const body = await json(response);
  assert.equal(body.error, 'method_not_allowed');
  assert.match(String(body.requestId || ''), /^[0-9a-f-]{36}$/i);
});

test('unknown endpoint returns sanitized 404 with request id', async () => {
  const response = await app.request('/api/v1/unknown-sensitive-route', {}, baseEnv);
  assert.equal(response.status, 404);
  const body = await json(response);
  assert.equal(body.error, 'not_found');
  assert.match(String(body.requestId || ''), /^[0-9a-f-]{36}$/i);
});

test('STAGE ingest fails closed when rate limiting bindings are missing', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, {
    method: 'POST',
    headers: { authorization: validDeviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'online' })
  }, { APP_ENV: 'stage', APP_NAME: 'iFarm Security', DATABASE_URL: 'postgresql://placeholder.invalid/ifarm_security' });
  assert.equal(response.status, 503);
  const body = await json(response);
  assert.equal(body.error, 'rate_limiter_not_configured');
  assert.match(String(body.requestId || ''), /^[0-9a-f-]{36}$/i);
});

test('rate limiting uses a hashed device credential and returns 429', async () => {
  let capturedDeviceKey = '';
  const routeLimiter = { limit: async () => ({ success: true }) };
  const deviceLimiter = {
    limit: async ({ key }: { key: string }) => {
      capturedDeviceKey = key;
      return { success: false };
    }
  };
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, {
    method: 'POST',
    headers: { authorization: validDeviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'online' })
  }, {
    APP_ENV: 'stage',
    APP_NAME: 'iFarm Security',
    DATABASE_URL: 'postgresql://placeholder.invalid/ifarm_security',
    INGEST_DEVICE_RATE_LIMITER: deviceLimiter,
    INGEST_ROUTE_RATE_LIMITER: routeLimiter
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  const body = await json(response);
  assert.equal(body.error, 'rate_limited');
  assert.match(capturedDeviceKey, /^heartbeat:[0-9a-f]{64}$/);
  assert.equal(capturedDeviceKey.includes(rawDeviceKey), false);
});

test('heartbeat rejects invalid device id before database access', async () => {
  const response = await app.request('/api/v1/ingest/devices/not-a-uuid/heartbeat', { method: 'POST' }, fakeDbEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: 'invalid_device_id' });
});

test('heartbeat rejects oversized declared payload before authentication/database access', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST', headers: { authorization: validDeviceKey, 'content-type': 'application/json', 'content-length': '32769' }, body: '{}' }, fakeDbEnv);
  assert.equal(response.status, 413);
  assert.deepEqual(await json(response), { error: 'payload_too_large' });
});

test('heartbeat rejects oversized actual payload even without content-length', async () => {
  const body = JSON.stringify({ status: 'online', metadata: { padding: 'x'.repeat(33000) } });
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST', headers: { authorization: validDeviceKey, 'content-type': 'application/json' }, body }, fakeDbEnv);
  assert.equal(response.status, 413);
  assert.deepEqual(await json(response), { error: 'payload_too_large' });
});

test('heartbeat rejects unsupported media type before JSON parsing/database access', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST', headers: { authorization: validDeviceKey, 'content-type': 'text/plain' }, body: '{"status":"online"}' }, fakeDbEnv);
  assert.equal(response.status, 415);
  assert.deepEqual(await json(response), { error: 'unsupported_media_type' });
});

test('heartbeat rejects missing device credential before database access', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST' }, fakeDbEnv);
  assert.equal(response.status, 401);
  assert.deepEqual(await json(response), { error: 'unauthorized' });
});

test('asset position rejects invalid coordinates before database access', async () => {
  const response = await app.request(`/api/v1/ingest/assets/${validId}/position`, { method: 'POST', headers: { authorization: validDeviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: validId, latitude: 91, longitude: -50 }) }, fakeDbEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: 'invalid_coordinates' });
});
