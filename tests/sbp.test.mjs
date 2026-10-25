// The Script Behaviour Policy core: policies, the gate, the lint, experiments and their file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.FixThePageCore = require('../extension/engine.js'); // sbp validates match patterns through the core when it is present
const sbp = require('../extension/sbp.js');

const policy = (caps = ['title.set'], extra = {}) => ({ policy: 'fix-the-page/sbp', version: 1, capabilities: caps, ...extra });
const experiment = (over = {}) => ({ id: 'x-1', name: 'Set the title', match: 'https://example.com/*', policy: policy(), script: "await page.title.set('Mine');", created: '2026-10-25T10:00:00Z', updated: '2026-10-25T10:00:00Z', ...over });

describe('validatePolicy', () => {
  test('accepts a policy and fills the default limits', () => {
    const v = sbp.validatePolicy(policy());
    assert.equal(v.ok, true);
    assert.deepEqual(v.policy, { policy: 'fix-the-page/sbp', version: 1, capabilities: ['title.set'], limits: { calls: 100, ms: 5000 } });
  });
  test('keeps selectors and dedupes capabilities', () => {
    const v = sbp.validatePolicy(policy(['dom.hide', 'dom.hide'], { selectors: ['#banner'] }));
    assert.deepEqual(v.policy.capabilities, ['dom.hide']);
    assert.deepEqual(v.policy.selectors, ['#banner']);
  });
  const bad = {
    'unknown capability': policy(['dom.eval']),
    'unknown field': policy(['title.set'], { script: 'x' }),
    'wrong format': { ...policy(), policy: 'other' },
    'wrong version': { ...policy(), version: 2 },
    'capabilities not a list': { ...policy(), capabilities: 'title.set' },
    'limit too high': policy(['title.set'], { limits: { calls: 5000 } }),
    'limit not a number': policy(['title.set'], { limits: { ms: 'fast' } }),
    'unknown limit': policy(['title.set'], { limits: { network: 1 } }),
    'not an object': 'policy',
  };
  for (const [name, p] of Object.entries(bad)) test(`rejects ${name}`, () => assert.equal(sbp.validatePolicy(p).ok, false));
});

describe('checkCall: the gate', () => {
  const p = sbp.validatePolicy(policy(['title.set', 'dom.hide'])).policy;
  test('allows a granted call with the right arguments', () => assert.equal(sbp.checkCall(p, { name: 'title.set', args: ['Mine'] }).ok, true));
  test('refuses a capability not in the policy', () => assert.match(sbp.checkCall(p, { name: 'css.add', args: ['x'] }).reason, /not in the policy/));
  test('refuses a name that is not a capability at all', () => assert.match(sbp.checkCall(p, { name: 'dom.eval', args: ['x'] }).reason, /no such capability/));
  test('refuses the wrong number of arguments', () => assert.match(sbp.checkCall(p, { name: 'title.set', args: [] }).reason, /takes 1/));
  test('refuses a non-string argument', () => assert.match(sbp.checkCall(p, { name: 'title.set', args: [{ toString: 'x' }] }).reason, /must be a string/));
  test('refuses an over-long argument', () => assert.match(sbp.checkCall(p, { name: 'title.set', args: ['x'.repeat(20001)] }).reason, /longer/));
  test('refuses an empty selector', () => assert.match(sbp.checkCall(p, { name: 'dom.hide', args: ['  '] }).reason, /selector/));
  test('with a selector allowlist, only those selectors pass', () => {
    const q = sbp.validatePolicy(policy(['dom.hide'], { selectors: ['#banner'] })).policy;
    assert.equal(sbp.checkCall(q, { name: 'dom.hide', args: ['#banner'] }).ok, true);
    assert.match(sbp.checkCall(q, { name: 'dom.hide', args: ['body'] }).reason, /not in the policy/);
  });
  test('refuses with no policy, or a forged call shape', () => {
    assert.equal(sbp.checkCall(null, { name: 'title.set', args: ['x'] }).ok, false);
    assert.equal(sbp.checkCall(p, 'title.set').ok, false);
    assert.equal(sbp.checkCall(p, { name: ['title.set'] }).ok, false);
  });
});

describe('lintScript: the static review', () => {
  const p = sbp.validatePolicy(policy(['title.set'])).policy;
  test('a clean script under a matching policy is ok', () => {
    const l = sbp.lintScript("await page.title.set('x');", p);
    assert.equal(l.ok, true);
    assert.deepEqual(l.calls, ['title.set']);
    assert.deepEqual(l.missing, []);
    assert.deepEqual(l.unused, []);
  });
  test('a call the policy does not grant is missing', () => {
    const l = sbp.lintScript("await page.title.set('x'); await page.dom.hide('h1');", p);
    assert.deepEqual(l.missing, ['dom.hide']);
    assert.equal(l.ok, false);
  });
  test('a grant the script does not use is unused (advice, not an error)', () => {
    const l = sbp.lintScript("log('hi')", p);
    assert.deepEqual(l.unused, ['title.set']);
    assert.equal(l.ok, true);
  });
  test('a call to something that is not a capability is an error', () => {
    const l = sbp.lintScript("await page.dom.eval('x')", p);
    assert.match(l.errors[0], /not a capability/);
  });
  for (const tok of ['window', 'document', 'fetch', 'eval', 'Function', 'chrome', 'localStorage', 'globalThis', 'constructor', 'import']) {
    test(`"${tok}" is banned`, () => {
      const l = sbp.lintScript(`const a = ${tok};\nawait page.title.set('x');`, p);
      assert.deepEqual(l.banned, [{ token: tok, line: 1 }]);
      assert.equal(l.ok, false);
    });
  }
  test('a banned word inside a longer identifier is not flagged', () => {
    assert.deepEqual(sbp.lintScript("const windowing = 1; await page.title.set('x');", p).banned, []);
    assert.deepEqual(sbp.lintScript("const x = page.title; await page.title.set('x');", p).banned, []);
  });
  test('an empty or over-long script is an error', () => {
    assert.equal(sbp.lintScript('', p).ok, false);
    assert.equal(sbp.lintScript('x'.repeat(20001), p).ok, false);
  });
});

describe('experiments', () => {
  test('accepts and normalises an experiment', () => {
    const v = sbp.validateExperiment(experiment());
    assert.equal(v.ok, true);
    assert.equal(v.experiment.policy.limits.calls, 100);
    assert.equal(v.experiment.match, 'https://example.com/*');
  });
  const bad = {
    'bad match pattern': experiment({ match: 'example.com' }),
    'bad policy inside': experiment({ policy: policy(['nope']) }),
    'empty script': experiment({ script: ' ' }),
    'unknown field': experiment({ onload: 'x' }),
    'no name': experiment({ name: '' }),
    'bad id': experiment({ id: '../x' }),
  };
  for (const [name, x] of Object.entries(bad)) test(`rejects ${name}`, () => assert.equal(sbp.validateExperiment(x).ok, false));
  test('export then import gives identical experiments', () => {
    const list = [experiment(), experiment({ id: 'x-2', name: 'Two', match: '*://*/*', script: 'log(1)', policy: policy([]) })];
    const file = sbp.exportExperiments(list);
    assert.equal(file.format, 'fix-the-page/experiments');
    const v = sbp.validateExperimentsFile(JSON.stringify(file));
    assert.equal(v.ok, true);
    assert.deepEqual(v.experiments, list.map((x) => sbp.validateExperiment(x).experiment));
  });
  test('a bad file is refused whole, with the experiment named', () => {
    const v = sbp.validateExperimentsFile({ format: 'fix-the-page/experiments', version: 1, experiments: [experiment(), experiment({ id: 'x-2', script: '' })] });
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /experiment 2/);
    assert.equal(sbp.validateExperimentsFile('nope').ok, false);
    assert.equal(sbp.validateExperimentsFile({ format: 'other', version: 1, experiments: [] }).ok, false);
  });
});
