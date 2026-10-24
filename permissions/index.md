# Permissions

https://fix-the-page.chrome-extensions.sgit.ai/permissions/ · [as HTML](index.html) · site v0.1.0

The manifest: `"permissions": ["activeTab", "scripting", "storage", "contextMenus"]`, `"optional_host_permissions": ["https://*/*", "http://*/*"]`, no `host_permissions`. The validator rejects anything else. Chrome's words below were fetched from developer.chrome.com on 24 October 2026.

## activeTab

Why: so that invoking the extension lets it change the tab you did it on, and no other.

Chrome ([the activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)): it "gives an extension temporary access to the currently active tab when the user invokes the extension". "Access to the tab lasts while the user is on that page, and is revoked when the user navigates away or closes the tab." Granting gestures: "Executing an action", "Executing a context menu item", "Executing a keyboard shortcut from the commands API", "Accepting a suggestion from the omnibox API". "The extension temporarily gets host permissions for the tab's main frame origin." It "displays no warning message during installation". "Access is not granted to restricted pages, such as chrome:// pages."

Cannot: touch a tab you did not invoke it on; keep access after you leave; reach a cross-origin frame; reach Chrome's pages.

## scripting

Why: to put `engine.js` on the page, on demand with `executeScript` or persistently with `registerContentScripts` for a granted origin.

Chrome ([chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)): "By default, an injection will run in the main frame of the specified tab." Files "are specified as strings that are paths relative to the extension's root directory". `persistAcrossSessions` "specifies if this content script will persist into future sessions. The default is true."

Cannot: reach any page by itself; inject anything but bundled files.

## storage

Why: to keep your rules in `chrome.storage.local` under one key.

Chrome ([chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)): `local` `QUOTA_BYTES` 10485760; `sync` about 100 KB total and 8 KB per item (not used).

Cannot: see any site's storage, cookies or data.

## contextMenus

Why: one right-click item, "Set this tab's title…", a second way in that also grants `activeTab`.

Cannot: read anything about the page.

## optional_host_permissions: https://*/* and http://*/*

Why: so "Always on this site" can ask for one origin at the moment you tick it. Optional means nothing is granted at install.

Chrome ([chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)): "If you want to request hosts that you only discover at runtime, include "https://*/*" in your extension's optional_host_permissions field." "Permissions must be requested from inside a user gesture, like a button's click handler." `permissions.remove()` "removes access to the specified permissions."

Cannot: be granted without your yes, for a specific site. Every granted origin is listed with a Remove button.

## Not asked for

`host_permissions` and `<all_urls>` (standing access); `tabs` (every tab's URL and title); `history`, `cookies`, `webRequest`, `debugger`; `userScripts` (Chrome: "Users must enable developer mode to execute anything"; a different product).

## The Content Security Policy

`script-src 'self'; object-src 'self'; connect-src 'none'`. Only bundled scripts run on the extension's pages, and they cannot open a connection to anything. Chrome's [remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) page defines it as "anything that is executed by the browser that is loaded from someplace other than the extension's own files"; this extension has none.
