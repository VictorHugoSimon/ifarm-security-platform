import { readFileSync } from 'node:fs';

const migration = readFileSync('packages/db/migrations/0023_privacy_retention.sql','utf8');
const ui = readFileSync('apps/web/src/PrivacyRetentionCenter.tsx','utf8');
const app = readFileSync('apps/web/src/App.tsx','utf8');
const fail = (message) => { console.error(`Privacy retention check failed: ${message}`); process.exit(1); };
const req = (condition,message) => { if (!condition) fail(message); };

for (const table of ['data_retention_policies','privacy_requests','privacy_request_actions']) {
  req(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`), `missing table ${table}`);
  req(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `RLS missing for ${table}`);
  req(migration.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anonymous, authenticated`), `direct browser access must remain revoked for ${table}`);
}

for (const rpc of [
  'set_data_retention_policy','list_data_retention_policies','create_my_privacy_request','list_my_privacy_requests',
  'list_managed_privacy_requests','update_privacy_request_status','cancel_my_privacy_request','get_privacy_request_timeline'
]) {
  req(migration.includes(`FUNCTION public.${rpc}`), `missing privacy RPC ${rpc}`);
}

req(migration.includes('CONSTRAINT retention_no_automatic_deletion CHECK (automated_deletion_enabled = false)'), 'automatic retention deletion must be structurally disabled.');
req(migration.includes('CONSTRAINT privacy_no_automatic_execution CHECK (automated_execution_enabled = false)'), 'privacy requests must never auto-execute.');
req(migration.includes("v_request.request_type='deletion' AND v_status='fulfilled'"), 'deletion requests must not be markable fulfilled in SEC-180.');
req(migration.includes("RAISE EXCEPTION 'privacy_deletion_execution_not_implemented'"), 'deletion execution blocker missing.');
req(migration.includes('legal_review_required boolean NOT NULL DEFAULT true'), 'retention policies must require legal/DPO review.');
req(migration.includes('legal_review_reference_required'), 'approved retention policy must require legal/DPO reference.');
req(migration.includes('do not override Evidence Vault legal holds') || migration.includes('do not override Evidence Vault legal holds'.replace('do not','do not')), 'Evidence legal hold precedence must be documented in migration comment.');
req(!/\bDELETE\s+FROM\s+public\.(?:evidence|recordings|security_events|incidents|device_telemetry|audit_logs|support_tickets|insurance_)/i.test(migration), 'SEC-180 must not delete product data.');
req(!migration.includes('automated_deletion_enabled=true') && !migration.includes('automated_execution_enabled=true'), 'automatic execution must never be enabled.');

req(app.includes("key: 'privacy'"), 'privacy route missing.');
req(app.includes('<PrivacyRetentionCenter />'), 'privacy route component missing.');
for (const rpc of ['create_my_privacy_request','list_my_privacy_requests','list_managed_privacy_requests','set_data_retention_policy','update_privacy_request_status']) {
  req(ui.includes(`'${rpc}'`), `UI must use RPC ${rpc}`);
}
req(!ui.includes(".from('privacy_requests')") && !ui.includes(".from('data_retention_policies')"), 'UI must not query privacy base tables directly.');
req(!ui.includes('.delete('), 'UI must not implement direct deletion.');
req(ui.includes('Nenhum dado será apagado automaticamente') || ui.includes('Nenhuma exclusão ou alteração de dados foi executada automaticamente'), 'UI must clearly disclose no automatic deletion.');
req(ui.includes('não substitui validação jurídica/DPO'), 'UI must state legal/DPO review requirement.');

console.log('Privacy retention check passed: governance-only workflow, no automatic deletion/execution, RLS/RPC boundaries and legal-review gates preserved.');
