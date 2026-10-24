#!/usr/bin/env node
// The test runner. Finds every tests/*.test.mjs, builds the TEST extension, runs each file with node's own
// test runner, and fails if any file was not run or ran zero tests (the hub's fifth silent failure: a
// test file nothing imports). Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const only = process.argv.slice(2);

const files = fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort()
  .filter((f) => !only.length || only.some((o) => f.includes(o)));
if (!files.length) { console.error('run: no test files found'); process.exit(1); }

const build = spawnSync(process.execPath, [path.join(ROOT, 'admin/build/package.mjs'), '--test'], { stdio: 'inherit' });
if (build.status !== 0) { console.error('run: could not build the test extension'); process.exit(1); }

let failed = 0;
const ran = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, ['--test', path.join(TESTS, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /^# tests (\d+)/m.exec(out);
  const fails = /^# fail (\d+)/m.exec(out);
  const n = m ? Number(m[1]) : 0;
  const nf = fails ? Number(fails[1]) : 1;
  process.stdout.write(out.split('\n').filter((l) => /^(not ok|ok |# (tests|pass|fail)|    (not ok|ok ))/.test(l) || /Error|assert|expected|actual/.test(l)).join('\n') + '\n');
  if (r.status !== 0 || nf > 0 || n === 0) {
    failed++;
    console.error(`run: ${f} FAILED (exit ${r.status}, ${n} tests, ${nf} failed)`);
    if (r.status !== 0 && !m) process.stdout.write(out);
  } else console.log(`run: ${f} ok (${n} tests)`);
  ran.push({ f, n, nf });
}
const notRun = files.filter((f) => !ran.find((x) => x.f === f));
if (notRun.length) { failed++; console.error('run: not run: ' + notRun.join(', ')); }
console.log(`\nrun: ${ran.length} file(s), ${ran.reduce((a, x) => a + x.n, 0)} tests, ${failed} file(s) failed`);
process.exit(failed ? 1 : 0);
