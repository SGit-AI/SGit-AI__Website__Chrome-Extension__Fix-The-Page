// Engine unit tests: the pure core, in Node, no browser. Covers A4, A7, A8 and the match-pattern grammar.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../extension/engine.js');

const rule = (over = {}) => ({ id: 'r-1', match: 'https://example.com/*', fix: 'title', value: 'Mine', mode: 'set', created: '2026-10-24T20:40:00Z', enabled: true, ...over });

describe('parseMatchPattern', () => {
  const valid = ['https://example.com/*', 'http://example.com/', '*://example.com/*', 'https://*.example.com/foo*bar', 'https://*/*', 'http://127.0.0.1/*', 'http://localhost:8080/*', 'https://example.com:443/path/*', 'https://a-b.example.co.uk/*?q=*'];
  for (const p of valid) test(`accepts ${p}`, () => assert.ok(core.parseMatchPattern(p), p));
  const invalid = ['', 'example.com', 'https://example.com', 'https://*example.com/*', 'https://example.*/*', 'ftp://example.com/*', 'file:///foo*', '<all_urls>', 'https://exa mple.com/*', 'https://example.com:99999/*', 'javascript:alert(1)', 42, null, {}];
  for (const p of invalid) test(`rejects ${JSON.stringify(p)}`, () => assert.equal(core.parseMatchPattern(p), null));
  test('marks patterns wider than one origin as broad', () => {
    assert.equal(core.parseMatchPattern('https://example.com/*').broad, false);
    assert.equal(core.parseMatchPattern('*://example.com/*').broad, true);
    assert.equal(core.parseMatchPattern('https://*.example.com/*').broad, true);
    assert.equal(core.parseMatchPattern('https://*/*').broad, true);
  });
});

describe('matchPattern, tested against many URLs not one', () => {
  const cases = [
    ['https://example.com/*', 'https://example.com/', true],
    ['https://example.com/*', 'https://example.com/a/b?c=d#e', true],
    ['https://example.com/*', 'http://example.com/', false],
    ['https://example.com/*', 'https://www.example.com/', false],
    ['https://example.com/*', 'https://example.com.evil.net/', false],
    ['https://example.com/*', 'https://evil.net/https://example.com/', false],
    ['*://example.com/*', 'http://example.com/x', true],
    ['*://example.com/*', 'https://example.com/x', true],
    ['https://*.example.com/*', 'https://app.example.com/x', true],
    ['https://*.example.com/*', 'https://example.com/x', true],
    ['https://*.example.com/*', 'https://notexample.com/x', false],
    ['https://*/*', 'https://anything.at.all/', true],
    ['https://*/*', 'http://anything.at.all/', false],
    ['https://app.example.com/dashboard/*', 'https://app.example.com/dashboard/', true],
    ['https://app.example.com/dashboard/*', 'https://app.example.com/dashboard', false],
    ['https://app.example.com/dashboard/*', 'https://app.example.com/dashboards/1', false],
    ['https://example.com/a/*', 'https://example.com/a/1', true],
    ['https://example.com/a/*', 'https://example.com/b/1', false],
    ['https://example.com/*?tab=*', 'https://example.com/x?tab=1', true],
    ['https://example.com/*?tab=*', 'https://example.com/x', false],
    ['https://example.com/foo*bar', 'https://example.com/foo-and-bar', true],
    ['https://example.com/foo*bar', 'https://example.com/foo-and-baz', false],
    ['http://localhost/*', 'http://localhost:3000/', true],
    ['http://localhost:3000/*', 'http://localhost:3000/', true],
    ['http://localhost:3000/*', 'http://localhost:4000/', false],
    ['https://example.com:443/*', 'https://example.com/', true],
    ['https://EXAMPLE.com/*', 'https://example.COM/', true],
    ['https://example.com/*', 'not a url', false],
    ['https://example.com/*', 'chrome://extensions/', false],
    ['https://example.com/*', 'file:///etc/hosts', false],
  ];
  for (const [p, u, want] of cases) test(`${p} vs ${u} -> ${want}`, () => assert.equal(core.matchPattern(u, p), want));
  test('regex metacharacters in a path are literal', () => {
    assert.equal(core.matchPattern('https://example.com/a.b', 'https://example.com/a.b'), true);
    assert.equal(core.matchPattern('https://example.com/axb', 'https://example.com/a.b'), false);
    assert.equal(core.matchPattern('https://example.com/(x)', 'https://example.com/(x)'), true);
  });
});

describe('computeTitle (A4 and the modes)', () => {
  test('set', () => assert.equal(core.computeTitle(rule(), 'Home', 'https://example.com/'), 'Mine'));
  test('prefix', () => assert.equal(core.computeTitle(rule({ mode: 'prefix', value: '[DEV] ' }), 'Home', 'https://example.com/'), '[DEV] Home'));
  test('suffix', () => assert.equal(core.computeTitle(rule({ mode: 'suffix', value: ' · dev' }), 'Home', 'https://example.com/'), 'Home · dev'));
  test('template fills title, host and path', () => {
    assert.equal(core.computeTitle(rule({ mode: 'template', value: '[DEV] {title}' }), 'Home', 'https://example.com/x'), '[DEV] Home');
    assert.equal(core.computeTitle(rule({ mode: 'template', value: '{host}{path} | {title}' }), 'Home', 'https://app.example.com:8443/x/y?z'), 'app.example.com:8443/x/y | Home');
  });
  test('template follows the page\'s later titles', () => {
    const r = rule({ mode: 'template', value: '[DEV] {title}' });
    assert.equal(core.computeTitle(r, 'Home', 'https://example.com/'), '[DEV] Home');
    assert.equal(core.computeTitle(r, 'Settings', 'https://example.com/'), '[DEV] Settings');
  });
  test('template leaves unknown placeholders alone', () => assert.equal(core.computeTitle(rule({ mode: 'template', value: '{nope} {title}' }), 'T', 'https://e.com/'), '{nope} T'));
  test('a page with no title', () => assert.equal(core.computeTitle(rule({ mode: 'prefix', value: 'X' }), undefined, 'https://e.com/'), 'X'));
  test('several matching rules apply in creation order, each on the last', () => {
    const rules = [rule({ id: 'b', mode: 'suffix', value: ' (2)', created: '2026-01-02T00:00:00Z' }), rule({ id: 'a', mode: 'set', value: 'One', created: '2026-01-01T00:00:00Z' })];
    const m = core.rulesFor('https://example.com/', rules);
    assert.deepEqual(m.map((r) => r.id), ['a', 'b']);
    assert.equal(core.applyRules(m, 'Page', 'https://example.com/'), 'One (2)');
  });
  test('disabled and non-matching rules are left out', () => {
    const rules = [rule({ id: 'off', enabled: false }), rule({ id: 'elsewhere', match: 'https://other.com/*' }), rule({ id: 'on' })];
    assert.deepEqual(core.rulesFor('https://example.com/', rules).map((r) => r.id), ['on']);
  });
});

describe('validateRule', () => {
  test('accepts a well-formed rule and normalises it', () => {
    const v = core.validateRule(rule());
    assert.equal(v.ok, true);
    assert.deepEqual(v.rule, rule());
    assert.equal(v.broad, false);
  });
  test('defaults enabled and created', () => {
    const { enabled, created, ...rest } = rule();
    const v = core.validateRule(rest);
    assert.equal(v.ok, true);
    assert.equal(v.rule.enabled, true);
    assert.ok(!isNaN(Date.parse(v.rule.created)));
  });
  const bad = {
    'unknown fix': rule({ fix: 'hide' }),
    'unknown mode': rule({ mode: 'eval' }),
    'bad pattern': rule({ match: 'example.com' }),
    'all_urls': rule({ match: '<all_urls>' }),
    'extra code-like field': rule({ code: 'alert(1)' }),
    'extra script field': rule({ script: 'x' }),
    'value not a string': rule({ value: ['a'] }),
    'value too long': rule({ value: 'x'.repeat(501) }),
    'bad id': rule({ id: '../x' }),
    'bad created': rule({ created: 'yesterday' }),
    'enabled not boolean': rule({ enabled: 'yes' }),
    'not an object': 'rule',
    'an array': [rule()],
    'null': null,
  };
  for (const [name, r] of Object.entries(bad)) test(`rejects ${name}`, () => {
    const v = core.validateRule(r);
    assert.equal(v.ok, false);
    assert.ok(v.errors.length >= 1);
    assert.equal(v.rule, undefined);
  });
});

describe('validateImport (A7) and export (A8)', () => {
  const file = () => ({ format: 'fix-the-page/rules', version: 1, exported: '2026-10-24T20:40:00Z', rules: [rule(), rule({ id: 'r-2', match: 'https://other.com/*', mode: 'prefix', value: '[X] ' })] });
  test('accepts a good file, as a string or an object', () => {
    assert.equal(core.validateImport(file()).ok, true);
    const v = core.validateImport(JSON.stringify(file()));
    assert.equal(v.ok, true);
    assert.equal(v.rules.length, 2);
  });
  test('round trip: export then import gives identical rules', () => {
    const rules = file().rules;
    const out = core.exportRules(rules);
    assert.equal(out.format, 'fix-the-page/rules');
    assert.equal(out.version, 1);
    const v = core.validateImport(JSON.stringify(out));
    assert.equal(v.ok, true);
    assert.deepEqual(v.rules, rules);
  });
  const bad = {
    'not JSON': '{not json',
    'a list at the top': JSON.stringify([rule()]),
    'wrong format': { ...file(), format: 'other' },
    'wrong version': { ...file(), version: 2 },
    'rules not a list': { ...file(), rules: {} },
    'unknown top-level field': { ...file(), script: 'x' },
    'unknown fix inside': { ...file(), rules: [rule({ fix: 'hide' })] },
    'bad pattern inside': { ...file(), rules: [rule({ match: 'nope' })] },
    'code-like field inside': { ...file(), rules: [rule({ onload: 'alert(1)' })] },
    'duplicate ids': { ...file(), rules: [rule(), rule()] },
    'too many rules': { ...file(), rules: Array.from({ length: 1001 }, (_, i) => rule({ id: 'r-' + i })) },
  };
  for (const [name, f] of Object.entries(bad)) test(`rejects ${name} with a message and stores nothing`, () => {
    const v = core.validateImport(f);
    assert.equal(v.ok, false);
    assert.ok(v.errors.length >= 1 && v.errors.every((e) => typeof e === 'string' && e.length));
    assert.equal(v.rules, undefined);
  });
  test('a rejected file names the rule and the field', () => {
    const v = core.validateImport({ ...file(), rules: [rule(), rule({ id: 'r-2', mode: 'nope' })] });
    assert.match(v.errors[0], /rule 2: mode/);
  });
});

describe('helpers', () => {
  test('originOfPattern', () => {
    assert.equal(core.originOfPattern('https://example.com/a/*'), 'https://example.com/*');
    assert.equal(core.originOfPattern('http://localhost:3000/*'), 'http://localhost:3000/*');
    assert.equal(core.originOfPattern('*://example.com/*'), null);
    assert.equal(core.originOfPattern('nope'), null);
  });
  test('patternForUrl', () => {
    assert.equal(core.patternForUrl('https://app.example.com:8443/x?y'), 'https://app.example.com:8443/*');
    assert.equal(core.patternForUrl('chrome://extensions/'), null);
  });
  test('newId is a valid id', () => assert.equal(core.validateRule(rule({ id: core.newId() })).ok, true));
});
