// A9 and A10: the validator's extension checks, against the shipped tree, the test build, and trees made
// to fail. The whole gate (node admin/build/validate.js) runs in CI and in tests/run.mjs after this.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = require(path.join(ROOT, 'admin/build/validate.js'));
const EXT = path.join(ROOT, 'extension');
const manifest = () => JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftp-val-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('A9: the manifest', () => {
  test('the shipped manifest passes', () => assert.deepEqual(v.checkManifest(manifest()), []));
  test('only activeTab, scripting, storage, contextMenus and sidePanel', () => {
    assert.deepEqual(manifest().permissions.sort(), ['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage']);
    assert.equal(manifest().side_panel.default_path, 'playground.html');
  });
  test('host_permissions is rejected', () => assert.match(v.checkManifest({ ...manifest(), host_permissions: ['https://example.com/*'] }).join('\n'), /host_permissions/));
  test('a test build is rejected as a release', () => {
    const tb = path.join(ROOT, 'tests/.build/extension-test');
    if (!fs.existsSync(tb)) return; // built by tests/run.mjs
    assert.ok(v.checkExtension(tb, { release: true }).some((e) => /host_permissions/.test(e)));
    assert.deepEqual(v.checkExtension(tb, { release: false }).filter((e) => /host_permissions/.test(e)), []);
  });
  for (const p of ['tabs', 'history', 'cookies', 'webRequest', 'debugger', '<all_urls>']) {
    test(`permission ${p} is rejected`, () => assert.match(v.checkManifest({ ...manifest(), permissions: [...manifest().permissions, p] }).join('\n'), new RegExp(p.replace(/[<>]/g, '.'))));
  }
  test('an unknown permission is rejected', () => assert.match(v.checkManifest({ ...manifest(), permissions: [...manifest().permissions, 'bookmarks'] }).join('\n'), /bookmarks/));
  test('a CSP with a remote source is rejected', () => {
    assert.match(v.checkManifest({ ...manifest(), content_security_policy: { extension_pages: "script-src 'self' https://cdn.example.com; object-src 'self'" } }).join('\n'), /remote/);
    assert.match(v.checkManifest({ ...manifest(), content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" } }).join('\n'), /connect-src/);
    assert.match(v.checkManifest({ ...manifest(), content_security_policy: undefined }).join('\n'), /no content_security_policy/);
  });
  test('static content_scripts are rejected', () => assert.match(v.checkManifest({ ...manifest(), content_scripts: [{ matches: ['https://*/*'], js: ['engine.js'] }] }).join('\n'), /content_scripts/));
  test('optional host permissions other than http and https are rejected', () => assert.match(v.checkManifest({ ...manifest(), optional_host_permissions: ['file:///*'] }).join('\n'), /optional_host_permissions/));
});

describe('A10: the code', () => {
  test('the shipped extension passes', () => assert.deepEqual(v.checkExtension(EXT, { release: true }), []));
  const bad = {
    'eval': 'var x = eval("1+1");',
    'new Function': 'var f = new Function("return 1");',
    'fetch': 'fetch("https://example.com/rules.json");',
    'XMLHttpRequest': 'var r = new XMLHttpRequest();',
    'WebSocket': 'var w = new WebSocket("wss://example.com");',
    'importScripts': 'importScripts("https://example.com/x.js");',
    'sendBeacon': 'navigator.sendBeacon("/x", "y");',
    'a string timer': 'setTimeout("alert(1)", 10);',
    'innerHTML': 'el.innerHTML = rule.value;',
    'a remote script URL': 'var s = "https://cdn.example.com/lib.js";',
  };
  for (const [name, code] of Object.entries(bad)) test(`${name} is rejected`, () => {
    const dir = tree({ 'x.js': code });
    assert.ok(v.checkExtensionCode(dir).length >= 1, name);
  });
  const badHtml = {
    'a remote <script>': '<script src="https://cdn.example.com/x.js"></script>',
    'a remote stylesheet': '<link rel="stylesheet" href="https://fonts.example.com/x.css">',
    'an inline script': '<script>alert(1)</script>',
    'an inline handler': '<button onclick="go()">x</button>',
    'a missing local script': '<script src="nope.js"></script>',
  };
  for (const [name, html] of Object.entries(badHtml)) test(`${name} is rejected`, () => {
    const dir = tree({ 'x.html': html });
    assert.ok(v.checkExtensionCode(dir).length >= 1, name);
  });
  test('clean code passes', () => {
    const dir = tree({ 'x.js': 'document.title = "x"; chrome.storage.local.get({ rules: [] });', 'x.html': '<script src="x.js"></script>' });
    assert.deepEqual(v.checkExtensionCode(dir), []);
  });
});
