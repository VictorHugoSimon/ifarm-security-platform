import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/alerts/alert-delivery-policy.json', 'utf8'));
const runbook = readFileSync('docs/security/sec-189-alert-delivery-readiness.md', 'utf8');
const alertsMigration = readFileSync('packages/db/migrations/0007_events_alerts.sql', 'utf8');
const api = readFileSync('apps/api/src/index.ts', 'utf8');
const stageWorkflow = readFileSync('.github/workflows/deploy-stage.yml', 'utf8');

const fail = (message) => { console.error(`Alert delivery readiness check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(policy.internalAppDelivery?.configured === true && policy.internalAppDelivery?.channel === 'app', 'internal app channel must remain configured.');
req(policy.externalDelivery?.configured === false, 'external alert delivery must remain explicitly unconfigured.');
req(policy.externalDelivery?.workerConfigured === false, 'external delivery worker must remain unconfigured until provider gate passes.');
req(policy.externalDelivery?.providerSelected === false, 'provider must not be marked selected before approval.');
req(policy.externalDelivery?.browserCredentialsAllowed === false, 'provider credentials must never be allowed in browser.');
req(policy.externalDelivery?.providerCredentialsServerSideOnly === true, 'provider credentials must remain server-side only.');
req(policy.externalDelivery?.defaultQueueStatus === 'blocked_external', 'external default queue status must stay blocked_external.');
req(policy.externalDelivery?.automaticDispatchAllowed === false, 'automatic external dispatch must stay disabled.');
req(policy.externalDelivery?.retryEnabled === false, 'retry must not be marked active before worker exists.');
req(policy.externalDelivery?.deduplicationRequired === true, 'deduplication is mandatory.');
req(policy.externalDelivery?.providerMessageIdRequired === true, 'provider message id is mandatory before completion.');
for (const channel of ['push','email','sms','whatsapp']) req(policy.channels?.[channel]?.configured === false, `${channel} must remain unconfigured.`);
req(policy.channels?.whatsapp?.requiresHomologatedProvider === true, 'WhatsApp must require a homologated provider/API.');
req(policy.safety?.humanMonitoringAssumed === false && policy.safety?.publicDispatchEnabled === false, 'human monitoring/public dispatch safety flags must remain false.');
req(policy.productionGate?.externalDeliveryAllowed === false, 'production external delivery gate must remain closed.');
for (const item of ['provider_contract_approved','dedicated_server_side_credentials','delivery_worker_deployed','retry_backoff_tested','dedupe_tested','provider_message_id_persisted','tenant_recipient_isolation_tested','opt_in_and_legal_basis_validated','delivery_failure_observability_tested']) req(policy.productionGate?.requires?.includes(item), `production alert gate missing: ${item}`);

req(alertsMigration.includes("v_status:=CASE WHEN r.channel='app' THEN 'queued' ELSE 'blocked_external' END"), 'external channels must continue to enter blocked_external.');
req(alertsMigration.includes("status IN ('queued','blocked_external','sent','failed','cancelled')"), 'alert status contract changed unexpectedly.');
req(alertsMigration.includes('dedupe_key text') && alertsMigration.includes('attempt_count integer') && alertsMigration.includes('available_at timestamptz'), 'queue readiness columns missing.');
req(api.includes('externalAlertDeliveryConfigured: false'), 'API status must explicitly expose external alert delivery as unconfigured.');
req(api.includes('humanMonitoringAssumed: false') && api.includes('publicDispatchEnabled: false'), 'API safety flags must remain fail-closed.');
req(runbook.includes('externalDeliveryAllowed=false'), 'runbook must keep the external delivery gate explicitly closed.');
req(!/(WHATSAPP|TWILIO|SENDGRID|MAILGUN|SNS|FCM|PUSHER|ONESIGNAL)_(?:TOKEN|SECRET|API_KEY|PASSWORD)/.test(stageWorkflow), 'provider secrets must not be embedded in STAGE web deploy workflow.');

console.log('Alert delivery readiness check passed: app-only internal delivery preserved; push/email/SMS/WhatsApp remain fail-closed until provider, retry, consent and observability gates pass.');
