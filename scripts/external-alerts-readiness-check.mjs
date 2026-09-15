import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('infra/alerts/external-alerts-policy.json', 'utf8'));
const migration = readFileSync('packages/db/migrations/0028_external_alerts_readiness.sql', 'utf8');
const eventsMigration = readFileSync('packages/db/migrations/0007_events_alerts.sql', 'utf8');
const runbook = readFileSync('docs/security/sec-189-external-alerts-readiness.md', 'utf8');
const deployWorkflow = readFileSync('.github/workflows/deploy-stage.yml', 'utf8');

const fail = (message) => { console.error(`External alerts readiness check failed: ${message}`); process.exit(1); };
const req = (condition, message) => { if (!condition) fail(message); };

req(policy.internalChannel?.app === 'available', 'internal app channel must remain available.');
for (const channel of ['push','email','sms','whatsapp']) {
  req(policy.externalChannels?.[channel]?.status === 'blocked_external', `${channel} must remain blocked_external.`);
  req(policy.externalChannels?.[channel]?.provider === null, `${channel} provider must remain unselected in readiness phase.`);
}
req(policy.externalChannels?.whatsapp?.officialOrHomologatedOnly === true, 'WhatsApp must remain official/homologated only.');
req(policy.delivery?.dispatcherImplemented === false, 'external dispatcher must not be declared implemented.');
req(policy.delivery?.serverOnlyCredentials === true, 'external provider credentials must be server-only.');
req(policy.delivery?.providerSecretsInDatabase === false, 'provider secrets are forbidden in DB.');
req(policy.delivery?.providerSecretsInBrowser === false, 'provider secrets are forbidden in browser.');
req(policy.delivery?.humanMonitoringAssumed === false, 'human monitoring must not be assumed.');
req(policy.delivery?.publicDispatchEnabled === false, 'public dispatch must remain disabled.');
req(policy.productionGate?.externalDeliveryAllowed === false, 'external delivery must remain blocked until provider gate is met.');

for (const marker of [
  'alerts_external_delivery_fail_closed',
  "channel IN ('push','email','sms','whatsapp')",
  "status = 'blocked_external'",
  'provider_key IS NULL',
  'provider_message_id IS NULL',
  'CREATE TABLE public.alert_delivery_providers',
  'REVOKE ALL ON TABLE public.alert_delivery_providers FROM PUBLIC, anonymous, authenticated',
  'get_external_alert_provider_status'
]) req(migration.includes(marker), `SEC-189 migration missing invariant: ${marker}`);

req(eventsMigration.includes("v_status:=CASE WHEN r.channel='app' THEN 'queued' ELSE 'blocked_external' END"), 'event trigger must keep all external channels blocked.');
req(runbook.includes('não significa monitoramento humano 24x7'), 'runbook must reject human monitoring assumption.');
req(runbook.includes('não significa despacho automático'), 'runbook must reject automatic public dispatch.');
req(runbook.includes('Não reutilizar WABA'), 'WhatsApp isolation rule missing.');
req(deployWorkflow.includes('pnpm external-alerts:check'), 'STAGE deploy must execute external alerts readiness gate.');

console.log('External alerts readiness check passed: app stays internal, push/email/SMS/WhatsApp remain DB-blocked, no provider secrets are exposed and public/human dispatch assumptions remain false.');
