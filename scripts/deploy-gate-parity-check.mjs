import { readFileSync } from 'node:fs';

const pages = readFileSync('.github/workflows/deploy-stage.yml','utf8');
const api = readFileSync('.github/workflows/deploy-api-stage.yml','utf8');
const fail = (message) => { console.error(`Deploy gate parity check failed: ${message}`); process.exit(1); };
const requireInvariant = (condition, message) => { if (!condition) fail(message); };

const requiredIngestGates = [
  'pnpm heartbeat-ordering:check',
  'pnpm asset-position-ordering:check',
  'pnpm gps-timestamp-tie:check'
];

for (const gate of requiredIngestGates) {
  requireInvariant(pages.includes(gate), `Pages STAGE workflow missing ${gate}.`);
  requireInvariant(api.includes(gate), `API STAGE workflow missing ${gate}.`);
}

requireInvariant(pages.indexOf('Require private repository') < pages.indexOf('Require isolated Cloudflare credentials'), 'Pages privacy gate must precede credentials.');
requireInvariant(api.indexOf('Require private repository') < api.indexOf('Require isolated deployment credentials'), 'API privacy gate must precede deployment credentials.');

console.log('Deploy gate parity check passed: heartbeat, asset concurrency and GPS tie safety gates are enforced by both STAGE deployment paths.');
