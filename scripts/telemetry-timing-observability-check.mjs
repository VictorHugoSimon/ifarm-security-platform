import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0032_telemetry_timing_observability.sql', 'utf8');
const ui = readFileSync('apps/web/src/OperationsSOC.tsx', 'utf8');
const fail = (message) => { console.error(`Telemetry timing check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(migration.includes("ADD COLUMN IF NOT EXISTS ingest_ordering text NOT NULL DEFAULT 'legacy_unknown'"), 'legacy telemetry must not be retroactively guessed as current/historical.');
req(migration.includes("CHECK (ingest_ordering IN ('legacy_unknown','current','historical'))"), 'ordering classification constraint is missing.');
req(migration.includes("CASE WHEN v_is_historical THEN 'historical' ELSE 'current' END"), 'future heartbeat classification must be assigned server-side.');
req(migration.includes('get_operations_telemetry_timing_health'), 'authorized operations timing RPC is missing.');
req(migration.includes('public.app_has_operations_access'), 'timing diagnostics must reuse operations scope authorization.');
req(migration.includes('w.received_at-w.source_at > make_interval(secs => GREATEST(w.offline_after_seconds,1))'), 'buffer classification must use each device offline threshold.');
req(migration.includes("w.source_at > w.received_at + interval '60 seconds'"), 'clock-ahead diagnostic is missing.');
req(migration.includes('count(*) FILTER (WHERE w.source_at IS NULL)'), 'missing source-time diagnostic is missing.');
req(migration.includes('LEAST(GREATEST(p_hours,1),168)'), 'timing query window must be bounded to 1–168 hours.');
req(migration.includes('REVOKE ALL ON FUNCTION public.get_operations_telemetry_timing_health(integer) FROM PUBLIC, anonymous'), 'timing RPC must not be public/anonymous.');
req(migration.includes('GRANT EXECUTE ON FUNCTION public.get_operations_telemetry_timing_health(integer) TO authenticated'), 'authorized portal execution grant is missing.');

req(ui.includes("neon.rpc('get_operations_telemetry_timing_health', { p_hours: 24 })"), 'Operations/SOC must consume the bounded timing diagnostic.');
req(ui.includes('Diagnóstico temporal ≠ falha ou adulteração'), 'UI must keep the non-evidentiary timing disclaimer.');
req(ui.includes('não comprovam falha do equipamento, sabotagem, indisponibilidade real ou ocorrência criminal'), 'UI must not turn technical timing signals into crime/failure claims.');
req(!ui.includes('metadata->') && !ui.includes('event_id') && !ui.includes('eventId'), 'Operations timing UI must not expose telemetry metadata or event identifiers.');

console.log('Telemetry timing check passed: server-classified ordering and scoped delay/clock diagnostics remain non-evidentiary and privacy-minimized.');
