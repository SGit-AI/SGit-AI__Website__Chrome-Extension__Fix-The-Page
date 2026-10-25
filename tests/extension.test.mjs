// Extension-in-Chromium tests: the TEST build (tests/.build/extension-test, from package.mjs --test) is
// loaded unpacked into a persistent context. Its manifest lists http://127.0.0.1/* in host_permissions,
// which stands in for the per-site grant automation cannot click. Covers A11, A12, the popup, the options
// page, export and import, and the restricted-page message.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './helpers/pw.mjs';
import { startServer } from './helpers/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'tests', '.build', 'extension-test');
const ORIGIN = 'http://127.0.0.1/*';

let context, sw, server, extId, profile;
before(async () => {
  assert.ok(fs.existsSync(path.join(EXT, 'manifest.json')), 'run `node admin/build/package.mjs --test` first (tests/run.mjs does)');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ftp-profile-'));
  server = await startServer();
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
});
after(async () => {
  await context?.close();
  await server?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});

const rule = (over = {}) => ({ id: 'r-persist', match: ORIGIN, fix: 'title', value: 'Mine', mode: 'set', created: '2026-10-24T20:40:00Z', enabled: true, ...over });
const setRules = (rules) => sw.evaluate((rules) => chrome.storage.local.set({ rules }), rules);
const getRules = () => sw.evaluate(() => chrome.storage.local.get({ rules: [] }).then((d) => d.rules));
const registered = () => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id)));
// the newest tab with this URL (a test that failed may have left an older one open)
const tabIdFor = (url) => sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t.length && t[t.length - 1].id), url);

describe('extension in Chromium', () => {
  test('the worker is up, the test build is marked, and nothing is registered yet', async () => {
    const m = await sw.evaluate(() => chrome.runtime.getManifest());
    assert.match(m.name, /TEST BUILD/);
    assert.deepEqual(m.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);
    assert.equal((await sw.evaluate(() => chrome.permissions.getAll())).origins.includes(ORIGIN), true);
  });

  test('a page is untouched before any rule exists', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    assert.equal(await page.title(), 'Original');
    await page.close();
  });

  test('A11: a persistent rule applies at load with no click', async () => {
    await setRules([rule()]);
    const r = await sw.evaluate(() => globalThis.ftp.registerOrigin('http://127.0.0.1/*'));
    assert.equal(r.ok, true);
    assert.ok((await registered()).includes('ftp:' + ORIGIN));
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    await page.waitForFunction(() => document.title === 'Mine', null, { timeout: 3000 });
    // the engine lives in the extension's isolated world, out of the page's (and page.evaluate's) reach
    assert.equal(await page.evaluate(() => typeof window.__fixThePage), 'undefined');
    const id = await tabIdFor(server.base + '/static.html');
    const s = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'ftp:status' }), id);
    assert.equal(s.pageTitle, 'Original');
    assert.deepEqual(s.matched, ['r-persist']);
    await page.close();
  });

  test('A11b: the persistent rule holds on a page that rewrites its title, and on reload', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/rewriter.html');
    await page.waitForTimeout(1500);
    assert.equal(await page.title(), 'Mine');
    await page.reload();
    await page.waitForTimeout(800);
    assert.equal(await page.title(), 'Mine');
    await page.close();
  });

  test('disabling the rule in storage gives the open page its title back', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    await page.waitForFunction(() => document.title === 'Mine', null, { timeout: 3000 });
    await setRules([rule({ enabled: false })]);
    await page.waitForFunction(() => document.title === 'Original', null, { timeout: 3000 });
    await setRules([rule()]);
    await page.waitForFunction(() => document.title === 'Mine', null, { timeout: 3000 });
    await page.close();
  });

  test('the popup: restricted page message on a chrome:// tab', async () => {
    const chromePage = await context.newPage();
    await chromePage.goto('chrome://version/');
    const id = await tabIdFor('chrome://version/');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#restricted:not([hidden])');
    assert.match(await popup.locator('#restricted').innerText(), /Chrome does not allow extensions on this page/);
    assert.equal(await popup.locator('#main').isHidden(), true);
    await popup.close(); await chromePage.close();
  });

  test('the popup: shows the page, applies a title once, undoes it', async () => {
    await setRules([]);
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const id = await tabIdFor(server.base + '/static.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#main:not([hidden])');
    assert.equal(await popup.locator('#page-title').innerText(), 'Original');
    assert.equal(await popup.inputValue('#value'), 'Original');
    assert.equal(await popup.inputValue('#match'), server.base + '/*');
    await popup.fill('#value', 'From the popup');
    assert.equal(await popup.locator('#preview').innerText(), 'From the popup');
    await popup.selectOption('#mode', 'suffix');
    assert.equal(await popup.locator('#preview').innerText(), 'OriginalFrom the popup');
    await popup.selectOption('#mode', 'set');
    await popup.click('#apply');
    await popup.waitForFunction(() => document.getElementById('message').textContent.includes('Applied'));
    assert.equal(await page.title(), 'From the popup');
    assert.deepEqual(await getRules(), []);
    await popup.click('#undo');
    await popup.waitForFunction(() => document.getElementById('message').textContent.includes('Undone'));
    assert.equal(await page.title(), 'Original');
    await popup.close(); await page.close();
  });

  test('the popup: a pattern that does not match the page is refused', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const id = await tabIdFor(server.base + '/static.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#main:not([hidden])');
    await popup.fill('#match', 'https://elsewhere.example/*');
    // the field is marked invalid (the browser blocks the submit and shows why)
    assert.equal(await popup.evaluate(() => document.getElementById('match').checkValidity()), false);
    assert.match(await popup.evaluate(() => document.getElementById('match').validationMessage), /does not match/);
    await popup.click('#apply');
    await popup.waitForTimeout(300);
    assert.equal(await page.title(), 'Original');
    await popup.fill('#match', 'nonsense');
    assert.match(await popup.evaluate(() => document.getElementById('match').validationMessage), /match pattern/);
    // the form's own check is the second line of defence
    const refused = await popup.evaluate(() => { const f = document.getElementById('form'); f.noValidate = true; f.requestSubmit(); return new Promise((r) => setTimeout(() => r(document.getElementById('message').textContent), 200)); });
    assert.match(refused, /match/);
    assert.equal(await page.title(), 'Original');
    await popup.close(); await page.close();
  });

  test('the popup: "always on this site" stores the rule, registers the origin, and survives reload', async () => {
    await setRules([]);
    await sw.evaluate(() => globalThis.ftp.removeSite('http://127.0.0.1/*'));
    assert.ok(!(await registered()).includes('ftp:' + ORIGIN)); // localhost, the test build's other required origin, may stay
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const id = await tabIdFor(server.base + '/static.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#main:not([hidden])');
    await popup.fill('#value', '[always] ');
    await popup.selectOption('#mode', 'prefix');
    await popup.check('#always');
    await popup.click('#apply');
    await popup.waitForFunction(() => document.getElementById('message').textContent.includes('Saved'));
    const rules = await getRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].match, server.base + '/*');
    assert.equal(rules[0].mode, 'prefix');
    assert.ok((await registered()).includes('ftp:' + ORIGIN));
    await page.waitForFunction(() => document.title === '[always] Original', null, { timeout: 3000 });
    await page.reload();
    await page.waitForFunction(() => document.title === '[always] Original', null, { timeout: 3000 });
    await popup.close(); await page.close();
  });

  test('the options page: lists the rule and the site, edits, exports, imports, toggles', async () => {
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/options.html`);
    await opts.waitForSelector('.rule');
    assert.equal(await opts.locator('.rule').count(), 1);
    assert.match(await opts.locator('.rule-value').innerText(), /\[always\]/);
    assert.match(await opts.locator('#rules h3').innerText(), /127\.0\.0\.1/);
    await opts.waitForSelector('ul.sites li');
    assert.ok((await opts.locator('ul.sites li code').allInnerTexts()).includes(ORIGIN));
    assert.match(await opts.locator('#b-version').innerText(), /v0\.\d+\.\d+ TEST BUILD/);
    assert.match(await opts.locator('#b-commit').innerText(), /^[0-9a-f]{12}$|not stamped/);

    // edit
    await opts.click('.rule-edit');
    await opts.fill('.rule-form input[name=value]', '[edited] ');
    await opts.click('.rule-form button[type=submit]');
    await opts.waitForFunction(() => document.querySelector('.rule-value')?.textContent.includes('[edited]'));
    assert.equal((await getRules())[0].value, '[edited] ');

    // bad edit is refused
    await opts.click('.rule-edit');
    await opts.fill('.rule-form input[name=match]', 'not a pattern');
    await opts.click('.rule-form button[type=submit]');
    assert.match(await opts.locator('.form-error').innerText(), /match pattern/);
    await opts.click('.rule-cancel');

    // export (A8, first half)
    const [download] = await Promise.all([opts.waitForEvent('download'), opts.click('#export')]);
    const exported = fs.readFileSync(await download.path(), 'utf8');
    const file = JSON.parse(exported);
    assert.equal(file.format, 'fix-the-page/rules');
    assert.equal(file.rules.length, 1);

    // toggle off, then delete, then import the export back (A8, second half)
    await opts.uncheck('.rule-enabled');
    await opts.waitForFunction(() => document.querySelector('.rule')?.classList.contains('disabled'));
    assert.equal((await getRules())[0].enabled, false);
    opts.on('dialog', (d) => d.accept());
    await opts.click('.rule-delete');
    await opts.waitForSelector('#rules-empty:not([hidden])');
    assert.deepEqual(await getRules(), []);
    const tmp = path.join(profile, 'rules.json');
    fs.writeFileSync(tmp, exported);
    await opts.setInputFiles('#import-file', tmp);
    await opts.waitForFunction(() => document.getElementById('rules-message').textContent.includes('Imported'));
    assert.deepEqual(await getRules(), file.rules);

    // A7: a bad import is refused and stores nothing
    fs.writeFileSync(tmp, JSON.stringify({ format: 'fix-the-page/rules', version: 1, rules: [{ ...file.rules[0], fix: 'hide', code: 'alert(1)' }] }));
    await opts.setInputFiles('#import-file', tmp);
    await opts.waitForFunction(() => document.getElementById('rules-message').textContent.includes('Not imported'));
    assert.deepEqual(await getRules(), file.rules);
    await opts.close();
  });

  test('A12: remove access, reload, the title is the page\'s own', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    await page.waitForFunction(() => document.title === '[edited] Original', null, { timeout: 3000 });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/options.html`);
    await opts.waitForSelector('ul.sites li button');
    opts.on('dialog', (d) => d.dismiss()); // keep the rules, drop the access
    await opts.locator('ul.sites li', { hasText: '127.0.0.1' }).locator('button').click();
    await opts.waitForFunction(() => document.getElementById('sites-message').textContent.includes('Access removed'));
    assert.ok(!(await registered()).includes('ftp:' + ORIGIN));
    assert.equal((await getRules()).length, 1);
    await page.reload();
    await page.waitForTimeout(800);
    assert.equal(await page.title(), 'Original');
    await opts.close(); await page.close();
  });

  test('reconcile registers nothing for an origin without a grant and keeps granted ones', async () => {
    const r = await sw.evaluate(() => globalThis.ftp.reconcile());
    // the test build's required host permissions count as granted, so reconcile re-registers them
    assert.ok(r.origins.includes(ORIGIN));
    assert.ok((await registered()).includes('ftp:' + ORIGIN));
    await sw.evaluate(() => globalThis.ftp.removeSite('http://127.0.0.1/*'));
  });
});

describe('the playground', () => {
  const playgroundFor = async (page) => {
    const id = await tabIdFor(page.url());
    const pg = await context.newPage();
    await pg.goto(`chrome-extension://${extId}/playground.html?tabId=${id}`);
    await pg.waitForSelector('#page:not([hidden])');
    await pg.waitForFunction(() => document.getElementById('run') && !document.getElementById('run').disabled || document.getElementById('lint').textContent.length > 0);
    return pg;
  };
  const setForm = (pg, x) => pg.evaluate((x) => window.ftpPlayground.fillForm(x), x);
  const runAndWait = async (pg) => {
    await pg.evaluate(() => window.ftpPlayground.startRun());
    await pg.waitForFunction(() => window.ftpPlayground.log().some((l) => /^(done in|ended with an error)/.test(l)), null, { timeout: 8000 });
    return pg.evaluate(() => window.ftpPlayground.log());
  };

  test('opened on its own, it says so and still offers the editor', async () => {
    const pg = await context.newPage();
    await pg.goto(`chrome-extension://${extId}/playground.html`);
    await pg.waitForSelector('#restricted:not([hidden])');
    assert.equal(await pg.locator('#run').isDisabled(), true);
    assert.ok((await pg.locator('#caps input.cap').count()) >= 8);
    await pg.close();
  });

  test('panel mode: opened without a tab, it follows the active tab it is allowed to see', async () => {
    await setRules([]); // an earlier test leaves a stored prefix rule, which an injected engine would apply
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const pg = await context.newPage();
    await pg.goto(`chrome-extension://${extId}/playground.html`);
    await pg.waitForSelector('#restricted:not([hidden])'); // the active tab is the playground itself
    assert.equal(await pg.evaluate(() => document.body.classList.contains('panel')), true);
    // the user switches to the page: the panel re-binds (the test build may see every 127.0.0.1 tab)
    await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => chrome.tabs.update(t[t.length - 1].id, { active: true })), server.base + '/static.html');
    await pg.waitForFunction(() => window.ftpPlayground.tab() && window.ftpPlayground.tab().url.endsWith('/static.html'), null, { timeout: 5000 });
    assert.equal(await pg.locator('#page').isVisible(), true);
    assert.equal(await pg.inputValue('#match'), server.base + '/*');
    assert.equal(await pg.locator('#open-in-tab').isVisible(), true);
    await setForm(pg, { name: 'Panel', match: server.base + '/*', script: "await page.title.set('From the panel');", policy: { capabilities: ['title.set'], limits: { calls: 100, ms: 5000 } } });
    const log = await runAndWait(pg);
    assert.ok(log.some((l) => /^done in/.test(l)), log.join('\n'));
    assert.equal(await page.title(), 'From the panel');
    // switching to a tab the extension may not see: the panel says so, and undo still reaches the old tab
    const chromePage = await context.newPage();
    await chromePage.goto('chrome://version/');
    await pg.waitForFunction(() => !window.ftpPlayground.tab(), null, { timeout: 5000 });
    assert.match(await pg.locator('#restricted').innerText(), /does not allow extensions|Click the Fix the Page icon/);
    await pg.click('#undo');
    await pg.waitForFunction(() => document.getElementById('message').textContent.includes('Undid'));
    assert.equal(await page.title(), 'Original');
    await chromePage.close(); await pg.close(); await page.close();
  });

  test('the popup offers the side panel and a tab', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const id = await tabIdFor(server.base + '/static.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#main:not([hidden])');
    assert.equal(await popup.locator('#open-panel').isVisible(), true);
    assert.equal(await popup.locator('#playground-link').isVisible(), true);
    assert.match(await popup.locator('#version-pill').innerText(), /^v0\.\d+\.\d+$/);
    await popup.close(); await page.close();
  });

  test('a script under a matching policy runs, changes the tab, and undo reverses it', async () => {
    await setRules([]);
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const pg = await playgroundFor(page);
    await setForm(pg, { name: 'Lab', match: server.base + '/*', script: "await page.title.set('From the lab');\nconst n = await page.dom.hide('h1');\nlog('hid', n);", policy: { capabilities: ['title.set', 'dom.hide'], limits: { calls: 100, ms: 5000 } } });
    assert.match(await pg.locator('#lint').innerText(), /grants exactly that/);
    const log = await runAndWait(pg);
    assert.ok(log.some((l) => /^done in/.test(l)), log.join('\n'));
    assert.ok(log.some((l) => l === 'log: hid 1'), log.join('\n'));
    assert.equal(await page.title(), 'From the lab');
    assert.equal(await page.locator('h1').isHidden(), true);
    await pg.click('#undo');
    await pg.waitForFunction(() => document.getElementById('message').textContent.includes('Undid'));
    assert.equal(await page.title(), 'Original');
    assert.equal(await page.locator('h1').isVisible(), true);
    await pg.close(); await page.close();
  });

  test('a call outside the policy is refused by the static review, and by the gate if it gets past it', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const pg = await playgroundFor(page);
    await setForm(pg, { name: 'Over-reach', match: server.base + '/*', script: "await page.css.add('body { display: none !important }');", policy: { capabilities: ['title.set'], limits: { calls: 100, ms: 5000 } } });
    assert.match(await pg.locator('#lint').innerText(), /does not grant it/);
    assert.equal(await pg.locator('#run').isDisabled(), true);
    await pg.evaluate(() => window.ftpPlayground.startRun());
    assert.match(await pg.locator('#message').innerText(), /Not run/);
    assert.equal(await page.locator('h1').isVisible(), true);
    // a forged message from anywhere but the sandbox is ignored
    await pg.evaluate(() => window.postMessage({ type: 'sbp:cap', runId: 'r1', id: 'c1', name: 'css.add', args: ['body { display: none !important }'] }, '*'));
    await pg.waitForTimeout(300);
    assert.equal(await page.locator('h1').isVisible(), true);
    await pg.close(); await page.close();
  });

  test('a banned word blocks the run, and the lint names the line', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const pg = await playgroundFor(page);
    await setForm(pg, { name: 'Sneaky', match: server.base + '/*', script: "const d = document;\nawait page.title.set('x');", policy: { capabilities: ['title.set'], limits: { calls: 100, ms: 5000 } } });
    assert.match(await pg.locator('#lint').innerText(), /line 1: "document"/);
    assert.equal(await pg.locator('#run').isDisabled(), true);
    await pg.close(); await page.close();
  });

  test('save, list, export, import and delete experiments', async () => {
    const page = await context.newPage();
    await page.goto(server.base + '/static.html');
    const pg = await playgroundFor(page);
    await setForm(pg, { name: 'Keep me', match: server.base + '/*', script: "await page.title.set('Kept');", policy: { capabilities: ['title.set'], limits: { calls: 100, ms: 5000 } } });
    await pg.click('#save');
    await pg.waitForFunction(() => document.getElementById('message').textContent.includes('Saved'));
    const list = await pg.evaluate(() => window.ftpPlayground.loadExperiments());
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Keep me');
    assert.deepEqual(list[0].policy.capabilities, ['title.set']);
    assert.equal(await pg.locator('.experiment .x-scope').textContent(), 'site-specific');
    const [download] = await Promise.all([pg.waitForEvent('download'), pg.click('#export')]);
    const exported = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(JSON.parse(exported).format, 'fix-the-page/experiments');
    pg.on('dialog', (d) => d.accept());
    await pg.click('.experiment .x-delete');
    await pg.waitForSelector('#experiments-empty:not([hidden])');
    const tmp = path.join(profile, 'experiments.json');
    fs.writeFileSync(tmp, exported);
    await pg.setInputFiles('#import-file', tmp);
    await pg.waitForFunction(() => document.getElementById('side-message').textContent.includes('Imported 1'));
    assert.equal((await pg.evaluate(() => window.ftpPlayground.loadExperiments())).length, 1);
    fs.writeFileSync(tmp, JSON.stringify({ format: 'fix-the-page/experiments', version: 1, experiments: [{ ...JSON.parse(exported).experiments[0], script: "document.cookie", policy: { policy: 'fix-the-page/sbp', version: 1, capabilities: ['dom.eval'] } }] }));
    await pg.setInputFiles('#import-file', tmp);
    await pg.waitForFunction(() => document.getElementById('side-message').textContent.includes('Not imported'));
    assert.equal((await pg.evaluate(() => window.ftpPlayground.loadExperiments())).length, 1);
    await pg.close(); await page.close();
  });
});
