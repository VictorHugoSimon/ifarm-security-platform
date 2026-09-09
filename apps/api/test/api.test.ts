import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from '../src/index.ts';

const baseEnv = { APP_ENV: 'test', APP_NAME: 'iFarm Security' };
const fakeDbEnv = { ...baseEnv, DATABASE_URL: 'postgresql://placeholder.invalid/ifarm_security' };
const validId = '11111111-1111-4111-8111-111111111111';
const validDeviceKey = `Device ${'x'.repeat(32)}`;

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
  assert.equal(body.humanMonitoringAssumed, false);
  assert.equal(body.publicDispatchEnabled, false);
  assert.equal(body.governmentIntegration, false);
  assert.equal(body.biometricMatching, false);
  const modules = body.modules as string[];
  assert.ok(modules.includes('insurance'));
  assert.ok(modules.includes('community'));
  assert.ok(modules.includes('operations'));
});

test('heartbeat rejects invalid device id before database access', async () => {
  const response = await app.request('/api/v1/ingest/devices/not-a-uuid/heartbeat', { method: 'POST' }, fakeDbEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: 'invalid_device_id' });
});

test('heartbeat rejects oversized payload before authentication/database access', async () => {
  const response = await app.request(`/api/v1/ingest/devices/${validId}/heartbeat`, { method: 'POST', headers: { 'content-length': '32769' } }, fakeDbEnv);
  assert.equal(response.status, 413);
  assert.deepEqual(await json(response), { error: 'payload_too_large' });
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
