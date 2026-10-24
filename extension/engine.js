/* Fix the Page: engine.js
 *
 * The one script that touches a page. It is injected two ways and must behave the same in both:
 *   on demand, by the popup, through chrome.scripting.executeScript with the activeTab grant;
 *   persistently, as a registered content script, on origins the user has granted one by one.
 *
 * The file has two halves.
 *   1. The core: pure functions with no DOM. parseMatchPattern, matchRule, computeTitle, validateRule,
 *      validateImport. Node can load and test them without a browser.
 *   2. The page part: apply rules to document.title, keep them applied while the page rewrites its own
 *      title, re-evaluate on route changes, and undo. It is idempotent: injecting the file twice leaves
 *      one observer and applies nothing twice.
 *
 * Rules are data. The engine never evaluates anything from a rule, from storage or from an import file.
 * It reads two things from the page: the URL, to match rules, and the title, to replace it.
 */
(function (root) {
  'use strict';

  var VERSION = '0.1.0';

  /* ------------------------------------------------------------------ core */

  var FIXES = ['title'];
  var MODES = ['set', 'prefix', 'suffix', 'template'];
  var RULE_KEYS = ['id', 'match', 'fix', 'value', 'mode', 'created', 'enabled'];
  var IMPORT_KEYS = ['format', 'version', 'exported', 'rules'];
  var IMPORT_FORMAT = 'fix-the-page/rules';
  var IMPORT_VERSION = 1;
  var MAX_VALUE = 500;
  var MAX_MATCH = 1000;
  var MAX_RULES = 1000;
  var ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

  // Chrome's match pattern grammar: <scheme>://<host><path>, where scheme is http, https or * (http or
  // https), host is a hostname, *.hostname or *, an optional :port, and path starts with /. A * in the
  // path matches anything. <all_urls> and the file scheme are refused: this extension only ever asks
  // for http and https origins. Returns null when the pattern is not valid.
  var PATTERN = /^(\*|https?):\/\/(\*|\*\.[^/*:]+|[^/*:]+)(?::(\*|\d{1,5}))?(\/.*)$/;
  function parseMatchPattern(pattern) {
    if (typeof pattern !== 'string' || pattern.length > MAX_MATCH) return null;
    var m = PATTERN.exec(pattern);
    if (!m) return null;
    var scheme = m[1], host = m[2].toLowerCase(), port = m[3] || '*', path = m[4];
    var hostName = host.indexOf('*.') === 0 ? host.slice(2) : host;
    if (host !== '*' && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/.test(hostName)) return null;
    if (port !== '*' && Number(port) > 65535) return null;
    var broad = scheme === '*' || host === '*' || host.indexOf('*.') === 0;
    return { scheme: scheme, host: host, port: port, path: path, broad: broad };
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function pathRegExp(path) {
    return new RegExp('^' + path.split('*').map(escapeRegExp).join('.*') + '$');
  }

  // Does a URL fall inside a match pattern? The path is matched against pathname plus query, as Chrome
  // does. A parsed pattern may be passed instead of the string to save re-parsing.
  function matchPattern(url, pattern) {
    var p = typeof pattern === 'string' ? parseMatchPattern(pattern) : pattern;
    if (!p) return false;
    var u;
    try { u = new URL(String(url)); } catch (e) { return false; }
    var scheme = u.protocol.replace(/:$/, '');
    if (scheme !== 'http' && scheme !== 'https') return false;
    if (p.scheme !== '*' && p.scheme !== scheme) return false;
    var host = u.hostname.toLowerCase();
    if (p.host === '*') { /* any host */ }
    else if (p.host.indexOf('*.') === 0) {
      var base = p.host.slice(2);
      if (host !== base && host.slice(-(base.length + 1)) !== '.' + base) return false;
    } else if (host !== p.host) return false;
    if (p.port !== '*') {
      var actual = u.port || (scheme === 'https' ? '443' : '80');
      if (actual !== p.port) return false;
    }
    return pathRegExp(p.path).test(u.pathname + u.search);
  }

  function matchRule(url, rule) {
    return !!(rule && typeof rule === 'object' && matchPattern(url, rule.match));
  }

  // The origin a pattern covers, as a pattern Chrome's permissions API accepts, or null when it is
  // broader than one origin.
  function originOfPattern(pattern) {
    var p = parseMatchPattern(pattern);
    if (!p || p.broad) return null;
    return p.scheme + '://' + p.host + (p.port === '*' ? '' : ':' + p.port) + '/*';
  }

  // The default pattern for a page: its origin, every path.
  function patternForUrl(url) {
    var u;
    try { u = new URL(String(url)); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin + '/*';
  }

  function fillTemplate(template, pageTitle, url) {
    var host = '', path = '';
    try { var u = new URL(String(url)); host = u.host; path = u.pathname; } catch (e) { /* no url */ }
    return template.replace(/\{(title|host|path)\}/g, function (_, k) {
      return k === 'title' ? pageTitle : k === 'host' ? host : path;
    });
  }

  // The title a rule produces from the page's own title. Pure: no DOM.
  function computeTitle(rule, pageTitle, url) {
    var value = typeof rule.value === 'string' ? rule.value : '';
    var title = typeof pageTitle === 'string' ? pageTitle : '';
    switch (rule.mode) {
      case 'set': return value;
      case 'prefix': return value + title;
      case 'suffix': return title + value;
      case 'template': return fillTemplate(value, title, url);
      default: return title;
    }
  }

  // Several rules may match one URL. They apply in creation order, each on the result of the last, so a
  // set followed by a suffix does what it says.
  function rulesFor(url, rules) {
    return (Array.isArray(rules) ? rules : [])
      .filter(function (r) { return r && r.enabled !== false && matchRule(url, r); })
      .sort(function (a, b) { return String(a.created || '') < String(b.created || '') ? -1 : 1; });
  }

  function applyRules(rules, pageTitle, url) {
    return rules.reduce(function (t, r) { return computeTitle(r, t, url); }, pageTitle);
  }

  function isIsoDate(s) {
    return typeof s === 'string' && s.length <= 40 && !isNaN(Date.parse(s));
  }

  // Validate one rule object. Returns { ok, errors, rule, broad }. The rule returned is normalised: only
  // the known keys, enabled defaulting to true, created defaulting to now. Unknown keys are an error,
  // not ignored: a rule carries no code and no room for any.
  function validateRule(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['a rule must be an object'] };
    Object.keys(obj).forEach(function (k) {
      if (RULE_KEYS.indexOf(k) === -1) errors.push('unknown field "' + k + '"');
    });
    if (typeof obj.id !== 'string' || !ID_SHAPE.test(obj.id)) errors.push('id must be a short string of letters, digits, ".", "_", ":" or "-"');
    var parsed = parseMatchPattern(obj.match);
    if (!parsed) errors.push('match must be a Chrome match pattern such as https://example.com/*');
    if (FIXES.indexOf(obj.fix) === -1) errors.push('fix must be one of: ' + FIXES.join(', '));
    if (MODES.indexOf(obj.mode) === -1) errors.push('mode must be one of: ' + MODES.join(', '));
    if (typeof obj.value !== 'string') errors.push('value must be a string');
    else if (obj.value.length > MAX_VALUE) errors.push('value is longer than ' + MAX_VALUE + ' characters');
    if (obj.created !== undefined && !isIsoDate(obj.created)) errors.push('created must be a date');
    if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') errors.push('enabled must be true or false');
    if (errors.length) return { ok: false, errors: errors };
    return {
      ok: true,
      errors: [],
      broad: parsed.broad,
      rule: {
        id: obj.id,
        match: obj.match,
        fix: obj.fix,
        value: obj.value,
        mode: obj.mode,
        created: obj.created || new Date().toISOString(),
        enabled: obj.enabled !== false
      }
    };
  }

  // Validate an export file, given as a JSON string or an already parsed object. Nothing in it is ever
  // executed; a file that is not exactly the documented shape is refused whole.
  function validateImport(input) {
    var data = input, errors = [];
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['the file is not valid JSON'] }; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['the file must contain a JSON object'] };
    Object.keys(data).forEach(function (k) {
      if (IMPORT_KEYS.indexOf(k) === -1) errors.push('unknown field "' + k + '"');
    });
    if (data.format !== IMPORT_FORMAT) errors.push('format must be "' + IMPORT_FORMAT + '"');
    if (data.version !== IMPORT_VERSION) errors.push('version must be ' + IMPORT_VERSION);
    if (!Array.isArray(data.rules)) errors.push('rules must be a list');
    else if (data.rules.length > MAX_RULES) errors.push('more than ' + MAX_RULES + ' rules');
    if (errors.length) return { ok: false, errors: errors };
    var rules = [], seen = {};
    data.rules.forEach(function (r, i) {
      var v = validateRule(r);
      if (!v.ok) { v.errors.forEach(function (e) { errors.push('rule ' + (i + 1) + ': ' + e); }); return; }
      if (seen[v.rule.id]) errors.push('rule ' + (i + 1) + ': duplicate id "' + v.rule.id + '"');
      seen[v.rule.id] = true;
      rules.push(v.rule);
    });
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], rules: rules };
  }

  function exportRules(rules) {
    return {
      format: IMPORT_FORMAT,
      version: IMPORT_VERSION,
      exported: new Date().toISOString(),
      rules: (rules || []).map(function (r) { return validateRule(r).rule || r; })
    };
  }

  function newId() {
    var d = new Date().toISOString().slice(0, 10);
    var rand = Math.random().toString(36).slice(2, 8);
    return 'r-' + d + '-' + rand;
  }

  var core = {
    VERSION: VERSION,
    FIXES: FIXES,
    MODES: MODES,
    IMPORT_FORMAT: IMPORT_FORMAT,
    IMPORT_VERSION: IMPORT_VERSION,
    parseMatchPattern: parseMatchPattern,
    matchPattern: matchPattern,
    matchRule: matchRule,
    originOfPattern: originOfPattern,
    patternForUrl: patternForUrl,
    computeTitle: computeTitle,
    rulesFor: rulesFor,
    applyRules: applyRules,
    validateRule: validateRule,
    validateImport: validateImport,
    exportRules: exportRules,
    newId: newId
  };

  // Node (the unit tests) and the extension's own pages (popup, options) want the core only.
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  if (typeof document === 'undefined') { root.FixThePageCore = core; return; }
  if (root.location && root.location.protocol === 'chrome-extension:') { root.FixThePageCore = core; return; }

  /* ------------------------------------------------------------------ page */

  // Idempotent: a second injection finds the first engine and leaves it alone.
  if (root.__fixThePage) { root.__fixThePage.refresh(); return; }

  var E = {
    version: VERSION,
    core: core,
    stored: [],        // rules from chrome.storage.local, applied where they match
    ephemeral: [],     // rules applied "this page now" from the popup; gone when the page is left
    pageTitle: document.title,   // the page's own, latest title
    lastSet: null,     // the title this engine last set, or null when it is not holding the title
    paused: false,     // after undo, until the next explicit apply
    reapplyCount: 0,   // how many times the title was (re)applied; a loop would send this skyward
    lastUrl: location.href,
    headObserver: null,
    rootObserver: null,
    timer: null
  };

  function matched() {
    return core.rulesFor(location.href, E.stored).concat(core.rulesFor(location.href, E.ephemeral));
  }

  function refresh() {
    if (E.paused) return;
    var rules = matched();
    if (!document.head) { observe(); return; } // document_start: the head may not exist yet
    // While this engine is not holding the title, whatever the document says is the page's own.
    if (E.lastSet === null) E.pageTitle = document.title;
    if (!rules.length) {
      if (E.lastSet !== null && document.title === E.lastSet) document.title = E.pageTitle;
      E.lastSet = null;
      if (E.stored.length || E.ephemeral.length) observe(); else unobserve();
      return;
    }
    var want = core.applyRules(rules, E.pageTitle, location.href);
    if (document.title !== want) {
      document.title = want;
      E.reapplyCount++;
    }
    E.lastSet = want;
    observe();
  }

  function onMutation() {
    var t = document.title;
    if (t !== E.lastSet) E.pageTitle = t; // the page spoke: remember what it wanted
    if (location.href !== E.lastUrl) E.lastUrl = location.href;
    refresh();
  }

  function onNavigate() {
    if (location.href !== E.lastUrl) { E.lastUrl = location.href; refresh(); }
  }

  function observe() {
    if (!E.rootObserver) {
      E.rootObserver = new MutationObserver(function () {
        if (document.head && E.headObserver && E.headObserver._target !== document.head) { E.headObserver.disconnect(); E.headObserver = null; }
        observe();
        onMutation();
      });
      E.rootObserver.observe(document.documentElement, { childList: true });
    }
    if (document.head && !E.headObserver) {
      E.headObserver = new MutationObserver(onMutation);
      E.headObserver._target = document.head;
      E.headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
    if (!E.timer) {
      E.timer = setInterval(onNavigate, 1000);
      root.addEventListener('popstate', onNavigate);
      root.addEventListener('hashchange', onNavigate);
    }
  }

  function unobserve() {
    if (E.headObserver) { E.headObserver.disconnect(); E.headObserver = null; }
    if (E.rootObserver) { E.rootObserver.disconnect(); E.rootObserver = null; }
    if (E.timer) {
      clearInterval(E.timer); E.timer = null;
      root.removeEventListener('popstate', onNavigate);
      root.removeEventListener('hashchange', onNavigate);
    }
  }

  function setStored(rules) {
    E.stored = (Array.isArray(rules) ? rules : []).filter(function (r) { return core.validateRule(r).ok; });
    refresh();
  }

  function apply(rule) {
    var v = core.validateRule(rule);
    if (!v.ok) return { ok: false, errors: v.errors };
    E.paused = false;
    E.ephemeral = E.ephemeral.filter(function (r) { return r.id !== v.rule.id; }).concat([v.rule]);
    refresh();
    return { ok: true, status: status() };
  }

  function undo() {
    if (E.lastSet !== null && document.title === E.lastSet) document.title = E.pageTitle;
    E.lastSet = null;
    E.ephemeral = [];
    E.paused = true;
    unobserve();
    return status();
  }

  // A site that publishes the newsroom-style page API puts it at window.__tools.page in the page's own
  // world. A content script's isolated world cannot see that, so bridge.js (run in the main world) copies
  // its meta onto a data attribute, and this reads it. v0.1 only detects the API.
  function siteApi() {
    try {
      if (root.__tools && root.__tools.page && root.__tools.page.meta) {
        var m = root.__tools.page.meta;
        return { name: m.name, version: m.version, fixes: root.__tools.page.list().map(function (f) { return f.name; }) };
      }
      var raw = document.documentElement.getAttribute('data-fix-the-page-site-api');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function status() {
    var api = siteApi();
    return {
      version: VERSION,
      url: location.href,
      pageTitle: E.pageTitle,
      currentTitle: document.title,
      applied: E.lastSet !== null,
      matched: matched().map(function (r) { return r.id; }),
      ephemeral: E.ephemeral.map(function (r) { return r.id; }),
      observing: !!E.headObserver,
      reapplyCount: E.reapplyCount,
      siteApi: api
    };
  }

  E.refresh = refresh;
  E.setStored = setStored;
  E.apply = apply;
  E.undo = undo;
  E.status = status;
  E.siteApi = siteApi;
  root.__fixThePage = E;

  var api = siteApi();
  if (api) console.info('Fix the Page: this site publishes a page API (' + api.name + ' ' + api.version + ')');

  /* ---------------------------------------------------------- chrome glue */

  var chromeApi = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? chrome : null;
  if (chromeApi && chromeApi.storage && chromeApi.storage.local) {
    try {
      chromeApi.storage.local.get({ rules: [] }, function (data) { setStored(data && data.rules); });
      chromeApi.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.rules) setStored(changes.rules.newValue);
      });
      chromeApi.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'ftp:status') sendResponse(status());
        else if (msg.type === 'ftp:apply') sendResponse(apply(msg.rule));
        else if (msg.type === 'ftp:undo') sendResponse(undo());
        else if (msg.type === 'ftp:resume') { E.paused = false; refresh(); sendResponse(status()); }
      });
    } catch (e) { /* the extension was reloaded under this page; nothing to do */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
