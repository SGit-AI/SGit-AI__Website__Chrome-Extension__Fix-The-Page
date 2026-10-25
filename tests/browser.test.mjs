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

describe('capabilities in a page (the engine side of the playground)', () => {
  const cap = (page, runId, name, args) => page.evaluate(([r, n, a]) => window.__fixThePage.cap(r, n, a), [runId, name, args]);

  test('read capabilities read, and nothing changes', async () => {
    const page = await open('static.html');
    assert.deepEqual(await cap(page, 'r1', 'title.get', []), { ok: true, value: 'Original' });
    assert.equal((await cap(page, 'r1', 'url.get', [])).value, server.base + '/static.html');
    assert.deepEqual(await cap(page, 'r1', 'dom.count', ['h1']), { ok: true, value: 1 });
    assert.deepEqual(await cap(page, 'r1', 'dom.text', ['h1']), { ok: true, value: 'A static page' });
    assert.deepEqual(await cap(page, 'r1', 'dom.text', ['nope']), { ok: true, value: null });
    assert.equal(await page.title(), 'Original');
    await page.close();
  });

  test('write capabilities apply and undo reverses them in order', async () => {
    const page = await open('static.html');
    assert.deepEqual(await cap(page, 'r2', 'title.set', ['From a script']), { ok: true, value: 'From a script' });
    assert.equal(await page.title(), 'From a script');
    assert.deepEqual(await cap(page, 'r2', 'dom.hide', ['h1']), { ok: true, value: 1 });
    assert.equal(await page.locator('h1').isHidden(), true);
    assert.deepEqual(await cap(page, 'r2', 'dom.setText', ['p', 'Changed']), { ok: true, value: 1 });
    assert.equal(await page.locator('p').innerText(), 'Changed');
    const css = await cap(page, 'r2', 'css.add', ['body { background: rgb(1, 2, 3) !important }']);
    assert.equal(css.ok, true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)');
    const effects = await page.evaluate(() => window.__fixThePage.runEffects('r2'));
    assert.deepEqual(effects.map((e) => e.kind), ['title', 'hide', 'text', 'css']);
    await page.evaluate(() => window.__fixThePage.undoRun('r2'));
    assert.equal(await page.title(), 'Original');
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.match(await page.locator('p').innerText(), /^Its title is/);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)');
    assert.deepEqual(await page.evaluate(() => window.__fixThePage.runEffects('r2')), []);
    await page.close();
  });

  test('a title set by a script is held against the page rewriting it', async () => {
    const page = await open('rewriter.html');
    await cap(page, 'r3', 'title.set', ['Held']);
    await page.waitForTimeout(1200);
    assert.equal(await page.title(), 'Held');
    await page.evaluate(() => window.__fixThePage.undoRun('r3'));
    await page.waitForTimeout(700);
    assert.match(await page.title(), /^Rewritten/);
    await page.close();
  });

  test('two runs undo independently, and undoAllRuns clears the rest', async () => {
    const page = await open('static.html');
    await cap(page, 'a', 'dom.hide', ['h1']);
    await cap(page, 'b', 'dom.hide', ['p']);
    await page.evaluate(() => window.__fixThePage.undoRun('a'));
    assert.equal(await page.locator('h1').isVisible(), true);
    assert.equal(await page.locator('p').isHidden(), true);
    await page.evaluate(() => window.__fixThePage.undoAllRuns());
    assert.equal(await page.locator('p').isVisible(), true);
    await page.close();
  });

  test('the engine refuses what it does not know and bad arguments, whatever the caller says', async () => {
    const page = await open('static.html');
    assert.match((await cap(page, 'r4', 'dom.eval', ['x'])).error, /no such capability/);
    assert.match((await cap(page, 'r4', 'dom.hide', ['%%%'])).error, /not a valid CSS selector/);
    assert.match((await cap(page, 'r4', 'dom.hide', [''])).error, /selector/);
    assert.match((await cap(page, 'r4', 'title.set', [42])).error, /string/);
    assert.match((await cap(page, 'r4', 'css.add', ['x'.repeat(20001)])).error, /longer/);
    assert.equal(await page.title(), 'Original');
    await page.close();
  });
});

describe('the sandbox realm (sandbox.html as a plain page under its CSP)', () => {
  async function host() {
    const page = await browser.newPage();
    await page.goto(server.base + '/sandbox-host.html');
    await page.evaluate(() => window.ready);
    return page;
  }
  const runIn = (page, script, caps, limits, answers) => page.evaluate(([s, c, l, a]) => window.runScript(s, c, l, a), [script, caps || [], limits || null, answers || {}]);

  test('a script sees no window, document, fetch, chrome or parent', async () => {
    const page = await host();
    const done = await runIn(page, "return [typeof window, typeof document, typeof fetch, typeof chrome, typeof parent, typeof globalThis, typeof localStorage, typeof XMLHttpRequest].join(',');");
    assert.equal(done.ok, true);
    assert.equal(done.value, 'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined');
    await page.close();
  });

  test('a granted capability call reaches the host and the answer comes back', async () => {
    const page = await host();
    const done = await runIn(page, "const t = await page.title.get(); await page.title.set('[x] ' + t); return t;", ['title.get', 'title.set'], null, { 'title.get': { ok: true, value: 'Original' }, 'title.set': { ok: true, value: '[x] Original' } });
    assert.equal(done.ok, true);
    assert.equal(done.value, 'Original');
    const calls = await page.evaluate(() => window.events.filter((e) => e.type === 'sbp:cap').map((e) => [e.name, e.args]));
    assert.deepEqual(calls, [['title.get', []], ['title.set', ['[x] Original']]]);
    await page.close();
  });

  test('a capability not in the policy is refused before any message is sent', async () => {
    const page = await host();
    const done = await runIn(page, "await page.css.add('body{display:none}');", ['title.set']);
    assert.equal(done.ok, false);
    assert.match(done.error, /not in the policy/);
    assert.equal(await page.evaluate(() => window.events.filter((e) => e.type === 'sbp:cap').length), 0);
    await page.close();
  });

  test('the host refusing a call surfaces as an error in the script', async () => {
    const page = await host();
    const done = await runIn(page, "try { await page.dom.hide('body'); return 'applied'; } catch (e) { return 'caught: ' + e.message; }", ['dom.hide'], null, { 'dom.hide': { ok: false, error: 'refused by the policy: selector "body" is not in the policy' } });
    assert.equal(done.value, 'caught: refused by the policy: selector "body" is not in the policy');
    await page.close();
  });

  test('a script that runs too long is stopped by the time limit', async () => {
    const page = await host();
    const done = await runIn(page, "await new Promise(() => {});", [], { calls: 10, ms: 300 });
    assert.equal(done.ok, false);
    assert.match(done.error, /longer than 300 ms/);
    await page.close();
  });

  test('a script that calls too often is stopped by the call limit', async () => {
    const page = await host();
    const done = await runIn(page, "for (let i = 0; i < 20; i++) await page.title.get();", ['title.get'], { calls: 5, ms: 3000 }, { 'title.get': { ok: true, value: 'x' } });
    assert.equal(done.ok, false);
    assert.match(done.error, /more than 5 calls/);
    await page.close();
  });

  test('a syntax error and a thrown error are reported, not swallowed', async () => {
    const page = await host();
    assert.match((await runIn(page, "await (", [])).error, /syntax/);
    assert.match((await runIn(page, "throw new Error('mine')", [])).error, /mine/);
    await page.close();
  });

  test('the sandbox cannot open a connection (CSP), and an escape from the shadowing still only yields messages', async () => {
    const page = await host();
    // (async () => {}).constructor reaches the real AsyncFunction and, through it, the sandbox's own window; what it finds
    // there is a page with no network and no extension API. The only way out is still a message.
    const done = await runIn(page, "const F = (async () => {}).constructor; const w = await F('return globalThis')(); let f = 'none'; try { await w.fetch('http://127.0.0.1:1/'); f = 'fetched'; } catch (e) { f = 'blocked: ' + e.name; } return [typeof w.chrome, typeof w.document.querySelector, f].join('|');", []);
    assert.equal(done.ok, true);
    const [chrome, qs, fetched] = done.value.split('|');
    assert.equal(chrome, 'undefined');
    assert.equal(qs, 'function');
    assert.match(fetched, /^blocked/);
    await page.close();
  });
});
