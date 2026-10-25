/* Fix the Page: playground.js
 *
 * The page where a fix is prototyped. The script never touches this page or the tab directly: it runs in
 * the sandbox iframe (an opaque origin with no network), and the only thing it can do is call a capability,
 * which arrives here as a message. This page is the gate: it checks every call against the Script Behaviour
 * Policy, forwards the allowed ones to the engine on the tab, and refuses the rest in writing. The engine
 * checks the arguments again and records every effect so a run can be undone.
 */
(function () {
  'use strict';
  const core = window.FixThePageCore;
  const sbp = window.FixThePageSBP;
  const $ = (id) => document.getElementById(id);
  const el = {
    restricted: $('restricted'), restrictedWhy: $('restricted-why'), page: $('page'), pageTitle: $('page-title'), pageUrl: $('page-url'),
    name: $('name'), match: $('match'), script: $('script'), example: $('example'), caps: $('caps'), limitCalls: $('limit-calls'), limitMs: $('limit-ms'),
    lint: $('lint'), run: $('run'), undo: $('undo'), undoAll: $('undo-all'), save: $('save'), newBtn: $('new'), message: $('message'), log: $('log'),
    experiments: $('experiments'), experimentsEmpty: $('experiments-empty'), sideMessage: $('side-message'), exportBtn: $('export'), importFile: $('import-file'),
    policyJson: $('policy-json'), copy: $('copy'), sandbox: $('sandbox'), tpl: $('experiment-row'), openInTab: $('open-in-tab')
  };

  const EXAMPLES = [
    { name: 'Set the title', match: '*://*/*', caps: ['title.set'], script: "await page.title.set('Ops dashboard');" },
    { name: 'Prefix the title with the host', match: '*://*/*', caps: ['title.get', 'url.get', 'title.set'], script: "const title = await page.title.get();\nconst url = await page.url.get();\nconst host = url.split('/')[2];\nawait page.title.set('[' + host + '] ' + title);" },
    { name: 'Hide sticky and fixed bars (generic, best effort)', match: '*://*/*', caps: ['dom.count', 'css.add'], script: "// A guess, as any generic fix is. The site-specific version names the element.\nlog('fixed or sticky elements seen by CSS only; hiding them with a stylesheet');\nawait page.css.add('[style*=\"position: fixed\"], [style*=\"position:fixed\"], [class*=\"sticky\"], [class*=\"cookie\"], [id*=\"cookie\"] { display: none !important; }');" },
    { name: 'Hide one element (site-specific)', match: 'https://example.com/*', caps: ['dom.count', 'dom.hide'], script: "const n = await page.dom.count('#cookie-banner');\nlog('matches:', n);\nif (n) await page.dom.hide('#cookie-banner');" },
    { name: 'Bigger text (the newsroom fix, generically)', match: '*://*/*', caps: ['css.add'], script: "await page.css.add('html { font-size: 125% !important; }');" },
    { name: 'Rename a heading', match: 'https://example.com/*', caps: ['dom.text', 'dom.setText'], script: "const was = await page.dom.text('h1');\nlog('h1 was:', was);\nawait page.dom.setText('h1', 'A better heading');" },
    { name: 'Read before you change (count, text, title)', match: '*://*/*', caps: ['title.get', 'dom.count', 'dom.text'], script: "log('title:', await page.title.get());\nlog('headings:', await page.dom.count('h1, h2, h3'));\nlog('first paragraph:', await page.dom.text('p'));" }
  ];

  let tab = null;
  let panelMode = false;     // no ?tabId: this is the side panel, and it follows the active tab
  let currentId = null;      // the saved experiment being edited, or null
  let run = null;            // { runId, tabId, started }
  let sandboxReady = false;
  let runCounter = 0;
  const runTabs = {};        // runId -> tabId, so Undo reaches the tab the run was on

  function say(target, text, isError) { target.textContent = text || ''; target.classList.toggle('err', !!isError); }
  function logLine(text, cls) {
    const li = document.createElement('li');
    li.textContent = text; if (cls) li.className = cls;
    el.log.appendChild(li);
  }

  /* ---------------------------------------------------------- the form */

  function buildCaps() {
    el.caps.textContent = '';
    for (const [name, spec] of Object.entries(sbp.CAPABILITIES)) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = name; input.className = 'cap';
      const text = document.createElement('span');
      const code = document.createElement('code'); code.textContent = 'page.' + name.replace('.', '.') ;
      const kind = document.createElement('span'); kind.className = 'kind kind-' + spec.kind; kind.textContent = spec.kind;
      text.append(code, kind, document.createTextNode(' ' + spec.desc));
      label.append(input, text);
      el.caps.appendChild(label);
      input.addEventListener('change', refreshLint);
    }
  }

  function policyFromForm() {
    const caps = [...el.caps.querySelectorAll('input.cap:checked')].map((i) => i.value);
    return sbp.validatePolicy({ policy: sbp.POLICY_FORMAT, version: sbp.POLICY_VERSION, capabilities: caps,
      limits: { calls: Number(el.limitCalls.value) || sbp.LIMITS_DEFAULT.calls, ms: Number(el.limitMs.value) || sbp.LIMITS_DEFAULT.ms } });
  }

  function experimentFromForm() {
    const p = policyFromForm();
    return {
      id: currentId || sbp.newId(),
      name: el.name.value.trim() || 'Untitled',
      match: el.match.value.trim() || '*://*/*',
      policy: p.ok ? p.policy : sbp.emptyPolicy(),
      script: el.script.value,
      created: undefined, updated: new Date().toISOString()
    };
  }

  function fillForm(x) {
    currentId = x.id || null;
    el.name.value = x.name || '';
    el.match.value = x.match || '';
    el.script.value = x.script || '';
    for (const i of el.caps.querySelectorAll('input.cap')) i.checked = (x.policy && x.policy.capabilities || []).includes(i.value);
    el.limitCalls.value = (x.policy && x.policy.limits && x.policy.limits.calls) || sbp.LIMITS_DEFAULT.calls;
    el.limitMs.value = (x.policy && x.policy.limits && x.policy.limits.ms) || sbp.LIMITS_DEFAULT.ms;
    refreshLint();
  }

  function refreshLint() {
    const p = policyFromForm();
    const policy = p.ok ? p.policy : null;
    const lint = sbp.lintScript(el.script.value, policy);
    el.lint.textContent = '';
    el.lint.className = 'lint ' + (lint.ok && p.ok ? 'ok' : 'bad');
    const head = document.createElement('div');
    const ul = document.createElement('ul');
    const add = (t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); };
    if (!p.ok) p.errors.forEach((e) => add('policy: ' + e));
    lint.errors.forEach(add);
    if (lint.missing.length) add('the script calls ' + lint.missing.join(', ') + ' but the policy does not grant it: tick it, or take the call out');
    if (lint.unused.length) add('the policy grants ' + lint.unused.join(', ') + ' and the script never uses it: untick it, so the policy is as tight as the script');
    lint.banned.forEach((b) => add('line ' + b.line + ': "' + b.token + '" has no place in a fix; it does not exist in the sandbox'));
    head.textContent = lint.ok && p.ok
      ? 'Static review: the script asks for ' + (lint.calls.length ? lint.calls.join(', ') : 'nothing') + ', and the policy grants exactly that.'
      : 'Static review: not ready to run.';
    el.lint.append(head);
    if (ul.children.length) el.lint.append(ul);
    el.run.disabled = !(lint.ok && p.ok && tab);
    el.policyJson.textContent = JSON.stringify(policy || p, null, 2);
    const m = core.parseMatchPattern(el.match.value.trim());
    el.match.setCustomValidity(m || !el.match.value.trim() ? '' : 'Not a Chrome match pattern');
  }

  /* ---------------------------------------------------------- the run */

  function sendToTab(msg, tabId) {
    return new Promise((resolve) => {
      const id = tabId || (tab && tab.id);
      if (!id) return resolve({ ok: false, error: 'no tab' });
      chrome.tabs.sendMessage(id, msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false, error: 'no answer from the page' });
      });
    });
  }

  async function ensureEngine() {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js'] });
      return true;
    } catch (e) { say(el.message, 'Cannot reach the tab: ' + (e.message || e) + '. Click the Fix the Page icon on that page and press "Open the playground" again; the click is what lets the extension see the tab.', true); return false; }
  }

  async function startRun() {
    say(el.message, '');
    const p = policyFromForm();
    const lint = sbp.lintScript(el.script.value, p.ok ? p.policy : null);
    if (!p.ok || !lint.ok) { say(el.message, 'Not run: the static review is not clean.', true); return; }
    if (!tab) { say(el.message, 'Not run: no tab to work on.', true); return; }
    if (!sandboxReady) { say(el.message, 'The sandbox is not ready yet; try again in a moment.', true); return; }
    if (run) { el.sandbox.contentWindow.postMessage({ type: 'sbp:stop' }, '*'); }
    if (!(await ensureEngine())) return;
    const runId = 'r' + (++runCounter) + '-' + Date.now().toString(36);
    run = { runId, tabId: tab.id, policy: p.policy, calls: 0, refused: 0, started: Date.now() };
    runTabs[runId] = tab.id;
    el.log.textContent = '';
    logLine('run ' + runId + ' under policy [' + p.policy.capabilities.join(', ') + '] on ' + tab.url, 'note');
    el.sandbox.contentWindow.postMessage({ type: 'sbp:run', runId, script: el.script.value, capabilities: p.policy.capabilities, limits: p.policy.limits }, '*');
  }

  async function onCapMessage(msg) {
    if (!run || msg.runId !== run.runId) return reply(msg, { ok: false, error: 'no such run' });
    const call = { name: msg.name, args: msg.args };
    const check = sbp.checkCall(run.policy, call);
    if (!check.ok) {
      run.refused++;
      logLine('refused ' + describeCall(call) + ': ' + check.reason, 'refused');
      return reply(msg, { ok: false, error: 'refused by the policy: ' + check.reason });
    }
    if (++run.calls > run.policy.limits.calls) {
      logLine('refused ' + describeCall(call) + ': more than ' + run.policy.limits.calls + ' calls', 'refused');
      return reply(msg, { ok: false, error: 'refused: too many calls' });
    }
    const res = await sendToTab({ type: 'ftp:cap', runId: run.runId, name: call.name, args: call.args }, run.tabId);
    if (res && res.ok) {
      logLine(describeCall(call) + ' → ' + JSON.stringify(res.value), 'ok');
      reply(msg, { ok: true, value: res.value });
    } else {
      logLine('failed ' + describeCall(call) + ': ' + (res && res.error), 'refused');
      reply(msg, { ok: false, error: (res && res.error) || 'failed' });
    }
  }
  function describeCall(call) { return 'page.' + call.name + '(' + (call.args || []).map((a) => JSON.stringify(String(a).slice(0, 60))).join(', ') + ')'; }
  function reply(msg, result) { el.sandbox.contentWindow.postMessage({ type: 'sbp:cap-result', id: msg.id, ok: result.ok, value: result.value, error: result.error }, '*'); }

  async function onDone(msg) {
    if (!run || msg.runId !== run.runId) return;
    const r = run; run = null;
    const ms = Date.now() - r.started;
    if (msg.ok) {
      logLine('done in ' + ms + ' ms: ' + r.calls + ' call(s) applied, ' + r.refused + ' refused' + (msg.value !== null ? ', returned ' + msg.value : ''), 'note');
      say(el.message, 'Run ' + r.runId + ' finished. Undo reverses it.');
    } else {
      logLine('ended with an error after ' + ms + ' ms: ' + msg.error + ' (' + r.calls + ' call(s) applied, ' + r.refused + ' refused)', 'refused');
      say(el.message, 'The script stopped: ' + msg.error, true);
    }
    const eff = await sendToTab({ type: 'ftp:cap-effects', runId: r.runId }, r.tabId);
    if (eff && eff.ok) (eff.effects || []).forEach((e) => logLine('effect: ' + JSON.stringify(e), 'note'));
    el.undo.dataset.runId = r.runId;
  }

  window.addEventListener('message', (ev) => {
    // Only the sandbox may speak here, and only through these three message types.
    if (ev.source !== el.sandbox.contentWindow) return;
    const msg = ev.data;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'sbp:ready') { sandboxReady = true; return; }
    if (msg.type === 'sbp:cap') { onCapMessage(msg); return; }
    if (msg.type === 'sbp:log') { logLine('log: ' + (msg.args || []).join(' ')); return; }
    if (msg.type === 'sbp:done') { onDone(msg); }
  });

  /* ---------------------------------------------------------- storage */

  async function loadExperiments() {
    const d = await chrome.storage.local.get({ experiments: [] });
    return (Array.isArray(d.experiments) ? d.experiments : []).filter((x) => sbp.validateExperiment(x).ok);
  }
  async function saveExperiments(list) { await chrome.storage.local.set({ experiments: list }); }

  async function renderExperiments() {
    const list = await loadExperiments();
    el.experiments.textContent = '';
    el.experimentsEmpty.hidden = list.length > 0;
    for (const x of list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))) {
      const node = el.tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = x.id;
      node.querySelector('.x-name').textContent = x.name;
      const generic = /^\*:\/\/\*\/|^https?:\/\/\*\//.test(x.match);
      node.querySelector('.x-scope').textContent = generic ? 'generic' : 'site-specific';
      node.querySelector('.x-match').textContent = x.match;
      node.querySelector('.x-caps').textContent = 'may: ' + (x.policy.capabilities.join(', ') || 'nothing');
      node.querySelector('.x-load').addEventListener('click', () => { fillForm(x); say(el.message, 'Opened "' + x.name + '".'); });
      node.querySelector('.x-delete').addEventListener('click', async () => {
        if (!confirm('Delete "' + x.name + '"?')) return;
        await saveExperiments((await loadExperiments()).filter((y) => y.id !== x.id));
        if (currentId === x.id) currentId = null;
        await renderExperiments();
        say(el.sideMessage, 'Deleted.');
      });
      el.experiments.appendChild(node);
    }
  }

  el.save.addEventListener('click', async () => {
    const x = experimentFromForm();
    const list = await loadExperiments();
    const existing = list.find((y) => y.id === x.id);
    if (existing) x.created = existing.created;
    const v = sbp.validateExperiment(x);
    if (!v.ok) { say(el.message, 'Not saved: ' + v.errors.join('; '), true); return; }
    const next = existing ? list.map((y) => (y.id === x.id ? v.experiment : y)) : list.concat([v.experiment]);
    await saveExperiments(next);
    currentId = v.experiment.id;
    await renderExperiments();
    say(el.message, 'Saved "' + v.experiment.name + '".');
  });

  el.newBtn.addEventListener('click', () => { fillForm({ match: tab ? core.patternForUrl(tab.url) || '*://*/*' : '*://*/*', policy: sbp.emptyPolicy() }); el.log.textContent = ''; say(el.message, ''); });

  el.exportBtn.addEventListener('click', async () => {
    const list = await loadExperiments();
    const file = sbp.exportExperiments(list);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'fix-the-page-experiments-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(el.sideMessage, 'Exported ' + list.length + ' experiment(s).');
  });

  el.importFile.addEventListener('change', async () => {
    const f = el.importFile.files && el.importFile.files[0];
    el.importFile.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { say(el.sideMessage, 'That file is larger than 2 MB. Not imported.', true); return; }
    const v = sbp.validateExperimentsFile(await f.text());
    if (!v.ok) { say(el.sideMessage, 'Not imported: ' + v.errors.slice(0, 5).join('; ') + (v.errors.length > 5 ? '; and more' : ''), true); return; }
    const byId = new Map((await loadExperiments()).map((x) => [x.id, x]));
    let added = 0, replaced = 0;
    for (const x of v.experiments) { if (byId.has(x.id)) replaced++; else added++; byId.set(x.id, x); }
    await saveExperiments([...byId.values()]);
    await renderExperiments();
    say(el.sideMessage, 'Imported ' + v.experiments.length + ': ' + added + ' new, ' + replaced + ' replaced. Nothing runs until you open it and press Run.');
  });

  el.copy.addEventListener('click', async () => {
    const v = sbp.validateExperiment(experimentFromForm());
    const text = JSON.stringify(v.ok ? v.experiment : experimentFromForm(), null, 2);
    try { await navigator.clipboard.writeText(text); say(el.sideMessage, 'Copied the experiment as JSON.'); }
    catch (e) { el.policyJson.textContent = text; say(el.sideMessage, 'Clipboard refused; the JSON is shown above.', true); }
  });

  el.undo.addEventListener('click', async () => {
    const id = el.undo.dataset.runId;
    if (!id) { say(el.message, 'Nothing to undo yet.'); return; }
    const r = await sendToTab({ type: 'ftp:cap-undo', runId: id }, runTabs[id]);
    say(el.message, r && r.ok ? 'Undid run ' + id + '.' : 'Could not undo: ' + (r && r.error), !(r && r.ok));
    logLine('undo ' + id, 'note');
  });
  el.undoAll.addEventListener('click', async () => {
    const r = await sendToTab({ type: 'ftp:cap-undo' });
    say(el.message, r && r.ok ? 'Undid every run on this tab.' : 'Could not undo: ' + (r && r.error), !(r && r.ok));
    logLine('undo every run', 'note');
  });
  el.run.addEventListener('click', startRun);

  for (const [i, ex] of EXAMPLES.entries()) { const o = document.createElement('option'); o.value = String(i); o.textContent = ex.name; el.example.appendChild(o); }
  el.example.addEventListener('change', () => {
    const ex = EXAMPLES[Number(el.example.value)];
    if (!ex) return;
    fillForm({ name: ex.name, match: ex.match === 'https://example.com/*' && tab ? (core.patternForUrl(tab.url) || ex.match) : ex.match, script: ex.script, policy: { capabilities: ex.caps, limits: sbp.LIMITS_DEFAULT } });
    currentId = null;
    el.example.value = '';
  });
  el.script.addEventListener('input', refreshLint);
  el.match.addEventListener('input', refreshLint);
  el.limitCalls.addEventListener('input', refreshLint);
  el.limitMs.addEventListener('input', refreshLint);

  // For the automated tests: run without a click, and read the log.
  window.ftpPlayground = { startRun, loadExperiments, fillForm, resolveTab, tab: () => tab, lint: () => el.lint.textContent, log: () => [...el.log.children].map((li) => li.textContent) };

  /* ---------------------------------------------------------- the tab */

  function showTab(why) {
    if (tab) {
      el.restricted.hidden = true;
      el.page.hidden = false;
      el.pageTitle.textContent = tab.title || '(no title)';
      el.pageUrl.textContent = tab.url;
    } else {
      el.page.hidden = true;
      el.restricted.hidden = false;
      el.restrictedWhy.textContent = why;
    }
    el.openInTab.hidden = !(panelMode && tab);
    refreshLint();
  }

  // Bound mode (?tabId=): one tab, chosen by the popup. Panel mode: whatever tab is active in this window,
  // as long as the extension may see it. It may see a tab after the icon was clicked on it (activeTab) or
  // on a site allowed with "Always on this site"; otherwise Chrome gives no URL, and the panel says so.
  async function resolveTab() {
    const params = new URLSearchParams(location.search);
    let t = null;
    try {
      if (params.has('tabId')) t = await chrome.tabs.get(Number(params.get('tabId')));
      else [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch (e) { t = null; }
    const visible = !!(t && t.url && /^https?:\/\//.test(t.url));
    const previous = tab && tab.id;
    tab = visible ? t : null;
    if (!visible) {
      showTab(params.has('tabId') ? 'That tab is gone, or Chrome does not allow extensions on it.'
        : t && t.url ? 'Chrome does not allow extensions on this page.'
        : 'Click the Fix the Page icon on the page you want to work on, then "Open the playground"; the click is what lets the extension see the tab. A site allowed with "Always on this site" is always visible.');
      return;
    }
    showTab();
    if (tab.id !== previous) {
      const suggested = core.patternForUrl(tab.url) || '*://*/*';
      if (!el.match.value.trim() || el.match.dataset.suggested === el.match.value.trim()) { el.match.value = suggested; refreshLint(); }
      el.match.dataset.suggested = suggested;
      if (previous) logLine('now working on ' + tab.url, 'note');
    }
  }

  /* ---------------------------------------------------------- start */

  async function init() {
    buildCaps();
    const params = new URLSearchParams(location.search);
    panelMode = !params.has('tabId');
    document.body.classList.toggle('panel', panelMode);
    el.openInTab.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (tab) chrome.tabs.create({ url: chrome.runtime.getURL('playground.html?tabId=' + tab.id) });
    });
    fillForm({ match: '', policy: sbp.emptyPolicy() });
    await resolveTab();
    if (panelMode) {
      chrome.tabs.onActivated.addListener(() => resolveTab());
      chrome.tabs.onUpdated.addListener((id, info, t) => { if (t && t.active && (info.status === 'complete' || info.url || info.title)) resolveTab(); });
      chrome.windows.onFocusChanged.addListener(() => resolveTab());
    }
    await renderExperiments();
  }
  init();
})();
