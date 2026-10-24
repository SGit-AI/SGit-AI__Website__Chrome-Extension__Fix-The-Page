/* Fix the Page: bridge.js
 * Runs in the page's main world, for one purpose: to see whether the site publishes the newsroom-style
 * page API at window.__tools.page, and to leave its name, version and fix names on a data attribute
 * that the engine (isolated world) can read. It takes nothing in and calls nothing but list().
 */
(function () {
  'use strict';
  try {
    var t = window.__tools && window.__tools.page;
    if (!t || !t.meta) return;
    var fixes = [];
    try { fixes = (t.list() || []).map(function (f) { return String(f.name); }); } catch (e) { fixes = []; }
    document.documentElement.setAttribute('data-fix-the-page-site-api', JSON.stringify({
      name: String(t.meta.name || ''), version: String(t.meta.version || ''), fixes: fixes
    }));
  } catch (e) { /* a page with no API, or one that refuses to be asked */ }
})();
