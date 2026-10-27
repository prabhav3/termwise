#!/usr/bin/env node
// Type-checks every Supabase Edge Function with Deno, using each function's own deno.json.
//   npm run check:functions            # all functions
//   npm run check:functions -- canvas  # just one
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase', 'functions');
const only = process.argv.slice(2);

const fns = readdirSync(fnDir).filter(
  (name) =>
    !name.startsWith('_') &&
    !name.startsWith('.') &&
    statSync(join(fnDir, name)).isDirectory() &&
    existsSync(join(fnDir, name, 'index.ts')) &&
    (only.length === 0 || only.includes(name)),
);

if (fns.length === 0) {
  console.log('No edge functions found.');
  process.exit(0);
}

let failed = 0;
for (const name of fns) {
  const cwd = join(fnDir, name);
  const args = ['deno', 'check'];
  if (existsSync(join(cwd, 'deno.json'))) args.push('--config', 'deno.json');
  args.push('index.ts');
  const res = spawnSync('npx', args, { cwd, stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
  if (res.status === 0) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}\n${(res.stdout || '') + (res.stderr || '')}`);
  }
}

if (failed) {
  console.error(`\n${failed} function(s) failed type-check`);
  process.exit(1);
}
console.log(`\nAll ${fns.length} function(s) type-check`);
