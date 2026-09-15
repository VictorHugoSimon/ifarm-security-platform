import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/storage/evidence-storage-policy.json', 'utf8'));
const runbook = readFileSync('docs/security/sec-188-evidence-storage-readiness.md', 'utf8');
const evidenceMigration = readFileSync('packages/db/migrations/0009_evidence_vault.sql', 'utf8');
const api = readFileSync('apps/api/src/index.ts', 'utf8');
const deployWorkflow = readFileSync('.github/workflows/deploy-stage.yml', 'utf8');

const fail = (message) => { console.error(`Evidence storage readiness check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(policy.objectStorage?.configured === false, 'storage must remain explicitly not configured until a real private provider is provisioned.');
req(policy.objectStorage?.neonBranchableStorageAvailableInRegion === false, 'observed Neon regional storage capability changed; re-audit policy.');
req(policy.objectStorage?.candidateProvider === 'cloudflare_r2', 'candidate provider changed; update architecture review first.');
req(policy.objectStorage?.bucketPublic === false, 'evidence bucket must never be public.');
req(policy.objectStorage?.directBrowserCredentialsAllowed === false, 'browser storage credentials are forbidden.');
req(policy.objectStorage?.signedUrlMaxSeconds <= 900, 'signed URL lifetime exceeds approved readiness ceiling.');
req(policy.objectStorage?.deleteEnabled === false, 'physical delete must remain disabled until audited workflow exists.');
req(policy.productionGate?.evidenceUploadAllowed === false && policy.productionGate?.evidenceDownloadAllowed === false, 'real evidence transfer must remain blocked while storage is unconfigured.');
for (const item of ['private_bucket_provisioned','server_only_credentials','signed_url_flow_tested','tenant_key_isolation_tested','retention_legal_hold_enforced','storage_backup_restore_defined']) req(policy.productionGate?.requires?.includes(item), `production storage gate missing: ${item}`);

req(evidenceMigration.includes("evidence_storage_key_opaque"), 'Evidence Vault must keep opaque storage key constraint.');
req(evidenceMigration.includes("evidence_sha256_format"), 'Evidence Vault must keep SHA-256 constraint.');
req(evidenceMigration.includes("legal_hold boolean NOT NULL DEFAULT false"), 'Evidence Vault legal hold flag missing.');
req(api.includes('storageConfigured: false'), 'API must continue reporting storage as not configured.');
req(runbook.includes('Bucket sempre privado'), 'private-bucket rule missing from runbook.');
req(runbook.includes('Legal hold impede deleção física'), 'legal-hold deletion block missing from runbook.');
req(runbook.includes('Cloudflare R2 permanece candidato de arquitetura, não recurso existente'), 'runbook must not claim R2 already exists.');
req(deployWorkflow.includes('pnpm evidence-storage:check'), 'STAGE deploy must execute evidence storage readiness gate.');

console.log('Evidence storage readiness check passed: storage remains fail-closed, private/provider-neutral metadata controls are preserved, and R2 is only a candidate until provisioned and tested.');
