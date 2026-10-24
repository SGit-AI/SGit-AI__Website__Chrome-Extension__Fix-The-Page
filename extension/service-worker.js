/* Fix the Page: service-worker.js
 *
 * The background half. It does three small jobs and nothing else:
 *   keep the registered content scripts in step with the origins the user has granted;
 *   answer the popup and the options page (register an origin, remove a site's access);
 *   put "Set this tab's title" on the page's context menu, which is one of the gestures that grants
 *   activeTab.
 * It makes no network calls and never reads a page.
 */

const SCRIPT_PREFIX = 'ftp:';
const MENU_ID = 'ftp-set-title';

function scriptIdFor(originPattern) { return SCRIPT_PREFIX + originPattern; }

async function grantedOrigins() {
  const all = await chrome.permissions.getAll();
  return (all.origins || []).filter((o) => /^https?:\/\//.test(o));
}

// One registered content script per granted origin, no more and no fewer. Idempotent, so it runs at
// install, at startup and whenever permissions change.
async function reconcile() {
  const origins = await grantedOrigins();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const have = new Set(registered.map((s) => s.id));
  const want = new Set(origins.map(scriptIdFor));
  const toAdd = origins.filter((o) => !have.has(scriptIdFor(o)));
  const toRemove = registered.map((s) => s.id).filter((id) => id.startsWith(SCRIPT_PREFIX) && !want.has(id));
  if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  if (toAdd.length) {
    await chrome.scripting.registerContentScripts(toAdd.map((o) => ({
      id: scriptIdFor(o),
      matches: [o],
      js: ['engine.js'],
      runAt: 'document_start',
      persistAcrossSessions: true,
      world: 'ISOLATED'
    })));
  }
  return { origins, added: toAdd, removed: toRemove };
}

// Called by the popup after chrome.permissions.request succeeded for this origin pattern.
async function registerOrigin(originPattern) {
  const ok = await chrome.permissions.contains({ origins: [originPattern] });
  if (!ok) return { ok: false, error: 'Chrome has not granted ' + originPattern };
  await reconcile();
  return { ok: true };
}

// Remove a site's access: give the permission back, unregister its engine. Rules are the options page's
// business; it asks the user before deleting them. permissions.remove refuses a required permission,
// which only happens in the test build, so a refusal is not an error here.
async function removeSite(originPattern) {
  try { await chrome.permissions.remove({ origins: [originPattern] }); } catch (e) { /* see above */ }
  const id = scriptIdFor(originPattern);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  return { ok: true };
}

async function sites() {
  const origins = await grantedOrigins();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = new Set(registered.map((s) => s.id));
  return origins.map((o) => ({ origin: o, registered: ids.has(scriptIdFor(o)) }));
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: MENU_ID, title: "Set this tab's title…", contexts: ['page'] });
  } catch (e) { /* context menus unavailable */ }
  await reconcile();
});

chrome.runtime.onStartup.addListener(() => { reconcile(); });
chrome.permissions.onAdded.addListener(() => { reconcile(); });
chrome.permissions.onRemoved.addListener(() => { reconcile(); });

// The context menu item is a user gesture that grants activeTab for this tab. Put the engine on the
// page (it applies any stored rules that match), then open the popup for the user to type a title.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['engine.js'] }); } catch (e) { /* restricted page */ }
  try { await chrome.action.openPopup({ windowId: tab.windowId }); } catch (e) { /* older Chrome: the toolbar icon is the way in */ }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  const reply = (p) => p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  switch (msg.type) {
    case 'ftp:register-origin': reply(registerOrigin(String(msg.origin))); return true;
    case 'ftp:remove-site': reply(removeSite(String(msg.origin))); return true;
    case 'ftp:sites': reply(sites()); return true;
    case 'ftp:reconcile': reply(reconcile()); return true;
    default: return false;
  }
});

// For the Playwright tests, which reach the worker through context.serviceWorkers().
globalThis.ftp = { reconcile, registerOrigin, removeSite, sites, grantedOrigins };
