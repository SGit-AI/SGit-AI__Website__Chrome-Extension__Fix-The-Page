/* Fix the Page: options.js
 * "My rules": every rule, grouped by origin, with edit, enable, disable and delete; every site with
 * standing access, with a Remove button; export and import as a JSON file. Rules live in
 * chrome.storage.local under "rules". Nothing here talks to the network.
 */
(function () {
  'use strict';
  const core = window.FixThePageCore;
  const $ = (id) => document.getElementById(id);
  const el = {
    rules: $('rules'), rulesEmpty: $('rules-empty'), rulesMessage: $('rules-message'),
    sites: $('sites'), sitesEmpty: $('sites-empty'), sitesMessage: $('sites-message'),
    exportBtn: $('export'), importFile: $('import-file'), tpl: $('rule-row')
  };

  function say(target, text, isError) {
    target.textContent = text || '';
    target.classList.toggle('err', !!isError);
  }

  async function loadRules() {
    const data = await chrome.storage.local.get({ rules: [] });
    return Array.isArray(data.rules) ? data.rules : [];
  }
  async function saveRules(rules) { await chrome.storage.local.set({ rules }); }

  function groupKey(rule) {
    return core.originOfPattern(rule.match) || rule.match;
  }

  function modeLabel(mode) {
    return { set: 'set', prefix: 'prefix', suffix: 'suffix', template: 'template' }[mode] || mode;
  }

  function renderRules(rules) {
    el.rules.textContent = '';
    el.rulesEmpty.hidden = rules.length > 0;
    const groups = new Map();
    for (const r of rules) {
      const k = groupKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [origin, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const h = document.createElement('h3');
      h.textContent = origin;
      el.rules.appendChild(h);
      for (const r of list.sort((a, b) => String(a.created).localeCompare(String(b.created)))) el.rules.appendChild(ruleRow(r));
    }
  }

  function ruleRow(rule) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = rule.id;
    node.classList.toggle('disabled', rule.enabled === false);
    node.querySelector('.rule-value').textContent = rule.value === '' ? '(empty)' : rule.value;
    node.querySelector('.rule-mode').textContent = modeLabel(rule.mode);
    node.querySelector('.rule-match').textContent = rule.match;
    const enabled = node.querySelector('.rule-enabled');
    enabled.checked = rule.enabled !== false;
    enabled.setAttribute('aria-label', 'Enable rule ' + rule.id);
    enabled.addEventListener('change', async () => {
      await updateRule(rule.id, { enabled: enabled.checked });
      say(el.rulesMessage, enabled.checked ? 'Rule enabled.' : 'Rule disabled. Pages that had it get their own title back.');
    });
    node.querySelector('.rule-delete').addEventListener('click', async () => {
      if (!confirm('Delete this rule?\n\n' + rule.mode + ': ' + rule.value + '\non ' + rule.match)) return;
      const rules = (await loadRules()).filter((r) => r.id !== rule.id);
      await saveRules(rules);
      await refresh();
      say(el.rulesMessage, 'Rule deleted.');
    });
    const view = node.querySelector('.rule-view'), form = node.querySelector('.rule-form');
    node.querySelector('.rule-edit').addEventListener('click', () => {
      form.elements.value.value = rule.value;
      form.elements.mode.value = rule.mode;
      form.elements.match.value = rule.match;
      view.hidden = true; form.hidden = false;
      form.elements.value.focus();
    });
    node.querySelector('.rule-cancel').addEventListener('click', () => { form.hidden = true; view.hidden = false; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const candidate = { ...rule, value: form.elements.value.value, mode: form.elements.mode.value, match: form.elements.match.value.trim() };
      const v = core.validateRule(candidate);
      const err = form.querySelector('.form-error');
      if (!v.ok) { err.textContent = v.errors.join('. '); return; }
      if (v.broad && !confirm('This pattern covers more than one site:\n' + v.rule.match + '\n\nIt only runs where you have granted access. Save anyway?')) return;
      err.textContent = '';
      await updateRule(rule.id, v.rule);
      say(el.rulesMessage, 'Rule saved.');
    });
    return node;
  }

  async function updateRule(id, patch) {
    const rules = await loadRules();
    const i = rules.findIndex((r) => r.id === id);
    if (i === -1) return;
    rules[i] = { ...rules[i], ...patch };
    await saveRules(rules);
    await refresh();
  }

  async function renderSites(rules) {
    const res = await chrome.runtime.sendMessage({ type: 'ftp:sites' });
    const sites = Array.isArray(res) ? res : [];
    el.sites.textContent = '';
    el.sitesEmpty.hidden = sites.length > 0;
    for (const s of sites.sort((a, b) => a.origin.localeCompare(b.origin))) {
      const li = document.createElement('li');
      const code = document.createElement('code'); code.textContent = s.origin;
      const n = rules.filter((r) => core.matchPattern(s.origin.replace('/*', '/'), r.match) || groupKey(r) === s.origin).length;
      const count = document.createElement('span'); count.className = 'count';
      count.textContent = n === 1 ? '1 rule' : n + ' rules';
      if (!s.registered) count.textContent += ' · engine not registered';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'danger'; btn.textContent = 'Remove access';
      btn.setAttribute('aria-label', 'Remove access for ' + s.origin);
      btn.addEventListener('click', async () => {
        const r = await chrome.runtime.sendMessage({ type: 'ftp:remove-site', origin: s.origin });
        if (!r || !r.ok) { say(el.sitesMessage, 'Could not remove access: ' + (r && r.error), true); return; }
        if (n > 0 && confirm('Access to ' + s.origin + ' removed.\n\nAlso delete its ' + (n === 1 ? 'rule' : n + ' rules') + '?')) {
          const rules = (await loadRules()).filter((x) => groupKey(x) !== s.origin);
          await saveRules(rules);
        }
        await refresh();
        say(el.sitesMessage, 'Access removed for ' + s.origin + '.');
      });
      li.append(code, count, btn);
      el.sites.appendChild(li);
    }
  }

  el.exportBtn.addEventListener('click', async () => {
    const rules = await loadRules();
    const file = core.exportRules(rules);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fix-the-page-rules-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(el.rulesMessage, 'Exported ' + rules.length + (rules.length === 1 ? ' rule.' : ' rules.'));
  });

  el.importFile.addEventListener('change', async () => {
    const f = el.importFile.files && el.importFile.files[0];
    el.importFile.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { say(el.rulesMessage, 'That file is larger than 2 MB. Not imported.', true); return; }
    const text = await f.text();
    const v = core.validateImport(text);
    if (!v.ok) { say(el.rulesMessage, 'Not imported: ' + v.errors.slice(0, 5).join('; ') + (v.errors.length > 5 ? '; and more' : ''), true); return; }
    const existing = await loadRules();
    const byId = new Map(existing.map((r) => [r.id, r]));
    let added = 0, replaced = 0;
    for (const r of v.rules) { if (byId.has(r.id)) replaced++; else added++; byId.set(r.id, r); }
    await saveRules([...byId.values()]);
    await refresh();
    say(el.rulesMessage, 'Imported ' + v.rules.length + ' rules: ' + added + ' new, ' + replaced + ' replaced. Sites still need access before a rule runs without a click.');
  });

  async function refresh() {
    const rules = await loadRules();
    renderRules(rules);
    await renderSites(rules);
  }

  function showBuild() {
    const m = chrome.runtime.getManifest();
    const b = window.FTP_BUILD || {};
    $('b-version').textContent = 'v' + m.version + (b.version && b.version !== m.version ? ' (build.js says ' + b.version + ')' : '') + (b.test ? ' TEST BUILD' : '');
    $('b-commit').textContent = b.commit ? b.commit.slice(0, 12) : 'not stamped (loaded from source)';
    $('b-time').textContent = b.built_at || 'not stamped';
    chrome.commands.getAll().then((cmds) => {
      const c = cmds.find((x) => x.name === '_execute_action');
      $('b-shortcut').textContent = c && c.shortcut ? c.shortcut : 'none set (chrome://extensions/shortcuts)';
    }).catch(() => { $('b-shortcut').textContent = 'unknown'; });
  }

  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.rules) refresh(); });
  chrome.permissions.onAdded.addListener(() => refresh());
  chrome.permissions.onRemoved.addListener(() => refresh());

  // Playwright reaches in here to drive import without a file picker.
  window.ftpOptions = { refresh, importText: async (text) => { const v = core.validateImport(text); return v; } };

  showBuild();
  refresh();
})();
