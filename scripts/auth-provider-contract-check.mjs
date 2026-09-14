import { readFileSync } from 'node:fs';

const shell=readFileSync('scripts/auth-provider-hardening.sh','utf8');
const workflow=readFileSync('.github/workflows/auth-provider-hardening.yml','utf8');
const docs=readFileSync('docs/security/sec-184-auth-provider-hardening.md','utf8');
const authGate=readFileSync('apps/web/src/AuthGate.tsx','utf8');
const fail=(message)=>{console.error(`Auth provider contract check failed: ${message}`);process.exit(1)};
const req=(condition,message)=>{if(!condition)fail(message)};

for(const required of [
  'PROJECT_ID="restless-cell-49791922"',
  'DEV_BRANCH_ID="br-floral-term-acgf82iv"',
  'STAGE_BRANCH_ID="br-purple-mountain-ac27f6vb"',
  'NEON_CLI_VERSION="2.23.0"',
  '--disable-sign-up',
  '--require-email-verification',
  '--email-verification-method otp',
  '--send-verification-email-on-sign-in',
  'neon-auth domain allow-localhost disable'
]) req(shell.includes(required),`hardening script missing: ${required}`);

req(shell.includes('prod|production|main)'), 'hardening script must explicitly refuse PROD aliases.');
req(shell.includes('PROD is explicitly forbidden in SEC-184'), 'PROD refusal message missing.');
req(!shell.includes('br-wandering-flower-ac7itndi'), 'PROD branch ID must never be present in provider hardening script.');
req(shell.includes('IFARM_SECURITY_NEON_API_KEY'), 'dedicated Neon secret name missing.');
req(!shell.includes('postgres://')&&!shell.includes('postgresql://'),'provider hardening must not contain database credentials.');
req(!shell.includes('neon_auth.project_config'),'direct managed config table editing is forbidden.');

req(workflow.includes('workflow_dispatch:'),'provider hardening must be manual-dispatch only.');
req(workflow.includes("github.repository == 'VictorHugoSimon/ifarm-security-platform'"),'workflow repository guard missing.');
req(workflow.includes('Require private repository'),'private-repo gate missing before privileged credential use.');
req(workflow.includes('secrets.IFARM_SECURITY_NEON_API_KEY'),'dedicated Neon secret wiring missing.');
req(!workflow.includes('secrets.NEON_API_KEY'),'generic/shared Neon secret name is forbidden.');
const privateGate=workflow.indexOf('- name: Require private repository');
const credentialGate=workflow.indexOf('- name: Require isolated Neon credential');
const hardenStep=workflow.indexOf('- name: Harden Managed Better Auth');
req(privateGate>=0&&privateGate<credentialGate&&credentialGate<hardenStep,'repo privacy and dedicated credential gates must precede Neon calls.');
req(workflow.includes("inputs.target == 'stage'"),'STAGE-specific origin validation missing.');
req(workflow.includes('MFA: NOT claimed'),'workflow must not claim unsupported MFA.');

req(authGate.includes('user?.emailVerified !== true'),'application-level verified-email gate must remain enabled.');
req(!authGate.includes('.signUp'),'public sign-up flow must remain absent from AuthGate.');
req(docs.includes('MFA support como Coming soon'),'unsupported MFA status must remain documented.');
req(docs.includes('ainda não foi executada'),'live provider hardening must not be falsely marked complete before execution.');
req(docs.includes('SMTP próprio antes de usuários reais'),'production SMTP requirement must remain documented.');

console.log('Auth provider contract check passed: official Neon CLI path, dedicated credential isolation, PROD refusal, verified-email defense and honest MFA blocker preserved.');
