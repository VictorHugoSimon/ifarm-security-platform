import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';

type RateLimitBinding = { limit: (options: { key: string }) => Promise<{ success: boolean }> };
type Bindings = {
  APP_ENV: string;
  APP_NAME: string;
  DATABASE_URL?: string;
  INGEST_ACTOR_RATE_LIMITER?: RateLimitBinding;
  INGEST_ROUTE_ABUSE_GUARD?: RateLimitBinding;
};
type Variables = { requestId: string };
type HeartbeatStatus = 'online' | 'offline' | 'degraded' | 'maintenance';
type HeartbeatBody = { eventId?: string; status?: HeartbeatStatus; sourceAt?: string; batteryPct?: number; signalRssi?: number; connectionType?: string; metadata?: Record<string, unknown> };
type AssetPositionBody = { deviceId: string; eventId?: string; recordedAt?: string; latitude: number; longitude: number; speedKmh?: number; headingDegrees?: number; accuracyM?: number; metadata?: Record<string, unknown> };
type RateLimitResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; error: 'rate_limited' | 'rate_limiter_not_configured' | 'rate_limiter_unavailable'; retryAfterSeconds?: number };
type ActorRateLimitResult =
  | { ok: true; keyHash: string }
  | { ok: false; status: 429 | 503; error: 'rate_limited' | 'rate_limiter_not_configured' | 'rate_limiter_unavailable'; retryAfterSeconds?: number };

type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: 400 | 413 | 415; error: 'invalid_json' | 'payload_too_large' | 'unsupported_media_type' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_STATUS = new Set<HeartbeatStatus>(['online', 'offline', 'degraded', 'maintenance']);
const MAX_INGEST_BODY_BYTES = 32768;
const RATE_LIMIT_RETRY_SECONDS = 60;
export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function structuredLog(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, event, service: 'ifarm-security-api', timestamp: new Date().toISOString(), ...fields }));
}

function requestIdFromHeader(value?: string) {
  const candidate = value?.trim();
  if (candidate && candidate.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(candidate)) return candidate;
  return crypto.randomUUID();
}

function expectedMethod(pathname: string): 'GET' | 'POST' | null {
  if (pathname === '/health' || pathname === '/ready' || pathname === '/api/v1/system/status') return 'GET';
  if (/^\/api\/v1\/ingest\/devices\/[^/]+\/heartbeat$/.test(pathname)) return 'POST';
  if (/^\/api\/v1\/ingest\/assets\/[^/]+\/position$/.test(pathname)) return 'POST';
  return null;
}

function applySecurityHeaders(c: { header: (name: string, value: string) => void }) {
  c.header('cache-control', 'no-store');
  c.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  c.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  c.header('referrer-policy', 'no-referrer');
  c.header('x-content-type-options', 'nosniff');
  c.header('x-frame-options', 'DENY');
}

async function readJsonBodyWithLimit<T>(c: { req: { header: (name: string) => string | undefined; text: () => Promise<string> } }): Promise<JsonBodyResult<T>> {
  const contentType = c.req.header('content-type') || '';
  const mediaType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (mediaType !== 'application/json') return { ok: false, status: 415, error: 'unsupported_media_type' };

  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_INGEST_BODY_BYTES) {
      return { ok: false, status: 413, error: 'payload_too_large' };
    }
  }

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_INGEST_BODY_BYTES) {
    return { ok: false, status: 413, error: 'payload_too_large' };
  }

  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

app.use('*', async (c, next) => {
  const requestId = requestIdFromHeader(c.req.header('x-request-id'));
  const startedAt = Date.now();
  const pathname = new URL(c.req.url).pathname;
  let explicitStatus: number | undefined;
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  applySecurityHeaders(c);
  try {
    const allowedMethod = expectedMethod(pathname);
    if (allowedMethod && c.req.method !== allowedMethod) {
      explicitStatus = 405;
      c.header('allow', allowedMethod);
      return c.json({ error: 'method_not_allowed', requestId }, 405);
    }
    await next();
  } finally {
    structuredLog('info', 'http_request', { requestId, environment: c.env.APP_ENV, method: c.req.method, path: pathname, status: explicitStatus ?? c.res.status, durationMs: Date.now() - startedAt });
  }
});

app.onError((error, c) => {
  structuredLog('error', 'unhandled_error', { requestId: c.get('requestId'), environment: c.env.APP_ENV, method: c.req.method, path: new URL(c.req.url).pathname, errorName: error.name });
  return c.json({ error: 'internal_error', requestId: c.get('requestId') }, 500);
});

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function deviceKeyFromAuthorization(value?: string) { if (!value?.startsWith('Device ')) return ''; return value.slice('Device '.length).trim(); }
function validMetadata(value: unknown) { if (!value || Array.isArray(value) || typeof value !== 'object') return {}; return value as Record<string, unknown>; }
function distributedRateLimitingConfigured(env: Bindings) { return Boolean(env.INGEST_ACTOR_RATE_LIMITER && env.INGEST_ROUTE_ABUSE_GUARD); }
function requiresDistributedRateLimiting(env: Bindings) { return env.APP_ENV === 'stage' || env.APP_ENV === 'production'; }

async function checkRouteAbuseGuard(env: Bindings, routeKey: string, requestId: string): Promise<RateLimitResult> {
  const limiter = env.INGEST_ROUTE_ABUSE_GUARD;
  if (!limiter) {
    if (requiresDistributedRateLimiting(env)) {
      structuredLog('error', 'ingest_rate_limiter_not_configured', { requestId, environment: env.APP_ENV, scope: 'route', routeKey });
      return { ok: false, status: 503, error: 'rate_limiter_not_configured' };
    }
    return { ok: true };
  }
  try {
    const { success } = await limiter.limit({ key: `route:${routeKey}` });
    if (!success) {
      structuredLog('warn', 'ingest_rate_limited', { requestId, environment: env.APP_ENV, scope: 'route', routeKey });
      return { ok: false, status: 429, error: 'rate_limited', retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
    }
    return { ok: true };
  } catch {
    structuredLog('error', 'ingest_rate_limiter_failed', { requestId, environment: env.APP_ENV, scope: 'route', routeKey });
    return { ok: false, status: 503, error: 'rate_limiter_unavailable' };
  }
}

async function checkActorRateLimit(env: Bindings, routeKey: string, rawKey: string, requestId: string): Promise<ActorRateLimitResult> {
  const keyHash = await sha256Hex(rawKey);
  const limiter = env.INGEST_ACTOR_RATE_LIMITER;
  if (!limiter) {
    if (requiresDistributedRateLimiting(env)) {
      structuredLog('error', 'ingest_rate_limiter_not_configured', { requestId, environment: env.APP_ENV, scope: 'credential', routeKey });
      return { ok: false, status: 503, error: 'rate_limiter_not_configured' };
    }
    return { ok: true, keyHash };
  }
  try {
    const { success } = await limiter.limit({ key: `credential:${routeKey}:${keyHash}` });
    if (!success) {
      structuredLog('warn', 'ingest_rate_limited', { requestId, environment: env.APP_ENV, scope: 'credential', routeKey });
      return { ok: false, status: 429, error: 'rate_limited', retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
    }
    return { ok: true, keyHash };
  } catch {
    structuredLog('error', 'ingest_rate_limiter_failed', { requestId, environment: env.APP_ENV, scope: 'credential', routeKey });
    return { ok: false, status: 503, error: 'rate_limiter_unavailable' };
  }
}

app.get('/health', (c) => c.json({ ok: true, type: 'liveness', service: 'ifarm-security-api', environment: c.env.APP_ENV, timestamp: new Date().toISOString() }));
app.get('/ready', async (c) => {
  const startedAt = Date.now();
  if (!c.env.DATABASE_URL) return c.json({ ready: false, databaseConfigured: false, reason: 'database_not_configured', timestamp: new Date().toISOString() }, 503);
  if (requiresDistributedRateLimiting(c.env) && !distributedRateLimitingConfigured(c.env)) {
    return c.json({ ready: false, databaseConfigured: true, distributedRateLimitingConfigured: false, reason: 'rate_limiter_not_configured', timestamp: new Date().toISOString() }, 503);
  }
  try { const sql = neon(c.env.DATABASE_URL); await sql`select 1 as ready`; return c.json({ ready: true, databaseConfigured: true, distributedRateLimitingConfigured: distributedRateLimitingConfigured(c.env), databaseLatencyMs: Date.now() - startedAt, timestamp: new Date().toISOString() }); }
  catch { structuredLog('error', 'readiness_database_failed', { requestId: c.get('requestId'), environment: c.env.APP_ENV }); return c.json({ ready: false, databaseConfigured: true, distributedRateLimitingConfigured: distributedRateLimitingConfigured(c.env), reason: 'database_unavailable', timestamp: new Date().toISOString() }, 503); }
});
app.get('/api/v1/system/status', (c) => c.json({ product: c.env.APP_NAME, modules: ['identity', 'map', 'devices', 'telemetry', 'events', 'incidents', 'evidence', 'sos', 'asset-security', 'insurance', 'community', 'operations'], databaseConfigured: Boolean(c.env.DATABASE_URL), storageConfigured: false, distributedRateLimitingConfigured: distributedRateLimitingConfigured(c.env), humanMonitoringAssumed: false, publicDispatchEnabled: false, governmentIntegration: false, biometricMatching: false }));

app.post('/api/v1/ingest/devices/:deviceId/heartbeat', async (c) => {
  if (!c.env.DATABASE_URL) return c.json({ error: 'service_not_configured' }, 503);
  const deviceId = c.req.param('deviceId');
  if (!UUID_PATTERN.test(deviceId)) return c.json({ error: 'invalid_device_id' }, 400);
  const routeLimit = await checkRouteAbuseGuard(c.env, 'device-heartbeat', c.get('requestId'));
  if (!routeLimit.ok) { if (routeLimit.retryAfterSeconds) c.header('retry-after', String(routeLimit.retryAfterSeconds)); return c.json({ error: routeLimit.error, requestId: c.get('requestId') }, routeLimit.status); }
  const rawKey = deviceKeyFromAuthorization(c.req.header('authorization'));
  if (rawKey.length < 32 || rawKey.length > 200) return c.json({ error: 'unauthorized' }, 401);
  const actorLimit = await checkActorRateLimit(c.env, 'device-heartbeat', rawKey, c.get('requestId'));
  if (!actorLimit.ok) { if (actorLimit.retryAfterSeconds) c.header('retry-after', String(actorLimit.retryAfterSeconds)); return c.json({ error: actorLimit.error, requestId: c.get('requestId') }, actorLimit.status); }
  const parsedBody = await readJsonBodyWithLimit<HeartbeatBody>(c);
  if (!parsedBody.ok) return c.json({ error: parsedBody.error }, parsedBody.status);
  const body = parsedBody.body;
  const status = body.status;
  if (!status || !VALID_STATUS.has(status)) return c.json({ error: 'invalid_status' }, 400);
  if (body.eventId !== undefined && (!body.eventId || body.eventId.length > 128)) return c.json({ error: 'invalid_event_id' }, 400);
  if (body.batteryPct !== undefined && (!Number.isFinite(body.batteryPct) || body.batteryPct < 0 || body.batteryPct > 100)) return c.json({ error: 'invalid_battery' }, 400);
  if (body.signalRssi !== undefined && (!Number.isInteger(body.signalRssi) || body.signalRssi < -200 || body.signalRssi > 0)) return c.json({ error: 'invalid_signal' }, 400);
  if (body.connectionType !== undefined && body.connectionType.length > 32) return c.json({ error: 'invalid_connection_type' }, 400);
  let sourceAt: string | null = null;
  if (body.sourceAt) { const parsed = new Date(body.sourceAt); if (Number.isNaN(parsed.valueOf()) || parsed.valueOf() > Date.now() + 10 * 60 * 1000) return c.json({ error: 'invalid_source_at' }, 400); sourceAt = parsed.toISOString(); }
  const metadataJson = JSON.stringify(validMetadata(body.metadata));
  if (new TextEncoder().encode(metadataJson).byteLength > 8192) return c.json({ error: 'metadata_too_large' }, 413);
  try {
    const sql = neon(c.env.DATABASE_URL);
    const rows = await sql`select * from public.ingest_device_heartbeat(${deviceId}::uuid,${actorLimit.keyHash}::text,${body.eventId ?? null}::text,${status}::device_status,${sourceAt}::timestamptz,${body.batteryPct ?? null}::numeric,${body.signalRssi ?? null}::integer,${body.connectionType ?? null}::text,${metadataJson}::jsonb)`;
    const row = rows[0] as { accepted: boolean; current_status: string; received_at: string; transition: string } | undefined;
    if (!row) return c.json({ error: 'ingest_failed' }, 500);
    return c.json({ accepted: row.accepted, status: row.current_status, receivedAt: row.received_at, transition: row.transition }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('invalid_device_key')) return c.json({ error: 'unauthorized' }, 401);
    if (message.includes('source_time_in_future') || message.includes('invalid_')) return c.json({ error: 'invalid_heartbeat' }, 400);
    structuredLog('error', 'heartbeat_ingest_failed', { requestId: c.get('requestId'), environment: c.env.APP_ENV }); return c.json({ error: 'internal_error' }, 500);
  }
});

app.post('/api/v1/ingest/assets/:assetId/position', async (c) => {
  if (!c.env.DATABASE_URL) return c.json({ error: 'service_not_configured' }, 503);
  const assetId = c.req.param('assetId');
  if (!UUID_PATTERN.test(assetId)) return c.json({ error: 'invalid_asset_id' }, 400);
  const routeLimit = await checkRouteAbuseGuard(c.env, 'asset-position', c.get('requestId'));
  if (!routeLimit.ok) { if (routeLimit.retryAfterSeconds) c.header('retry-after', String(routeLimit.retryAfterSeconds)); return c.json({ error: routeLimit.error, requestId: c.get('requestId') }, routeLimit.status); }
  const rawKey = deviceKeyFromAuthorization(c.req.header('authorization'));
  if (rawKey.length < 32 || rawKey.length > 200) return c.json({ error: 'unauthorized' }, 401);
  const actorLimit = await checkActorRateLimit(c.env, 'asset-position', rawKey, c.get('requestId'));
  if (!actorLimit.ok) { if (actorLimit.retryAfterSeconds) c.header('retry-after', String(actorLimit.retryAfterSeconds)); return c.json({ error: actorLimit.error, requestId: c.get('requestId') }, actorLimit.status); }
  const parsedBody = await readJsonBodyWithLimit<AssetPositionBody>(c);
  if (!parsedBody.ok) return c.json({ error: parsedBody.error }, parsedBody.status);
  const body = parsedBody.body;
  if (!UUID_PATTERN.test(body.deviceId || '')) return c.json({ error: 'invalid_device_id' }, 400);
  if (!Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90 || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return c.json({ error: 'invalid_coordinates' }, 400);
  if (body.eventId !== undefined && (!body.eventId || body.eventId.length > 128)) return c.json({ error: 'invalid_event_id' }, 400);
  if (body.speedKmh !== undefined && (!Number.isFinite(body.speedKmh) || body.speedKmh < 0 || body.speedKmh > 500)) return c.json({ error: 'invalid_speed' }, 400);
  if (body.headingDegrees !== undefined && (!Number.isFinite(body.headingDegrees) || body.headingDegrees < 0 || body.headingDegrees >= 360)) return c.json({ error: 'invalid_heading' }, 400);
  if (body.accuracyM !== undefined && (!Number.isFinite(body.accuracyM) || body.accuracyM < 0 || body.accuracyM > 100000)) return c.json({ error: 'invalid_accuracy' }, 400);
  const parsed = body.recordedAt ? new Date(body.recordedAt) : new Date();
  if (Number.isNaN(parsed.valueOf()) || parsed.valueOf() > Date.now() + 10 * 60 * 1000) return c.json({ error: 'invalid_recorded_at' }, 400);
  const metadataJson = JSON.stringify(validMetadata(body.metadata));
  if (new TextEncoder().encode(metadataJson).byteLength > 8192) return c.json({ error: 'metadata_too_large' }, 413);
  try {
    const sql = neon(c.env.DATABASE_URL);
    const rows = await sql`select * from public.ingest_asset_position(${assetId}::uuid,${body.deviceId}::uuid,${actorLimit.keyHash}::text,${body.eventId ?? null}::text,${parsed.toISOString()}::timestamptz,${body.latitude}::double precision,${body.longitude}::double precision,${body.speedKmh ?? null}::numeric,${body.headingDegrees ?? null}::numeric,${body.accuracyM ?? null}::numeric,${metadataJson}::jsonb)`;
    const row = rows[0] as { accepted: boolean; inside_geofence: boolean | null; transition: string; received_at: string } | undefined;
    if (!row) return c.json({ error: 'ingest_failed' }, 500);
    return c.json({ accepted: row.accepted, insideGeofence: row.inside_geofence, transition: row.transition, receivedAt: row.received_at }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('invalid_device_key')) return c.json({ error: 'unauthorized' }, 401);
    if (message.includes('asset_device_mismatch')) return c.json({ error: 'device_not_linked_to_asset' }, 403);
    if (message.includes('asset_not_found')) return c.json({ error: 'asset_not_found' }, 404);
    if (message.includes('invalid_')) return c.json({ error: 'invalid_position' }, 400);
    structuredLog('error', 'asset_position_ingest_failed', { requestId: c.get('requestId'), environment: c.env.APP_ENV }); return c.json({ error: 'internal_error' }, 500);
  }
});

app.notFound((c) => c.json({ error: 'not_found', requestId: c.get('requestId') }, 404));

async function reconcileStaleDevices(env: Bindings) {
  if (!env.DATABASE_URL) { structuredLog('warn', 'scheduled_reconcile_skipped', { environment: env.APP_ENV, reason: 'database_not_configured' }); return; }
  try { const sql = neon(env.DATABASE_URL); await sql`select public.reconcile_stale_devices()`; structuredLog('info', 'scheduled_reconcile_complete', { environment: env.APP_ENV }); }
  catch { structuredLog('error', 'scheduled_reconcile_failed', { environment: env.APP_ENV }); throw new Error('scheduled_reconcile_failed'); }
}

const handler: ExportedHandler<Bindings> = { fetch(request, env, ctx) { return app.fetch(request, env, ctx); }, scheduled(_controller, env, ctx) { ctx.waitUntil(reconcileStaleDevices(env)); } };
export default handler;
