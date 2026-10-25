# Privacy

https://fix-the-page.chrome-extension.sgit.ai/privacy/ · [as HTML](index.html) · site v0.1.0

Nothing leaves your browser. The extension makes no network calls, sends no telemetry, has no account, and reads from a page only the URL and the title.

## No network calls

- The extension's pages run under a CSP with `connect-src 'none'`, enforced by the browser.
- The code contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource`; the validator checks on every build and the tests check the validator.
- No script or stylesheet is loaded from the web.

## No telemetry, no analytics, no account

The extension counts and reports nothing. This site is static, with no analytics script.

## What is stored, and where

| What | Where | Goes away by |
|---|---|---|
| Your rules (id, pattern, fix, text, mode, created, enabled) | `chrome.storage.local` in your Chrome profile | Deleting them on My rules, or removing the extension |
| Which sites have access | Chrome's record of the extension's permissions | Remove access on My rules or on Chrome's details page |
| One registered content script per granted site | Chrome's record | With the site's access |
| The build stamp | A file in the package | With the package |

Nothing is stored about the pages you visit.

## What it reads from a page

The URL, to match rules, and the title, to replace it or build on it. Never form fields, cookies or page text. The engine runs in Chrome's isolated world for content scripts. A tiny bridge, run in the page's world only when you open the popup there, records whether the site publishes a page API at `window.__tools.page` (name, version, fix names), nothing more.

## Export and import

Files you choose, through your browser's download and file picker. Import files are validated against the documented shape and refused whole if they do not match; nothing in them is executed.

## This website

Static pages on GitHub Pages; no cookies set by us, no analytics, no forms. GitHub keeps its own server logs under its privacy statement.

## Questions

Source: https://github.com/SGit-AI/SGit-AI__Website__Chrome-Extension__Fix-The-Page. Anything here that does not match the code is a bug in one or the other; the repository's issues are the place for it.
