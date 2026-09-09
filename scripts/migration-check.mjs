import { readdir } from 'node:fs/promises';

const dir = new URL('../packages/db/migrations/', import.meta.url);
const files = (await readdir(dir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  throw new Error('No SQL migrations found.');
}

const parsed = files.map((name) => {
  const match = name.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  if (!match) {
    throw new Error(`Invalid migration filename: ${name}`);
  }
  return { name, number: Number(match[1]) };
});

for (let index = 0; index < parsed.length; index += 1) {
  const expected = index + 1;
  const current = parsed[index];
  if (current.number !== expected) {
    throw new Error(`Migration sequence gap/duplicate: expected ${String(expected).padStart(4, '0')}, found ${current.name}`);
  }
}

const last = parsed.at(-1);
console.log(`Migration inventory OK: ${parsed.length} files, 0001..${String(last.number).padStart(4, '0')}.`);
