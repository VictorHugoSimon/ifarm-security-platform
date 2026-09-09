import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`Auth readiness check failed: ${message}`);
  process.exit(1);
};
const requireInvariant = (condition, message) => {
  if (!condition) fail(message);
};

const authGate = read('apps/web/src/AuthGate.tsx');
const neonClient = read('apps/web/src/lib/neon.ts');
const devEnv = read('apps/web/.env.example');
const stageEnv = read('apps/web/.env.stage.example');

requireInvariant(authGate.includes('neon.auth.signIn.email'), 'frontend must keep email/password sign-in wired through Neon Auth.');
requireInvariant(!/\bsignUp\b|\.signUp\b/.test(authGate), 'public sign-up must not be exposed by the frontend.');
requireInvariant(authGate.includes('O portal não oferece cadastro público.'), 'restricted-access notice must remain visible on the login screen.');

requireInvariant(neonClient.includes('VITE_NEON_AUTH_URL') && neonClient.includes('VITE_NEON_DATA_API_URL'), 'browser client must use public Auth/Data API endpoint variables.');
requireInvariant(!/(?:DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL|PGPASSWORD|PRIVATE_KEY|CLIENT_SECRET)/.test(neonClient), 'privileged database or secret variables must not enter the browser client.');
requireInvariant(!/postgres(?:ql)?:\/\//i.test(neonClient), 'browser client must never contain a PostgreSQL connection string.');

const envFiles = [
  ['DEV', devEnv],
  ['STAGE', stageEnv]
];

for (const [label, text] of envFiles) {
  const dataLines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const dataOnly = dataLines.join('\n');
  requireInvariant(dataLines.length === 2, `${label} browser env example must contain only the two public Neon endpoint variables.`);
  requireInvariant(dataLines.every((line) => line.startsWith('VITE_NEON_AUTH_URL=') || line.startsWith('VITE_NEON_DATA_API_URL=')), `${label} browser env example contains an unexpected variable.`);
  requireInvariant(!/(?:DATABASE_URL|NEON_DATABASE_URL|POSTGRES_URL|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/i.test(dataOnly), `${label} browser env example must not contain secrets or privileged connection material.`);
  requireInvariant(!/postgres(?:ql)?:\/\//i.test(dataOnly), `${label} browser env example must not contain PostgreSQL URLs.`);
}

const stageAuth = stageEnv.match(/VITE_NEON_AUTH_URL=(\S+)/)?.[1] ?? '';
const stageData = stageEnv.match(/VITE_NEON_DATA_API_URL=(\S+)/)?.[1] ?? '';
const devAuth = devEnv.match(/VITE_NEON_AUTH_URL=(\S+)/)?.[1] ?? '';

requireInvariant(/^https:\/\/[^/]+\.neonauth\.[^/]+\/ifarm_security\/auth$/.test(stageAuth), 'STAGE Auth URL must be a public Neon Auth endpoint for ifarm_security.');
requireInvariant(/^https:\/\/[^/]+\.apirest\.[^/]+\/ifarm_security\/rest\/v1$/.test(stageData), 'STAGE Data API URL must be a public Neon Data API endpoint for ifarm_security.');
requireInvariant(stageAuth !== devAuth, 'DEV and STAGE Auth endpoints must remain isolated.');

console.log('Auth readiness check passed: no public signup UI, no privileged browser credentials, DEV/STAGE endpoints isolated.');
