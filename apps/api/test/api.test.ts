import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/index.ts';

const baseEnv = { APP_ENV: 'test', APP_NAME: 'iFarm Security' };
const fakeDbEnv = { ...baseEnv, DATABASE_URL: 'postgresql://placeholder.invalid/ifarm_security' };
const validId = '11111111-1111-4111-8111-111111111111';
const validDeviceKey = `Device ${'x'.repeat(32)}`;
const successLimiter = { limit: async (_options: { key: string }) => ({ success: true }) };

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

test('STAGE readiness fails closed when distributed limiter bindings are absent', async () => {
  const response = await app.request('/ready', {}, { ...fakeDbEnv, APP_ENV: 'stage' });
  assert.equal(response.status, 503);
  const body = await json(response);
  assert.equal(body.ready, false);
  assert.equal(body.databaseConfigured, true);
  assert.equal(body.distributedRateLimitingConfigured, false);
  assert.equal(body.reason, 'rate_limiter_not_configured');
});

test('system status reports rate limiting only when both bindings exist', async () => {
  const disabled = await app.request('/api/v1/system/status', {}, baseEnv);
  assert.equal((await json(disabled)).distributedRateLimitingConfigured, false);

  const enabled = await app.request('/api/v1/system/status', {}, {
    ...baseEnv,
    INGEST_ACTOR_RATE_LIMITER: successLimiter,
    INGEST_ROUTE_ABUSE_GUARD: successLimiter
  });
  assert.equal((await json(enabled)).distributedRateLimitingConfigured, true);
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

test('heartbeat rejects invalid device id before database access', async () => {
  const response = await app.request('/api/v1/ingest/devices/not-a-uuid/heartbeat', { method: 'POST' }, fakeDbEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: 'invalid_device_id' });
});

test('route abuse guard returns 429 before credential and database processing', async () => {
  const routeLimiter = { limit: async (_options: { key: string }) => ({ success: false }) };
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST' }, {
    ...fakeDbEnv,
    INGEST_ACTOR_RATE_LIMITER: successLimiter,
    INGEST_ROUTE_ABUSE_GUARD: routeLimiter
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  const body = await json(response);
  assert.equal(body.error, 'rate_limited');
  assert.match(String(body.requestId || ''), /^[0-9a-f-]{36}$/i);
});

test('actor rate limiter uses a SHA-256 derived key and never raw credential material', async () => {
  let actorKey = '';
  const actorLimiter = { limit: async (options: { key: string }) => { actorKey = options.key; return { success: true }; } };
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, {
    method: 'POST',
    headers: { authorization: validDeviceKey, 'content-type': 'text/plain' },
    body: '{}'
  }, {
    ...fakeDbEnv,
    INGEST_ACTOR_RATE_LIMITER: actorLimiter,
    INGEST_ROUTE_ABUSE_GUARD: successLimiter
  });
  assert.equal(response.status, 415);
  assert.match(actorKey, /^credential:device-heartbeat:[0-9a-f]{64}$/);
  assert.ok(!actorKey.includes('x'.repeat(16)));
});

test('actor limiter returns 429 before payload and database processing', async () => {
  const actorLimiter = { limit: async (_options: { key: string }) => ({ success: false }) };
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, {
    method: 'POST', headers: { authorization: validDeviceKey }
  }, {
    ...fakeDbEnv,
    INGEST_ACTOR_RATE_LIMITER: actorLimiter,
    INGEST_ROUTE_ABUSE_GUARD: successLimiter
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal((await json(response)).error, 'rate_limited');
});

test('STAGE ingest fails closed when distributed limiter bindings are absent', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, {
    method: 'POST', headers: { authorization: validDeviceKey }
  }, { ...fakeDbEnv, APP_ENV: 'stage' });
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, 'rate_limiter_not_configured');
});

test('heartbeat rejects oversized declared payload before database access', async () => {
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
