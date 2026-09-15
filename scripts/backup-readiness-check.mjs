import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/neon/backup-policy.json', 'utf8'));
const runbook = readFileSync('docs/operations/sec-187-backup-restore-readiness.md', 'utf8');
const deployWorkflow = readFileSync('.github/workflows/deploy-stage.yml', 'utf8');

const fail = (message) => {
  console.error(`Backup readiness check failed: ${message}`);
  process.exit(1);
};
const req = (condition, message) => { if (!condition) fail(message); };

req(policy.provider === 'neon', 'backup provider must remain explicitly Neon for this project.');
req(policy.current?.subscription === 'free_v3', 'observed subscription changed; re-audit backup capabilities and update policy.');
req(policy.current?.historyRetentionSeconds === 21600, 'observed history retention changed; re-audit and update policy.');
req(policy.current?.automaticSnapshotScheduleAvailable === false, 'snapshot schedule capability changed; update policy and perform restore drill before changing production gate.');
req(policy.current?.manualSnapshotNonRootBranchesSupported === false, 'manual snapshot branch capability changed; re-audit policy.');
req(Array.isArray(policy.current?.devSnapshotSchedule) && policy.current.devSnapshotSchedule.length === 0, 'DEV snapshot schedule observation must remain explicit.');
req(Array.isArray(policy.current?.stageSnapshotSchedule) && policy.current.stageSnapshotSchedule.length === 0, 'STAGE snapshot schedule observation must remain explicit.');
req(Array.isArray(policy.current?.prodSnapshotSchedule) && policy.current.prodSnapshotSchedule.length === 0, 'PROD snapshot schedule observation must remain explicit.');
req(policy.pilotTargets?.contractual === false, 'pilot RPO/RTO must not be represented as contractual SLA.');
req(policy.pilotTargets?.status === 'provisional', 'pilot RPO/RTO must remain provisional until validated.');
req(policy.productionGate?.realUsersAllowed === false, 'real production users must remain blocked while backup/restore prerequisites are unmet.');

for (const requirement of ['backup_schedule_enabled','restore_drill_passed','rpo_rto_approved','auth_provider_hardened','repository_private']) {
  req(policy.productionGate?.requires?.includes(requirement), `production backup gate missing requirement: ${requirement}`);
}

for (const marker of [
  '6 horas de history retention',
  'não existe schedule automático de snapshot habilitado',
  'não apagar ou sobrescrever PROD como primeiro passo de restore',
  'restore drill',
  'RPO 24h',
  'RTO 8h',
  'não contratual'
]) {
  req(runbook.includes(marker), `runbook missing marker: ${marker}`);
}

req(deployWorkflow.includes('pnpm backup:check'), 'STAGE deploy must execute backup readiness gate.');
req(!runbook.includes('backup garantido'), 'runbook must not claim backup is guaranteed.');
req(!runbook.includes('zero perda de dados'), 'runbook must not promise zero data loss.');

console.log('Backup readiness check passed: current Neon limitations are explicit, pilot RPO/RTO are provisional/non-contractual, and real PROD use remains blocked pending backup schedule + restore drill.');
