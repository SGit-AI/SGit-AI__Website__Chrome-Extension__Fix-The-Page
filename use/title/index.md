# The title fix

https://fix-the-page.chrome-extension.sgit.ai/use/title/ · [as HTML](index.html) · site v0.1.0 · status: built

Make a tab's title say what you want, in one of four ways, on this page now or on every page of a site, with a visible list of what you did and one click to undo it.

## Four modes

| Mode | What it does | You type | On a page titled "Inbox (3)" |
|---|---|---|---|
| `set` | Replace the title | `Work mail` | Work mail |
| `prefix` | Add your text before the page's title | `[A] ` | [A] Inbox (3) |
| `suffix` | Add your text after it | ` · work` | Inbox (3) · work |
| `template` | Your text with `{title}`, `{host}` and `{path}` filled in | `[PROD] {title}` | [PROD] Inbox (3) |

In every mode but `set`, the fix follows the page's later titles.

## On this page, now

Click the icon (or Alt+Shift+T, or "Set this tab's title…" on the right-click menu), type, Apply. Immediate; stays while you are on the page, even on a single-page app that rewrites its title; gone when you leave or reload. Uses `activeTab`, which Chrome says "temporarily gets host permissions for the tab's main frame origin", so a cross-origin frame is out of reach.

## On every page of a site

Tick "Always on this site" before Apply. Chrome shows its own prompt for that one site ("Permissions must be requested from inside a user gesture, like a button's click handler"). If you agree, the rule is saved and the engine is registered to run on that site at load, on every visit and across restarts. If you refuse, nothing is saved.

## Where a rule applies

A Chrome match pattern, `scheme://host/path`, with `*` for anything. Default: the whole site you are on.

| Pattern | Matches |
|---|---|
| `https://app.example.com/*` | Every page on that host |
| `https://app.example.com/dashboard/*` | Only pages under /dashboard/ |
| `https://app.example.com/*?tab=ops*` | Query strings starting with tab=ops |
| `https://*.example.com/*` | Every subdomain; wider than one site, so you confirm |
| `*://example.com/*` | http and https; also wider than one origin |

The pattern must match the page you are on, or the popup refuses it.

## Undo

"Undo on this page" gives the page its own title back and stops watching. Disabling or deleting a rule on the options page does the same on every open page that had it.

## My rules

Rules grouped by site, with edit, enable/disable and delete. Sites with access, each with Remove access, which gives the permission back to Chrome and unregisters the engine at once. Export to a JSON file; import such a file back, with any file that is not exactly the documented shape refused whole. The build's version, commit and time.

### The export format

```json
{
  "format": "fix-the-page/rules",
  "version": 1,
  "exported": "2026-10-24T20:40:00Z",
  "rules": [
    { "id": "r-2026-10-24-001", "match": "https://app.example.com/dashboard/*", "fix": "title",
      "value": "Ops dashboard", "mode": "set", "created": "2026-10-24T20:40:00Z", "enabled": true }
  ]
}
```

Exactly those seven fields per rule; `fix` is `title`; `value` at most 500 characters. Stored in `chrome.storage.local` (Chrome documents its quota as 10 MB).

## Pages it cannot touch

Chrome's own pages, the Chrome Web Store, non-http(s) pages. The popup says so. Chrome: "Access is not granted to restricted pages, such as chrome:// pages."

## Sites that publish a page API

The extension detects `window.__tools.page` (the newsroom's page-fixes API) and says so in the popup. Calling it is specified, not built.

## Not in this release

Other fixes; sync between machines (`storage.sync` is about 100 KB total, 8 KB per item, per Chrome's documentation); cross-origin frames; signed rules and packs; Firefox, Safari, the Web Store.
