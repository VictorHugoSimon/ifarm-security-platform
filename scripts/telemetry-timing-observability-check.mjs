import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0034_telemetry_timing_observability.sql','utf8');
const operations = readFileSync('apps/web/src/OperationsSOC.tsx','utf8');
const fail = (message) => { console.error(`Telemetry timing observability check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes("ADD COLUMN IF NOT EXISTS ingest_ordering text NOT NULL DEFAULT 'legacy_unknown'"), 'ingest_ordering must be idempotently materialized.');
req(migration.includes("CHECK (ingest_ordering IN ('legacy_unknown','current','historical'))"), 'ordering classification must stay constrained.');
req(migration.includes('CREATE OR REPLACE FUNCTION public.classify_device_telemetry_ordering()'), 'server-side timing classification trigger function is required.');
req(migration.includes('BEFORE INSERT ON public.device_telemetry'), 'classification must occur before telemetry insert.');
req(migration.includes("v_effective_source_at <= v_watermark THEN 'historical'"), 'historical classification must compare source time against current watermark.');
req(!migration.includes('CREATE OR REPLACE FUNCTION public.ingest_device_heartbeat_legacy_impl'), 'SEC-202 must not redefine the hardened heartbeat ingest function.');

req(migration.includes("m.role = 'admin_neighborhood'"), 'operations boundary must explicitly handle admin_neighborhood.');
req(migration.includes('AND p_property_id IS NULL'), 'admin_neighborhood must remain community-only.');
req(migration.includes('CREATE OR REPLACE FUNCTION public.get_operations_telemetry_timing_health'), 'sanitized operations timing RPC is required.');
req(migration.includes('app_has_operations_access'), 'timing RPC must use operations authorization boundary.');
req(migration.includes('REVOKE ALL ON FUNCTION public.get_operations_telemetry_timing_health(integer) FROM PUBLIC, anonymous'), 'timing RPC must not be executable anonymously.');

for (const forbidden of ['metadata jsonb','event_id text','evidence_id','recording_id','storage_key','ip_hash']) {
  req(!migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_operations_telemetry_timing_health')).includes(forbidden), `timing RPC must not expose ${forbidden}.`);
}

req(operations.includes("neon.rpc('get_operations_telemetry_timing_health'"), 'Operations UI must load timing diagnostics through the sanitized RPC.');
req(operations.includes('Diagnóstico temporal ≠ falha ou adulteração'), 'Operations UI must keep the non-evidentiary timing disclaimer.');
req(operations.includes('históricos') && operations.includes('em buffer') && operations.includes('relógio adiantado') && operations.includes('sem sourceAt'), 'Operations UI must surface timing categories.');
req(!operations.includes('metadata') && !operations.includes('event_id') && !operations.includes('storage_key'), 'Operations timing UI must not expose raw telemetry/evidence identifiers.');

console.log('Telemetry timing observability check passed: idempotent classification, community/private boundary and sanitized non-evidentiary diagnostics are preserved.');
