import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenFiles = tracked.filter((file) => (file === '.dev.vars' || (/^\.env(?:\.|$)/.test(file) && file !== '.env.example')));
const findings = [];

if (forbiddenFiles.length) findings.push(`Forbidden environment files tracked: ${forbiddenFiles.join(', ')}`);

const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI/API style secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Meta long-lived token candidate', /\bEAA[A-Za-z0-9]{40,}\b/],
  ['credential-bearing PostgreSQL URL', /postgres(?:ql)?:\/\/[^\s"'<>:]+:[^\s"'<>@]+@[^\s"'<>]+/i]
];

for (const file of tracked) {
  if (file === 'pnpm-lock.yaml') continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${label} detected in ${file}`);
  }
}

if (findings.length) {
  console.error('Security check failed.');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Security check passed for ${tracked.length} tracked files.`);
