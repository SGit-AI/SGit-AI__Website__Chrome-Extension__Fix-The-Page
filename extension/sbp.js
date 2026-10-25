/* Fix the Page: sbp.js, the Script Behaviour Policy core.
 *
 * A Script Behaviour Policy is the Agent Behaviour Policy model applied to a script: the mandate is the
 * list of capabilities the script may use, the grant is everything JavaScript on a page could do, the
 * delta is the difference, and the barrier is where each line is enforced. This file is the pure part:
 * what a policy is, whether a call is inside it, what a script asks for, and what an experiment file
 * looks like. It has no DOM, so Node can test it. Enforcement happens elsewhere, in a different realm
 * from the script: the playground page checks every call against the policy before it reaches the page,
 * and the engine on the page checks the arguments again before it acts.
 */
(function (root) {
  'use strict';

  var VERSION = '0.1';
  var POLICY_FORMAT = 'fix-the-page/sbp';
  var POLICY_VERSION = 1;
  var EXPERIMENTS_FORMAT = 'fix-the-page/experiments';
  var EXPERIMENTS_VERSION = 1;

  // The capability vocabulary: every verb a script can ask the page for, and nothing else exists. A name
  // not in this table is not a capability, so a policy cannot grant it and the engine will not perform it.
  var CAPABILITIES = {
    'title.get':   { kind: 'read',  args: [],                     desc: "read the tab's title" },
    'title.set':   { kind: 'write', args: ['string'],             desc: "set the tab's title (held against rewrites, undone on Undo)" },
    'url.get':     { kind: 'read',  args: [],                     desc: "read the page's URL" },
    'dom.count':   { kind: 'read',  args: ['selector'],           desc: 'count the elements a CSS selector matches' },
    'dom.text':    { kind: 'read',  args: ['selector'],           desc: 'read the text of the first element a selector matches (2000 characters at most)' },
    'dom.hide':    { kind: 'write', args: ['selector'],           desc: 'hide every element a selector matches (200 at most)' },
    'dom.setText': { kind: 'write', args: ['selector', 'string'], desc: 'replace the text of the first element a selector matches' },
    'css.add':     { kind: 'write', args: ['string'],             desc: 'add a stylesheet to the page (20000 characters at most)' }
  };
  var LIMITS_DEFAULT = { calls: 100, ms: 5000 };
  var LIMITS_MAX = { calls: 1000, ms: 30000 };
  var MAX = { string: 20000, selector: 500, script: 20000, name: 120, notes: 2000, selectors: 50 };
  var POLICY_KEYS = ['policy', 'version', 'capabilities', 'limits', 'selectors'];
  var EXPERIMENT_KEYS = ['id', 'name', 'match', 'policy', 'script', 'created', 'updated', 'notes'];
  var ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

  // Names a script has no business using. They are shadowed in the sandbox and refused by the lint. The
  // list is a lint, not the boundary: the boundary is that the script's realm holds nothing but the
  // capability proxies, and every message it sends is checked against the policy on the other side.
  var BANNED_TOKENS = ['window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'fetch', 'XMLHttpRequest',
    'WebSocket', 'EventSource', 'eval', 'Function', 'import', 'importScripts', 'require', 'chrome', 'browser', 'location',
    'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'open', 'postMessage', 'MessageChannel', 'Worker',
    'SharedWorker', 'ServiceWorker', 'BroadcastChannel', 'constructor', '__proto__', 'prototype', 'Reflect', 'Proxy', 'with'];

  function isPlainObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

  function validatePolicy(obj) {
    var errors = [];
    if (!isPlainObject(obj)) return { ok: false, errors: ['a policy must be an object'] };
    Object.keys(obj).forEach(function (k) { if (POLICY_KEYS.indexOf(k) === -1) errors.push('unknown policy field "' + k + '"'); });
    if (obj.policy !== POLICY_FORMAT) errors.push('policy must be "' + POLICY_FORMAT + '"');
    if (obj.version !== POLICY_VERSION) errors.push('policy version must be ' + POLICY_VERSION);
    var caps = [];
    if (!Array.isArray(obj.capabilities)) errors.push('capabilities must be a list');
    else obj.capabilities.forEach(function (c) {
      if (typeof c !== 'string' || !CAPABILITIES[c]) errors.push('unknown capability "' + c + '"');
      else if (caps.indexOf(c) === -1) caps.push(c);
    });
    var limits = { calls: LIMITS_DEFAULT.calls, ms: LIMITS_DEFAULT.ms };
    if (obj.limits !== undefined) {
      if (!isPlainObject(obj.limits)) errors.push('limits must be an object');
      else {
        Object.keys(obj.limits).forEach(function (k) {
          if (k !== 'calls' && k !== 'ms') { errors.push('unknown limit "' + k + '"'); return; }
          var v = obj.limits[k];
          if (typeof v !== 'number' || !isFinite(v) || v < 1 || v > LIMITS_MAX[k] || Math.floor(v) !== v) errors.push('limit ' + k + ' must be a whole number from 1 to ' + LIMITS_MAX[k]);
          else limits[k] = v;
        });
      }
    }
    var selectors;
    if (obj.selectors !== undefined) {
      if (!Array.isArray(obj.selectors) || obj.selectors.length > MAX.selectors) errors.push('selectors must be a list of at most ' + MAX.selectors);
      else {
        selectors = [];
        obj.selectors.forEach(function (s) {
          if (typeof s !== 'string' || !s.trim() || s.length > MAX.selector) errors.push('a selector must be a short string');
          else selectors.push(s);
        });
      }
    }
    if (errors.length) return { ok: false, errors: errors };
    var policy = { policy: POLICY_FORMAT, version: POLICY_VERSION, capabilities: caps, limits: limits };
    if (selectors) policy.selectors = selectors;
    return { ok: true, errors: [], policy: policy };
  }

  function emptyPolicy() { return { policy: POLICY_FORMAT, version: POLICY_VERSION, capabilities: [], limits: { calls: LIMITS_DEFAULT.calls, ms: LIMITS_DEFAULT.ms } }; }

  // Is one call inside the policy? The gate. Pure, so both the playground and the tests can ask it.
  function checkCall(policy, call) {
    if (!isPlainObject(call) || typeof call.name !== 'string') return { ok: false, reason: 'not a call' };
    var spec = CAPABILITIES[call.name];
    if (!spec) return { ok: false, reason: 'no such capability: ' + call.name };
    if (!policy || policy.capabilities.indexOf(call.name) === -1) return { ok: false, reason: call.name + ' is not in the policy' };
    var args = Array.isArray(call.args) ? call.args : [];
    if (args.length !== spec.args.length) return { ok: false, reason: call.name + ' takes ' + spec.args.length + ' argument(s), got ' + args.length };
    for (var i = 0; i < spec.args.length; i++) {
      var a = args[i], t = spec.args[i];
      if (typeof a !== 'string') return { ok: false, reason: 'argument ' + (i + 1) + ' of ' + call.name + ' must be a string' };
      if (t === 'selector') {
        if (!a.trim() || a.length > MAX.selector) return { ok: false, reason: 'a selector must be a short, non-empty string' };
        if (policy.selectors && policy.selectors.indexOf(a) === -1) return { ok: false, reason: 'selector "' + a + '" is not in the policy' };
      } else if (a.length > MAX.string) return { ok: false, reason: 'argument ' + (i + 1) + ' of ' + call.name + ' is longer than ' + MAX.string };
    }
    return { ok: true };
  }

  // What a script asks for, read statically. A regex over page.x.y is not a parser, and a script can hide
  // a call from it; that is fine, because the lint is advice and the gate is the barrier.
  function lintScript(script, policy) {
    var text = typeof script === 'string' ? script : '';
    var out = { calls: [], missing: [], unused: [], banned: [], errors: [] };
    if (text.length > MAX.script) out.errors.push('the script is longer than ' + MAX.script + ' characters');
    if (!text.trim()) out.errors.push('the script is empty');
    var m, re = /\bpage\s*\.\s*([A-Za-z]+)\s*\.\s*([A-Za-z]+)\s*\(/g;
    while ((m = re.exec(text))) {
      var name = m[1] + '.' + m[2];
      if (out.calls.indexOf(name) === -1) out.calls.push(name);
    }
    out.calls.forEach(function (c) {
      if (!CAPABILITIES[c]) out.errors.push('page.' + c + '() is not a capability');
      else if (!policy || policy.capabilities.indexOf(c) === -1) out.missing.push(c);
    });
    if (policy) policy.capabilities.forEach(function (c) { if (out.calls.indexOf(c) === -1) out.unused.push(c); });
    var lines = text.split('\n');
    lines.forEach(function (line, i) {
      BANNED_TOKENS.forEach(function (tok) {
        var r = new RegExp('(^|[^A-Za-z0-9_$.])' + tok.replace(/[$]/g, '\\$') + '(?![A-Za-z0-9_$])');
        if (r.test(line)) out.banned.push({ token: tok, line: i + 1 });
      });
    });
    out.ok = !out.errors.length && !out.missing.length && !out.banned.length;
    return out;
  }

  function validateExperiment(obj) {
    var errors = [];
    if (!isPlainObject(obj)) return { ok: false, errors: ['an experiment must be an object'] };
    Object.keys(obj).forEach(function (k) { if (EXPERIMENT_KEYS.indexOf(k) === -1) errors.push('unknown field "' + k + '"'); });
    if (typeof obj.id !== 'string' || !ID_SHAPE.test(obj.id)) errors.push('id must be a short string of letters, digits, ".", "_", ":" or "-"');
    if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > MAX.name) errors.push('name must be a short string');
    var core = root.FixThePageCore || (typeof require === 'function' ? null : null);
    if (typeof obj.match !== 'string' || !obj.match || obj.match.length > 1000) errors.push('match must be a Chrome match pattern');
    else if (core && !core.parseMatchPattern(obj.match)) errors.push('match must be a Chrome match pattern such as https://example.com/*');
    var p = validatePolicy(obj.policy);
    if (!p.ok) p.errors.forEach(function (e) { errors.push('policy: ' + e); });
    if (typeof obj.script !== 'string' || !obj.script.trim()) errors.push('script must be a non-empty string');
    else if (obj.script.length > MAX.script) errors.push('script is longer than ' + MAX.script + ' characters');
    ['created', 'updated'].forEach(function (k) { if (obj[k] !== undefined && (typeof obj[k] !== 'string' || isNaN(Date.parse(obj[k])))) errors.push(k + ' must be a date'); });
    if (obj.notes !== undefined && (typeof obj.notes !== 'string' || obj.notes.length > MAX.notes)) errors.push('notes must be a short string');
    if (errors.length) return { ok: false, errors: errors };
    var now = new Date().toISOString();
    var e = { id: obj.id, name: obj.name.trim(), match: obj.match, policy: p.policy, script: obj.script, created: obj.created || now, updated: obj.updated || obj.created || now };
    if (obj.notes) e.notes = obj.notes;
    return { ok: true, errors: [], experiment: e };
  }

  function validateExperimentsFile(input) {
    var data = input, errors = [];
    if (typeof input === 'string') { try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['the file is not valid JSON'] }; } }
    if (!isPlainObject(data)) return { ok: false, errors: ['the file must contain a JSON object'] };
    Object.keys(data).forEach(function (k) { if (['format', 'version', 'exported', 'experiments'].indexOf(k) === -1) errors.push('unknown field "' + k + '"'); });
    if (data.format !== EXPERIMENTS_FORMAT) errors.push('format must be "' + EXPERIMENTS_FORMAT + '"');
    if (data.version !== EXPERIMENTS_VERSION) errors.push('version must be ' + EXPERIMENTS_VERSION);
    if (!Array.isArray(data.experiments)) errors.push('experiments must be a list');
    else if (data.experiments.length > 500) errors.push('more than 500 experiments');
    if (errors.length) return { ok: false, errors: errors };
    var out = [], seen = {};
    data.experiments.forEach(function (x, i) {
      var v = validateExperiment(x);
      if (!v.ok) { v.errors.forEach(function (e) { errors.push('experiment ' + (i + 1) + ': ' + e); }); return; }
      if (seen[v.experiment.id]) errors.push('experiment ' + (i + 1) + ': duplicate id "' + v.experiment.id + '"');
      seen[v.experiment.id] = true;
      out.push(v.experiment);
    });
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], experiments: out };
  }

  function exportExperiments(list) {
    return { format: EXPERIMENTS_FORMAT, version: EXPERIMENTS_VERSION, exported: new Date().toISOString(),
      experiments: (list || []).map(function (x) { return validateExperiment(x).experiment || x; }) };
  }

  function newId() { return 'x-' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 8); }

  var sbp = {
    VERSION: VERSION, POLICY_FORMAT: POLICY_FORMAT, POLICY_VERSION: POLICY_VERSION,
    EXPERIMENTS_FORMAT: EXPERIMENTS_FORMAT, EXPERIMENTS_VERSION: EXPERIMENTS_VERSION,
    CAPABILITIES: CAPABILITIES, BANNED_TOKENS: BANNED_TOKENS, LIMITS_DEFAULT: LIMITS_DEFAULT, LIMITS_MAX: LIMITS_MAX, MAX: MAX,
    validatePolicy: validatePolicy, emptyPolicy: emptyPolicy, checkCall: checkCall, lintScript: lintScript,
    validateExperiment: validateExperiment, validateExperimentsFile: validateExperimentsFile, exportExperiments: exportExperiments, newId: newId
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = sbp; return; }
  root.FixThePageSBP = sbp;
})(typeof window !== 'undefined' ? window : globalThis);
