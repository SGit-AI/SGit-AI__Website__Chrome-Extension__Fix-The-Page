/* Fix the Page: popup.js
 * The toolbar popup. Clicking the icon is the gesture that grants activeTab for the current tab, so the
 * popup can put the engine on the page and ask it for the page's title. Nothing here reads the page
 * beyond its URL and title, and nothing leaves the browser.
 */
(function () {
  'use strict';
  const core = window.FixThePageCore;
  const $ = (id) => document.getElementById(id);
  const el = {
    restricted: $('restricted'), restrictedWhy: $('restricted-why'), error: $('error'), errorText: $('error-text'), main: $('main'),
    pageTitle: $('page-title'), pageUrl: $('page-url'), siteApi: $('site-api'), applied: $('applied'),
    form: $('form'), value: $('value'), mode: $('mode'), preview: $('preview'), match: $('match'), always: $('always'),
    apply: $('apply'), undo: $('undo'), message: $('message'), version: $('version'), rulesLink: $('rules-link'), playgroundLink: $('playground-link')
  };
  const manifest = chrome.runtime.getManifest();
  el.version.textContent = 'v' + manifest.version;

  let tab = null;
  let status = null;

  function say(text, isError) {
    el.message.textContent = text || '';
    el.message.classList.toggle('err', !!isError);
  }

  function isRestricted(url) {
    if (!url) return 'Chrome gives extensions no address for this tab, which is how it marks a page they may not touch.';
    if (!/^https?:\/\//.test(url)) return 'Only http and https pages can be changed. This one is ' + url.split(':')[0] + ':';
    if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)) return 'The Chrome Web Store is one of the pages Chrome protects from every extension.';
    return null;
  }

  function send(msg) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res);
      });
    });
  }

  function currentRule() {
    return {
      id: core.newId(),
      match: el.match.value.trim(),
      fix: 'title',
      value: el.value.value,
      mode: el.mode.value,
      created: new Date().toISOString(),
      enabled: true
    };
  }

  function preview() {
    const r = currentRule();
    const v = core.validateRule(r);
    el.preview.textContent = v.ok && status ? core.computeTitle(v.rule, status.pageTitle, status.url) : '';
    const p = core.parseMatchPattern(el.match.value.trim());
    el.match.setCustomValidity(p ? '' : 'Not a Chrome match pattern');
    if (p && status && !core.matchPattern(status.url, p)) el.match.setCustomValidity('This pattern does not match the page you are on');
  }

  function showStatus(s) {
    status = s;
    el.pageTitle.textContent = s.pageTitle || '(no title)';
    el.pageUrl.textContent = s.url;
    el.applied.hidden = !s.applied;
    if (s.siteApi) {
      el.siteApi.hidden = false;
      el.siteApi.textContent = 'This site publishes a page API (' + s.siteApi.name + ' ' + s.siteApi.version + ', ' + (s.siteApi.fixes || []).length + ' fixes).';
    } else el.siteApi.hidden = true;
    preview();
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    try {
      // ?tabId= is for the automated tests, which cannot click the toolbar icon. In the shipped build
      // the injection below fails without activeTab, and the popup says so.
      if (params.has('tabId')) tab = await chrome.tabs.get(Number(params.get('tabId')));
      else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) { tab = null; }
    const why = isRestricted(tab && tab.url);
    if (why) { el.restricted.hidden = false; el.restrictedWhy.textContent = why; return; }

    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'], world: 'MAIN' });
    } catch (e) {
      el.error.hidden = false;
      el.errorText.textContent = String(e && e.message || e);
      return;
    }
    const s = await send({ type: 'ftp:status' });
    if (!s || s.ok === false) { el.error.hidden = false; el.errorText.textContent = (s && s.error) || 'no answer from the page'; return; }
    el.main.hidden = false;
    showStatus(s);
    el.value.value = s.pageTitle || '';
    el.match.value = core.patternForUrl(s.url) || '';
    el.value.focus();
    el.value.select();
    preview();
  }

  el.value.addEventListener('input', preview);
  el.mode.addEventListener('change', preview);
  el.match.addEventListener('input', preview);
  el.rulesLink.addEventListener('click', (ev) => { ev.preventDefault(); chrome.runtime.openOptionsPage(); });
  // The playground opens for the tab the popup was invoked on; the activeTab grant for that tab is the
  // extension's, so the playground page can use it as long as the tab stays on this page.
  el.playgroundLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('playground.html' + (tab && tab.id ? '?tabId=' + tab.id : '')) });
  });

  el.form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    say('');
    const rule = currentRule();
    const v = core.validateRule(rule);
    if (!v.ok) { say(v.errors.join('. '), true); return; }
    if (!core.matchPattern(status.url, v.rule.match)) { say('That pattern does not match this page.', true); return; }
    if (el.always.checked) {
      if (v.broad && !confirm('This pattern covers more than one site:\n' + v.rule.match + '\n\nChrome will ask for access to all of them. Continue?')) return;
      const origin = v.broad ? v.rule.match : core.originOfPattern(v.rule.match);
      let granted = false;
      try { granted = await chrome.permissions.request({ origins: [origin] }); } catch (e) { say(String(e.message || e), true); return; }
      if (!granted) { say('Chrome did not grant access to ' + origin + '. Nothing was saved.', true); return; }
      const data = await chrome.storage.local.get({ rules: [] });
      const rules = (data.rules || []).concat([v.rule]);
      await chrome.storage.local.set({ rules });
      const reg = await chrome.runtime.sendMessage({ type: 'ftp:register-origin', origin });
      if (!reg || !reg.ok) { say('Saved the rule, but could not register it: ' + (reg && reg.error), true); return; }
      // The engine on this page sees the storage change and applies the rule itself.
      const s = await send({ type: 'ftp:resume' });
      if (s && s.ok !== false) showStatus(s);
      say('Saved. The title is fixed on ' + origin + ' from now on.');
    } else {
      const res = await send({ type: 'ftp:apply', rule: v.rule });
      if (!res || res.ok === false) { say((res && (res.error || (res.errors || []).join('. '))) || 'The page did not answer.', true); return; }
      showStatus(res.status);
      say('Applied on this page. It lasts until you leave or reload.');
    }
  });

  el.undo.addEventListener('click', async () => {
    const s = await send({ type: 'ftp:undo' });
    if (s && s.ok !== false) { showStatus(s); say('Undone. The page has its own title back.'); }
  });

  init();
})();
