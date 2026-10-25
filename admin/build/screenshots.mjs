#!/usr/bin/env node
// Captures the screenshots the install page uses, from the TEST build loaded into Playwright's Chromium:
// the popup on a page, the options page with a rule and a site, and chrome://extensions with the
// extension loaded. Run: node admin/build/package.mjs --test && node admin/build/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../tests/helpers/pw.mjs';
import { startServer } from '../../tests/helpers/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'tests', '.build', 'extension-test');
const OUT = path.join(ROOT, 'install', 'images');
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ftp-shots-'));
const server = await startServer();
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

// a page to fix
const page = await context.newPage();
await page.goto(server.base + '/site-api.html');
const tabId = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[t.length - 1].id), server.base + '/site-api.html');

// the popup, as it opens
const popup = await context.newPage();
await popup.setViewportSize({ width: 360, height: 560 });
await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
await popup.waitForSelector('#main:not([hidden])');
await popup.fill('#value', 'Ops dashboard');
await popup.screenshot({ path: path.join(OUT, 'popup.png'), fullPage: true });

// the options page with a rule and a site
await sw.evaluate(() => chrome.storage.local.set({ rules: [
  { id: 'r-2026-10-24-001', match: 'http://127.0.0.1/*', fix: 'title', value: 'Ops dashboard', mode: 'set', created: '2026-10-24T20:40:00Z', enabled: true },
  { id: 'r-2026-10-24-002', match: 'http://localhost/*', fix: 'title', value: '[DEV] {title}', mode: 'template', created: '2026-10-24T20:41:00Z', enabled: true }
] }));
await sw.evaluate(() => globalThis.ftp.reconcile());
const opts = await context.newPage();
await opts.setViewportSize({ width: 900, height: 900 });
await opts.goto(`chrome-extension://${extId}/options.html`);
await opts.waitForSelector('.rule');
await opts.waitForSelector('ul.sites li');
await opts.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });

// the playground, mid-experiment
const pgTab = await context.newPage();
await pgTab.goto(server.base + '/static.html');
const pgTabId = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[t.length - 1].id), server.base + '/static.html');
const pg = await context.newPage();
await pg.setViewportSize({ width: 1180, height: 1100 });
await pg.goto(`chrome-extension://${extId}/playground.html?tabId=${pgTabId}`);
await pg.waitForSelector('#page:not([hidden])');
await pg.evaluate(() => window.ftpPlayground.fillForm({ name: 'Hide the heading, rename the title', match: 'http://127.0.0.1/*', script: "const n = await page.dom.count('h1');\nlog('headings:', n);\nawait page.dom.hide('h1');\nawait page.title.set('Fixed by a script');", policy: { capabilities: ['dom.count', 'dom.hide', 'title.set'], limits: { calls: 100, ms: 5000 } } }));
await pg.evaluate(() => window.ftpPlayground.startRun());
await pg.waitForFunction(() => window.ftpPlayground.log().some((l) => /^done in/.test(l)), null, { timeout: 8000 });
await pg.screenshot({ path: path.join(OUT, 'playground.png'), fullPage: true });

await context.close(); await server.close();
fs.rmSync(profile, { recursive: true, force: true });

// chrome://extensions with the real (release) extension loaded, as a reader sees it after Load unpacked
const REAL = path.join(ROOT, 'extension');
const profile2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ftp-shots-'));
const context2 = await chromium.launchPersistentContext(profile2, {
  channel: 'chromium', deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${REAL}`, `--load-extension=${REAL}`]
});
const ext = await context2.newPage();
await ext.setViewportSize({ width: 1000, height: 420 });
try {
  await ext.goto('chrome://extensions/');
  await ext.waitForTimeout(800);
  await ext.screenshot({ path: path.join(OUT, 'chrome-extensions.png') });
} catch (e) { console.warn('screenshots: chrome://extensions could not be captured: ' + e.message); }
await context2.close();
fs.rmSync(profile2, { recursive: true, force: true });
for (const f of fs.readdirSync(OUT)) console.log('screenshots: ' + path.join('install/images', f) + ' (' + fs.statSync(path.join(OUT, f)).size + ' bytes)');
