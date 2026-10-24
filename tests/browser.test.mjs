// Engine-in-a-page tests: Playwright, no extension. engine.js is added to fixture pages with
// page.addScriptTag and driven through window.__fixThePage. Covers A1 to A6 and the site API detection.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './helpers/pw.mjs';
import { startServer } from './helpers/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'extension', 'engine.js');
const BRIDGE = path.join(ROOT, 'extension', 'bridge.js');

let browser, server;
before(async () => { browser = await chromium.launch(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.close(); });

async function open(fixture, path = '/' + fixture) {
  const page = await browser.newPage();
  await page.goto(server.base + path);
  await page.addScriptTag({ path: ENGINE });
  return page;
}
const rule = (over = {}) => ({ id: 'r-test', match: 'http://127.0.0.1/*', fix: 'title', value: 'Mine', mode: 'set', created: '2026-10-24T20:40:00Z', enabled: true, ...over });
const apply = (page, r) => page.evaluate((r) => window.__fixThePage.apply(r), r);
const status = (page) => page.evaluate(() => window.__fixThePage.status());

describe('engine in a page', () => {
  test('A1: set on a static page', async () => {
    const page = await open('static.html');
    assert.equal(await page.title(), 'Original');
    const res = await apply(page, rule());
    assert.equal(res.ok, true);
    assert.equal(await page.title(), 'Mine');
    const s = await status(page);
    assert.equal(s.pageTitle, 'Original');
    assert.equal(s.applied, true);
    await page.close();
  });

  test('A2: a page that rewrites its title every 500 ms stays fixed and the observer does not loop', async () => {
    const page = await open('rewriter.html');
    await apply(page, rule());
    await page.waitForTimeout(5000);
    assert.equal(await page.title(), 'Mine');
    const s = await status(page);
    const rewrites = await page.evaluate(() => window.__rewrites);
    assert.ok(rewrites >= 8, `the page rewrote ${rewrites} times`);
    // one application per rewrite plus the first: a loop would be hundreds
    assert.ok(s.reapplyCount <= rewrites + 2, `reapplied ${s.reapplyCount} times for ${rewrites} rewrites`);
    assert.match(s.pageTitle, /^Rewritten \d+$/);
    await page.close();
  });

  test('A3: a single-page app, rule on /a/* only', async () => {
    const page = await open('spa.html', '/a/1');
    await apply(page, rule({ match: 'http://127.0.0.1/a/*' }));
    assert.equal(await page.title(), 'Mine');
    await page.evaluate(() => window.go('/b/1'));
    await page.waitForFunction(() => document.title === 'SPA /b/1', null, { timeout: 3000 });
    assert.equal(await page.title(), 'SPA /b/1');
    await page.evaluate(() => window.go('/a/2'));
    await page.waitForFunction(() => document.title === 'Mine', null, { timeout: 3000 });
    await page.goBack();
    await page.waitForFunction(() => document.title === 'SPA /b/1', null, { timeout: 3000 });
    await page.close();
  });

  test('A3b: a route change that sets no title still re-evaluates (pushState fires no event)', async () => {
    const page = await open('spa.html', '/a/1');
    await apply(page, rule({ match: 'http://127.0.0.1/a/*' }));
    await page.evaluate(() => history.pushState({}, '', '/b/9'));
    await page.waitForFunction(() => document.title === 'SPA home', null, { timeout: 3000 }); // the fixture's static title
    await page.evaluate(() => history.pushState({}, '', '/a/9'));
    await page.waitForFunction(() => document.title === 'Mine', null, { timeout: 3000 });
    await page.close();
  });

  test('A4: template follows the page\'s later titles', async () => {
    const page = await open('static.html');
    await page.evaluate(() => { document.title = 'Home'; });
    await apply(page, rule({ mode: 'template', value: '[DEV] {title}' }));
    assert.equal(await page.title(), '[DEV] Home');
    await page.evaluate(() => { document.title = 'Settings'; });
    await page.waitForFunction(() => document.title === '[DEV] Settings', null, { timeout: 3000 });
    await page.close();
  });

  test('A5: undo restores the original title and disconnects the observer', async () => {
    const page = await open('rewriter.html');
    await apply(page, rule({ mode: 'prefix', value: '[X] ' }));
    assert.match(await page.title(), /^\[X\] /);
    const s = await page.evaluate(() => window.__fixThePage.undo());
    assert.equal(s.applied, false);
    assert.equal(s.observing, false);
    assert.doesNotMatch(await page.title(), /^\[X\] /);
    await page.waitForTimeout(1200);
    assert.doesNotMatch(await page.title(), /^\[X\] /);
    assert.equal(await page.evaluate(() => window.__fixThePage.status().observing), false);
    await page.close();
  });

  test('A6: injected twice, one observer and no double prefix', async () => {
    const page = await open('static.html');
    await apply(page, rule({ mode: 'prefix', value: '[X] ' }));
    await page.evaluate(() => { window.__fixThePage._mark = 'first'; });
    await page.addScriptTag({ path: ENGINE });
    await page.addScriptTag({ path: ENGINE });
    assert.equal(await page.title(), '[X] Original');
    const same = await page.evaluate(() => window.__fixThePage._mark === 'first');
    const s = await status(page);
    assert.equal(s.ephemeral.length, 1);
    assert.equal(s.observing, true);
    await page.evaluate(() => { document.title = 'Changed'; });
    await page.waitForFunction(() => document.title === '[X] Changed', null, { timeout: 3000 });
    assert.equal(same, true);
    await page.close();
  });

  test('a replaced <title> element is noticed', async () => {
    const page = await open('replace-title.html');
    await apply(page, rule({ mode: 'suffix', value: ' !' }));
    assert.equal(await page.title(), 'Original !');
    await page.evaluate(() => window.replaceTitle('Replaced'));
    await page.waitForFunction(() => document.title === 'Replaced !', null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('title').length), 1);
    await page.close();
  });

  test('a rule that does not match this page changes nothing', async () => {
    const page = await open('static.html');
    const res = await apply(page, rule({ match: 'https://elsewhere.example/*' }));
    assert.equal(res.ok, true);
    assert.equal(await page.title(), 'Original');
    assert.equal(res.status.applied, false);
    await page.close();
  });

  test('a bad rule is refused by the engine too', async () => {
    const page = await open('static.html');
    const res = await apply(page, rule({ fix: 'hide' }));
    assert.equal(res.ok, false);
    assert.equal(await page.title(), 'Original');
    await page.close();
  });

  test('site API: detected through the bridge, and absent where there is none', async () => {
    const page = await browser.newPage();
    await page.goto(server.base + '/site-api.html');
    await page.addScriptTag({ path: BRIDGE });
    await page.addScriptTag({ path: ENGINE });
    const s = await status(page);
    assert.deepEqual(s.siteApi, { name: 'page-fixes', version: '0.1.0', fixes: ['reading', 'bigger', 'contrast'] });
    await page.close();
    const plain = await open('static.html');
    await plain.addScriptTag({ path: BRIDGE });
    assert.equal((await status(plain)).siteApi, null);
    await plain.close();
  });
});
