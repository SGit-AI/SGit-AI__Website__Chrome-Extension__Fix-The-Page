#!/usr/bin/env node
// fix-the-page.chrome-extension.sgit.ai pre-release gate. Run from anywhere: node admin/build/validate.js
//
// Started from the hub's validator (chrome-extensions.sgit.ai, admin/build/validate.js, Apache 2.0), minus
// its target-anonymity blocklist, which belongs to the hub. Checks, in order:
//   1. version agreement: admin/build/version.txt vs assets/version.js, every literal page badge,
//      llms.txt, index.md, the versions table, extension/manifest.json and extension/build.json.
//   2. internal links: every relative href/src in every .html file resolves to a file in the tree.
//   3. canonical host: every <link rel="canonical"> and og:url points at the host in CNAME.
//   4. no script loaded twice on one page.
//   5. key-leak tripwire: nothing in the tree may look like an sgit vault key.
//   6. the extension's manifest (ABP rule 1): no host_permissions, no <all_urls>, only the four
//      permissions, optional host permissions for http and https only, a CSP with no remote source.
//   7. the extension's code (ABP rules 2 and 3): no eval, new Function, remote script, fetch,
//      XMLHttpRequest, WebSocket or importScripts.
//   8. the release: releases/ holds the zip and the .sha256 for this version, the hash matches, the zip's
//      files are byte for byte the files in extension/, and the zip's manifest is not a test build.
//   9. every site page links to the current release zip.
// Any failure exits 1: no tag, no publish.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readZip } = require('./zip.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', '.sg_vault', '.build', '.profiles', '.out']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f);

// ---- 6 and 7: the extension, as functions so the tests can point them at other trees ----------------
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'storage', 'contextMenus', 'sidePanel'];
const BANNED_PERMISSIONS = ['tabs', 'history', 'cookies', 'webRequest', 'webRequestBlocking', 'debugger', 'declarativeNetRequest', 'userScripts', '<all_urls>'];

function checkManifest(manifest, { release = true } = {}) {
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  if (release && manifest.host_permissions !== undefined) errors.push('manifest carries host_permissions: activeTab is the only standing access (ABP rule 1)');
  const perms = manifest.permissions || [];
  for (const p of perms) {
    if (BANNED_PERMISSIONS.includes(p)) errors.push(`manifest permission "${p}" is banned (ABP rule 1)`);
    else if (!ALLOWED_PERMISSIONS.includes(p)) errors.push(`manifest permission "${p}" is not one of ${ALLOWED_PERMISSIONS.join(', ')}`);
  }
  if (!perms.includes('activeTab')) errors.push('manifest must ask for activeTab');
  for (const o of manifest.optional_host_permissions || []) {
    if (!/^https?:\/\/\*\/\*$/.test(o)) errors.push(`optional_host_permissions entry "${o}" is not https://*/* or http://*/*`);
  }
  if (manifest.optional_permissions) for (const p of manifest.optional_permissions) {
    if (BANNED_PERMISSIONS.includes(p)) errors.push(`optional permission "${p}" is banned (ABP rule 1)`);
  }
  if (manifest.content_scripts) errors.push('manifest declares static content_scripts: fixes reach pages through activeTab or registered scripts for granted origins only');
  const csp = manifest.content_security_policy && manifest.content_security_policy.extension_pages;
  if (!csp) errors.push('manifest has no content_security_policy.extension_pages');
  else {
    if (/https?:|\*|unsafe-eval|unsafe-inline|wasm-unsafe-eval/.test(csp.replace(/'self'/g, ''))) errors.push(`CSP allows a remote or unsafe source: ${csp}`);
    if (!/script-src 'self'/.test(csp)) errors.push('CSP must set script-src \'self\'');
    if (!/connect-src 'none'/.test(csp)) errors.push('CSP must set connect-src \'none\' (ABP rule 3)');
  }
  if (manifest.background && manifest.background.scripts) errors.push('MV3 background must be a service worker');
  if (manifest.side_panel && !/^[a-z0-9_-]+\.html$/.test(manifest.side_panel.default_path || '')) errors.push('side_panel.default_path must be a local html file');
  const sandboxPages = (manifest.sandbox && manifest.sandbox.pages) || [];
  if (sandboxPages.length) {
    const scsp = manifest.content_security_policy && manifest.content_security_policy.sandbox;
    if (!scsp) errors.push('a sandbox page needs content_security_policy.sandbox');
    else {
      if (!/connect-src 'none'/.test(scsp)) errors.push("the sandbox CSP must set connect-src 'none' (ABP rule 3)");
      if (/https?:|\*/.test(scsp.replace(/'self'/g, ''))) errors.push(`the sandbox CSP allows a remote source: ${scsp}`);
      if (!/^sandbox allow-scripts;/.test(scsp) || /allow-same-origin|allow-top-navigation|allow-forms|allow-popups/.test(scsp)) errors.push('the sandbox CSP must start with "sandbox allow-scripts;" and allow nothing else');
    }
    for (const p of sandboxPages) if (!/^[a-z0-9_-]+\.html$/.test(p)) errors.push(`sandbox page "${p}" is not a local html file`);
  }
  return errors;
}

const CODE_BANS = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\bFunction\s*\(\s*['"`]/, 'Function("...")'],
  [/\bfetch\s*\(/, 'fetch('],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bimportScripts\s*\(/, 'importScripts('],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsetTimeout\s*\(\s*['"`]/, 'setTimeout with a string'],
  [/\bsetInterval\s*\(\s*['"`]/, 'setInterval with a string'],
  [/\bdocument\.write\s*\(/, 'document.write('],
  [/\binnerHTML\s*=/, 'innerHTML assignment'],
  [/\binsertAdjacentHTML\s*\(/, 'insertAdjacentHTML('],
];
const HTML_BANS = [
  [/<script[^>]+src=["'](https?:)?\/\//i, 'a <script> loaded from the web'],
  [/<link[^>]+href=["'](https?:)?\/\//i, 'a <link> loaded from the web'],
  [/<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i, 'inline script'],
  [/\son[a-z]+\s*=\s*["']/i, 'an inline event handler'],
  [/<iframe\b/i, 'an <iframe>'],
];

// The one exception, by name: the sandbox turns the user's own text into a function. It runs in an opaque
// origin with no network, and every message it sends is checked against the policy on the other side.
const CODE_BAN_EXCEPTIONS = { 'sandbox.js': ['new Function', 'Function("...")'] };

// The code bans are about code, not about words: a list of names a lint refuses may name fetch without
// calling it. So comments and string literals are blanked before the bans run. The remote-URL check below
// runs on the raw text, because a URL is a string by nature.
function stripStringsAndComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
}

function checkExtensionCode(dir) {
  const errors = [];
  let sandboxPages = [];
  try { sandboxPages = (JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).sandbox || {}).pages || []; } catch (e) { /* no manifest */ }
  for (const f of walk(dir)) {
    const r = path.relative(dir, f);
    if (/\.(png|json)$/.test(r)) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (/\.js$/.test(r)) {
      const code = stripStringsAndComments(t);
      for (const [re, what] of CODE_BANS) {
        if ((CODE_BAN_EXCEPTIONS[r] || []).includes(what)) continue;
        if (re.test(code)) errors.push(`${r}: contains ${what} (ABP rules 2 and 3)`);
      }
    }
    if (/\.html$/.test(r)) {
      for (const [re, what] of HTML_BANS) {
        if (what === 'an <iframe>') {
          for (const m of t.matchAll(/<iframe\b[^>]*>/gi)) {
            const src = (/\bsrc="([^"]*)"/.exec(m[0]) || [])[1];
            if (!src || !sandboxPages.includes(src)) errors.push(`${r}: contains an <iframe> that is not a declared sandbox page (${src || 'no src'})`);
            if (!/\bsandbox=/.test(m[0])) errors.push(`${r}: the sandbox <iframe> lacks a sandbox attribute`);
          }
          continue;
        }
        if (re.test(t)) errors.push(`${r}: contains ${what}`);
      }
      for (const m of t.matchAll(/<script[^>]+src="([^"]+)"/g)) if (!fs.existsSync(path.join(dir, m[1]))) errors.push(`${r}: script ${m[1]} is not in the package`);
    }
    if (/\.(js|html|css)$/.test(r) && /\b(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'<>)]*\.(js|css|wasm)\b/i.test(t)) errors.push(`${r}: references a remote script or stylesheet URL`);
  }
  return errors;
}

function checkExtension(dir, opts) {
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) return ['no manifest.json in ' + dir];
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return ['manifest.json is not valid JSON: ' + e.message]; }
  const errors = checkManifest(manifest, opts).map((e) => 'manifest.json: ' + e);
  for (const f of ['engine.js', 'service-worker.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'build.json', 'build.js']) {
    if (!fs.existsSync(path.join(dir, f))) errors.push(`${f} is missing from the extension`);
  }
  return errors.concat(checkExtensionCode(dir));
}

module.exports = { checkManifest, checkExtensionCode, checkExtension, ALLOWED_PERMISSIONS, BANNED_PERMISSIONS };
if (require.main !== module) return;

// ===================================================================================== the gate
const errors = [];
const files = walk(ROOT);
const htmlFiles = files.filter((f) => f.endsWith('.html') && !rel(f).startsWith('extension/') && !rel(f).startsWith('tests/'));

// --- 1. version agreement -------------------------------------------------
const VERSION = fs.readFileSync(path.join(ROOT, 'admin/build/version.txt'), 'utf8').trim();
if (!/^v\d+\.\d+\.\d+$/.test(VERSION)) errors.push(`version.txt does not carry a vX.Y.Z version: "${VERSION}"`);
const BARE = VERSION.replace(/^v/, '');
const VJS = path.join(ROOT, 'assets/version.js');
if (!fs.existsSync(VJS) || !fs.readFileSync(VJS, 'utf8').includes(`"${VERSION}"`)) errors.push(`assets/version.js does not carry ${VERSION}`);
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  if (!/<nav class="site">/.test(t)) continue;
  const badges = [...t.matchAll(/class="ver"[^>]*>(v\d+\.\d+\.\d+)</g)].map((m) => m[1]);
  for (const b of badges) if (b !== VERSION) errors.push(`${rel(f)}: version badge ${b} != ${VERSION}`);
  if (!badges.length && !/assets\/version\.js/.test(t)) errors.push(`${rel(f)}: no version badge and no assets/version.js`);
}
for (const extra of ['llms.txt', 'index.md']) {
  const p = path.join(ROOT, extra);
  if (!fs.existsSync(p)) { errors.push(`${extra} is missing`); continue; }
  if (!fs.readFileSync(p, 'utf8').includes(VERSION)) errors.push(`${extra} does not mention ${VERSION}`);
}
const versPath = path.join(ROOT, 'admin/versions.html');
const versTable = fs.existsSync(versPath) ? fs.readFileSync(versPath, 'utf8') : '';
if (!versTable.includes(`class="vnum">${VERSION}<`)) errors.push(`admin/versions.html has no row for ${VERSION}`);
const rows = [...versTable.matchAll(/class="vnum">(v\d+\.\d+\.\d+)</g)].map((m) => m[1]);
for (const v of rows) if (rows.filter((x) => x === v).length > 1) { errors.push(`admin/versions.html lists ${v} more than once`); break; }
const manifestPath = path.join(ROOT, 'extension/manifest.json');
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { errors.push('extension/manifest.json: ' + e.message); }
if (manifest && manifest.version !== BARE) errors.push(`extension/manifest.json version ${manifest.version} != ${VERSION} (ABP rule 6)`);
try {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/build.json'), 'utf8'));
  if (b.version !== BARE) errors.push(`extension/build.json version ${b.version} != ${VERSION}`);
  if (b.test) errors.push('extension/build.json is marked as a test build');
  const bjs = fs.readFileSync(path.join(ROOT, 'extension/build.js'), 'utf8');
  if (!bjs.includes(JSON.stringify(b))) errors.push('extension/build.js does not carry the same stamp as build.json');
} catch (e) { errors.push('extension/build.json: ' + e.message); }
if (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version !== BARE) errors.push(`package.json version != ${VERSION}`);

// --- 2. internal links ----------------------------------------------------
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const dir = path.dirname(f);
  for (const m of t.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|data:|\/\/|chrome:)/.test(target) || target === '') continue;
    const q = target.indexOf('?');
    const filePart = q === -1 ? target : target.slice(0, q);
    if (filePart && !fs.existsSync(path.resolve(dir, filePart))) errors.push(`${rel(f)}: broken link -> ${target}`);
  }
}
// and in the markdown twins, relative links only
for (const f of files.filter((x) => x.endsWith('.md') && !rel(x).startsWith('admin/debriefs/'))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|\/\/)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(f), target))) errors.push(`${rel(f)}: broken link -> ${target}`);
  }
}

// --- 3. canonical host ----------------------------------------------------
const HOST = fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim();
if (!/^[a-z0-9.-]+$/.test(HOST)) errors.push(`CNAME does not carry a hostname: "${HOST}"`);
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const claimed = [
    ...[...t.matchAll(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ...[...t.matchAll(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const url of claimed) {
    if (!url.startsWith(`https://${HOST}/`)) errors.push(`${rel(f)}: canonical/og:url is not on ${HOST} -> ${url}`);
    else if (url !== `https://${HOST}/${rel(f)}`) errors.push(`${rel(f)}: canonical names a different path -> ${url}`);
  }
  if (!/rel="canonical"/.test(t)) errors.push(`${rel(f)}: no canonical link`);
}
if (manifest && manifest.homepage_url !== `https://${HOST}/`) errors.push(`manifest homepage_url is not https://${HOST}/`);

// --- 4. no script loaded twice ---------------------------------------------
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const seen = new Map();
  for (const m of t.matchAll(/<script[^>]+src="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  for (const [src, n] of seen) if (n > 1) errors.push(`${rel(f)}: loads ${src} ${n} times`);
}

// --- 5. key-leak tripwire ---------------------------------------------------
const KEY_SHAPE = /[A-Za-z0-9_-]{20,}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const SECRET_SHAPES = [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9]{32,}\b/];
for (const f of files) {
  if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|zip)$/.test(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  if (KEY_SHAPE.test(t)) errors.push(`${rel(f)}: contains a vault-key-shaped string`);
  if (f !== __filename) for (const s of SECRET_SHAPES) if (s.test(t)) errors.push(`${rel(f)}: contains a secret-shaped string (ABP rule 5)`);
}
if (fs.existsSync(path.join(ROOT, 'key.pem')) || files.some((f) => /\.(pem|crx)$/.test(f))) errors.push('a .pem or .crx file is in the tree (ABP rule 5)');

// --- 6 and 7. the extension --------------------------------------------------
for (const e of checkExtension(path.join(ROOT, 'extension'), { release: true })) errors.push('extension/' + e);

// --- 8. the release ---------------------------------------------------------
const zipName = `fix-the-page-${VERSION}.zip`;
const zipPath = path.join(ROOT, 'releases', zipName);
const shaPath = zipPath + '.sha256';
if (!fs.existsSync(zipPath)) errors.push(`releases/${zipName} is missing: run node admin/build/package.mjs`);
else if (!fs.existsSync(shaPath)) errors.push(`releases/${zipName}.sha256 is missing`);
else {
  const zip = fs.readFileSync(zipPath);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  const claimed = (fs.readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0] || '').toLowerCase();
  if (claimed !== sha) errors.push(`releases/${zipName}.sha256 says ${claimed.slice(0, 12)}… but the zip hashes to ${sha.slice(0, 12)}…`);
  try {
    const entries = readZip(zip);
    const byName = new Map(entries.map((e) => [e.name, e.data]));
    const src = walk(path.join(ROOT, 'extension')).map((f) => path.relative(path.join(ROOT, 'extension'), f).split(path.sep).join('/'));
    for (const name of src) {
      if (!byName.has(name)) errors.push(`releases/${zipName} lacks extension/${name}: the zip is stale`);
      else if (!byName.get(name).equals(fs.readFileSync(path.join(ROOT, 'extension', name)))) errors.push(`releases/${zipName}: ${name} differs from extension/${name}: the zip is stale`);
    }
    for (const name of byName.keys()) if (!src.includes(name)) errors.push(`releases/${zipName} carries ${name}, which is not in extension/`);
    const zm = byName.get('manifest.json') && JSON.parse(byName.get('manifest.json').toString('utf8'));
    if (!zm) errors.push(`releases/${zipName} has no manifest.json`);
    else {
      if (zm.version !== BARE) errors.push(`releases/${zipName} manifest version ${zm.version} != ${VERSION}`);
      if (zm.host_permissions || /TEST BUILD/.test(zm.name)) errors.push(`releases/${zipName} is a TEST build: never ship it`);
    }
  } catch (e) { errors.push(`releases/${zipName}: ${e.message}`); }
  // the hash on the site, where it is published, is the hash of the file
  const srcPage = path.join(ROOT, 'source/index.html');
  if (fs.existsSync(srcPage) && !fs.readFileSync(srcPage, 'utf8').includes(sha)) errors.push(`source/index.html does not publish the current sha256 ${sha.slice(0, 12)}…`);
}
for (const f of fs.existsSync(path.join(ROOT, 'releases')) ? fs.readdirSync(path.join(ROOT, 'releases')) : []) {
  if (!/^fix-the-page-v\d+\.\d+\.\d+\.zip(\.sha256)?$/.test(f)) errors.push(`releases/${f}: unexpected file`);
}

// --- 9. every page links to the current release ------------------------------
for (const f of htmlFiles) {
  const t = fs.readFileSync(f, 'utf8');
  if (!/<nav class="site">/.test(t)) continue;
  const links = [...t.matchAll(/fix-the-page-(v\d+\.\d+\.\d+)\.zip/g)].map((m) => m[1]);
  if (!links.length) errors.push(`${rel(f)}: does not link to the current release zip`);
  for (const v of links) if (v !== VERSION) errors.push(`${rel(f)}: links to release ${v}, not ${VERSION}`);
}

// --- report ---------------------------------------------------------------
if (errors.length) {
  console.error(`validate: ${errors.length} error(s)`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`validate: OK: ${VERSION} on ${HOST}, ${htmlFiles.length} pages, links resolve, manifest and code within the ABP, release ${zipName} matches extension/ and its hash`);
