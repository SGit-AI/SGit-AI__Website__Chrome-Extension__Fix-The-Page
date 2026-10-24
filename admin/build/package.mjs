#!/usr/bin/env node
// Builds the release package from extension/:
//   releases/fix-the-page-vX.Y.Z.zip and releases/fix-the-page-vX.Y.Z.zip.sha256
// where X.Y.Z is admin/build/version.txt without the v. It first stamps extension/build.json and
// extension/build.js with the version, the git commit and the build time (the options page shows them,
// so "which build am I running?" has one answer), then rewrites the release links on every site page to
// the current version.
//
//   node admin/build/package.mjs          the release
//   node admin/build/package.mjs --test   a TEST build in tests/.build/extension-test/, which lists
//                                         http://127.0.0.1/* in host_permissions so Playwright can test
//                                         persistent rules without clicking Chrome's prompt. Never shipped;
//                                         the validator refuses a release zip that carries host_permissions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { writeZip } = require('./zip.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'extension');
const TEST = process.argv.includes('--test');

const VERSION = fs.readFileSync(path.join(ROOT, 'admin/build/version.txt'), 'utf8').trim();
if (!/^v\d+\.\d+\.\d+$/.test(VERSION)) throw new Error('version.txt must carry vX.Y.Z, got ' + VERSION);
const bare = VERSION.slice(1);

let commit = '';
try { commit = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { commit = ''; }
const builtAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
if (manifest.version !== bare) throw new Error(`extension/manifest.json version ${manifest.version} != version.txt ${VERSION}`);

if (TEST) {
  const OUT = path.join(ROOT, 'tests', '.build', 'extension-test');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const rel of walk(EXT)) {
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.copyFileSync(path.join(EXT, rel), path.join(OUT, rel));
  }
  const m = { ...manifest, name: manifest.name + ' (TEST BUILD)', host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'] };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  const build = { version: bare, commit, built_at: builtAt, test: true };
  fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify(build) + '\n');
  fs.writeFileSync(path.join(OUT, 'build.js'), `window.FTP_BUILD = ${JSON.stringify(build)};\n`);
  console.log(`package: TEST build in ${path.relative(ROOT, OUT)} (host_permissions for 127.0.0.1 and localhost; never ship this)`);
  process.exit(0);
}

// 1. stamp
const build = { version: bare, commit, built_at: builtAt, test: false };
fs.writeFileSync(path.join(EXT, 'build.json'), JSON.stringify(build) + '\n');
fs.writeFileSync(path.join(EXT, 'build.js'),
  '// Written by admin/build/package.mjs at release time. Shown in the options page footer, so "which build am\n' +
  '// I running?" has one answer.\n' +
  `window.FTP_BUILD = ${JSON.stringify(build)};\n`);

// 2. zip, deterministic for a given tree (the stamp changes per build, by design)
const entries = walk(EXT).map((rel) => ({ name: rel, data: fs.readFileSync(path.join(EXT, rel)) }));
const zip = writeZip(entries, new Date(builtAt));
const REL = path.join(ROOT, 'releases');
fs.mkdirSync(REL, { recursive: true });
const zipName = `fix-the-page-${VERSION}.zip`;
fs.writeFileSync(path.join(REL, zipName), zip);
const sha = crypto.createHash('sha256').update(zip).digest('hex');
fs.writeFileSync(path.join(REL, zipName + '.sha256'), `${sha}  ${zipName}\n`);

// 3. every site page links to the current release
const RELEASE_LINK = /fix-the-page-v\d+\.\d+\.\d+\.zip/g;
let rewritten = 0;
(function visit(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (['.git', '.github', 'node_modules', 'extension', 'releases', 'tests', '.sg_vault'].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { visit(p); continue; }
    if (!/\.(html|md|txt|xml)$/.test(name)) continue;
    const t = fs.readFileSync(p, 'utf8');
    const u = t.replace(RELEASE_LINK, zipName);
    if (u !== t) { fs.writeFileSync(p, u); rewritten++; }
  }
})(ROOT);

// 4. the published hash, on the source page and its twin
for (const f of ['source/index.html', 'source/index.md']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, 'utf8');
  const u = t.replace(/\b[0-9a-f]{64}\b/g, sha);
  if (u !== t) { fs.writeFileSync(p, u); rewritten++; }
}

console.log(`package: ${path.relative(ROOT, path.join(REL, zipName))} (${zip.length} bytes, ${entries.length} files)`);
console.log(`package: sha256 ${sha}`);
console.log(`package: stamped build.json (commit ${commit.slice(0, 12) || 'none'}, ${builtAt}); ${rewritten} page(s) re-pointed at ${zipName}`);
