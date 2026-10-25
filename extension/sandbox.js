/* Fix the Page: sandbox.js, the realm a script runs in.
 *
 * This page is declared in the manifest's "sandbox" list, so Chrome gives it an opaque origin with no
 * access to the extension's APIs, storage or pages, and a Content Security Policy that lets it build a
 * function from text but open no connection. A script that runs here can reach the page it is meant to
 * fix in exactly one way: by calling a capability proxy, which posts a message to the playground. The
 * playground checks every message against the Script Behaviour Policy before anything reaches the page,
 * so a script that forges a message gains nothing it was not granted.
 *
 * Shadowing the usual globals as undefined arguments keeps honest scripts honest and makes mistakes loud.
 * It is not the boundary; the opaque origin, the CSP and the gate on the other side are.
 */
(function () {
  'use strict';
  var PARENT = window.parent;
  // ('eval' is not in this list: strict code may not name a parameter eval. A direct eval inside the script
  // still sees only this shadowed scope; an indirect one reaches the sandbox's own empty window, which the
  // last test in tests/browser.test.mjs shows gains nothing.)
  var SHADOW = ['window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'fetch', 'XMLHttpRequest', 'WebSocket',
    'EventSource', 'Function', 'importScripts', 'require', 'chrome', 'browser', 'location', 'navigator', 'localStorage',
    'sessionStorage', 'indexedDB', 'open', 'alert', 'confirm', 'prompt', 'postMessage', 'MessageChannel', 'Worker', 'SharedWorker',
    'BroadcastChannel', 'history', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'Reflect', 'Proxy'];
  var CAPS = ['title.get', 'title.set', 'url.get', 'dom.count', 'dom.text', 'dom.hide', 'dom.setText', 'css.add'];

  var current = null; // { runId, pending: {id: {resolve, reject}}, calls, done }
  var seq = 0;

  function send(msg) { PARENT.postMessage(msg, '*'); }

  function makeCap(run, name, allowed) {
    return function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) { return typeof a === 'string' ? a : String(a); });
      if (run.done) return Promise.reject(new Error('the run has ended'));
      if (allowed.indexOf(name) === -1) return Promise.reject(new Error(name + ' is not in the policy'));
      if (++run.calls > run.limits.calls) { return Promise.reject(new Error('more than ' + run.limits.calls + ' calls')); }
      var id = 'c' + (++seq);
      return new Promise(function (resolve, reject) {
        run.pending[id] = { resolve: resolve, reject: reject };
        send({ type: 'sbp:cap', runId: run.runId, id: id, name: name, args: args });
      });
    };
  }

  function makePage(run, allowed) {
    var cap = function (n) { return makeCap(run, n, allowed); };
    var page = {
      title: Object.freeze({ get: cap('title.get'), set: cap('title.set') }),
      url: Object.freeze({ get: cap('url.get') }),
      dom: Object.freeze({ count: cap('dom.count'), text: cap('dom.text'), hide: cap('dom.hide'), setText: cap('dom.setText') }),
      css: Object.freeze({ add: cap('css.add') }),
      log: function () { send({ type: 'sbp:log', runId: run.runId, args: Array.prototype.slice.call(arguments).map(function (a) { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }) }); }
    };
    return Object.freeze(page);
  }

  function finish(run, ok, error, value) {
    if (run.done) return;
    run.done = true;
    clearTimeout(run.timer);
    Object.keys(run.pending).forEach(function (id) { run.pending[id].reject(new Error('the run has ended')); });
    run.pending = {};
    if (current === run) current = null;
    send({ type: 'sbp:done', runId: run.runId, ok: ok, error: error ? String(error && error.message || error) : null, calls: run.calls, value: value === undefined ? null : (typeof value === 'string' ? value : JSON.stringify(value)) });
  }

  function run(msg) {
    if (current) finish(current, false, 'a new run started');
    var allowed = Array.isArray(msg.capabilities) ? msg.capabilities.filter(function (c) { return CAPS.indexOf(c) !== -1; }) : [];
    var limits = { calls: Math.max(1, Math.min(1000, Number(msg.limits && msg.limits.calls) || 100)), ms: Math.max(1, Math.min(30000, Number(msg.limits && msg.limits.ms) || 5000)) };
    var r = { runId: String(msg.runId), pending: {}, calls: 0, done: false, limits: limits, timer: null };
    current = r;
    var page = makePage(r, allowed);
    var fn;
    try {
      // The only place in the extension that turns text into code, and the text is the user's own.
      fn = new Function('page', 'log', SHADOW.join(','), '"use strict";\nreturn (async function () {\n' + String(msg.script) + '\n}).call(undefined);');
    } catch (e) { finish(r, false, 'syntax: ' + e.message); return; }
    r.timer = setTimeout(function () { finish(r, false, 'the run took longer than ' + limits.ms + ' ms'); }, limits.ms);
    var shadows = SHADOW.map(function () { return undefined; });
    try {
      Promise.resolve(fn.apply(undefined, [page, page.log].concat(shadows)))
        .then(function (v) { finish(r, true, null, v); }, function (e) { finish(r, false, e); });
    } catch (e) { finish(r, false, e); }
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== PARENT) return;
    var msg = ev.data;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'sbp:run') run(msg);
    else if (msg.type === 'sbp:cap-result' && current && current.pending[msg.id]) {
      var p = current.pending[msg.id];
      delete current.pending[msg.id];
      if (msg.ok) p.resolve(msg.value === undefined ? null : msg.value); else p.reject(new Error(String(msg.error || 'refused')));
    } else if (msg.type === 'sbp:stop' && current) finish(current, false, 'stopped');
  });
  send({ type: 'sbp:ready' });
})();
