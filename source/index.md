# Source and releases

https://fix-the-page.chrome-extensions.sgit.ai/source/ · [as HTML](index.html) · site v0.1.0

The whole extension is a dozen small files with no dependencies, and every release is a zip of exactly those files with its hash published here.

## The current release

- Version: v0.1.0
- File: [fix-the-page-v0.2.0.zip](../releases/fix-the-page-v0.2.0.zip) · [.sha256](../releases/fix-the-page-v0.2.0.zip.sha256)
- SHA-256: `402ff0e1c0626136a1e37933ec0cb3a298a775ccf65c79fca5a7310ebca287e0`

Check with `shasum -a 256 fix-the-page-v0.2.0.zip`. The validator refuses a release whose zip differs from `extension/` in any byte or whose hash file does not match.

## The extension, file by file

| File | What it does |
|---|---|
| `manifest.json` | Manifest V3: the four permissions, optional host permissions, CSP, popup, options page, shortcut |
| `engine.js` | The one script that touches a page. Pure core (match patterns, compute title, validate rule and import) plus the page part (apply, observe, undo). Idempotent. |
| `bridge.js` | Detects a site's `window.__tools.page` from the page's world |
| `service-worker.js` | Keeps registered content scripts in step with granted origins; answers the popup and options page; the context menu item |
| `popup.html/js/css` | The toolbar popup |
| `options.html/js/css` | "My rules" |
| `build.json`, `build.js` | The build stamp: version, commit, time |
| `icons/` | Three PNGs drawn by `admin/build/icons.mjs` |

## The repository

`extension/` the extension · `releases/` zips and hashes · `tests/` unit, in-page and in-Chromium tests with fixtures · `admin/build/` version.txt, validate.js, package.mjs, icons.mjs, screenshots.mjs, zip.js · `admin/` versions, debriefs, how the site is built · the site's pages, each with a `.md` twin · `.github/workflows/deploy-pages.yml`.

## The validator

`node admin/build/validate.js`: version agreement across site, manifest, build stamp and package; internal links; canonical URLs; key-leak tripwire; the manifest within the policy (no `host_permissions`, no banned permissions, only the four, optional hosts for http and https, no static content scripts, a CSP with no remote source and `connect-src 'none'`); the code within the policy (no `eval`, `new Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `sendBeacon`, string timers, `innerHTML`, inline scripts or remote URLs); the release (zip and hash present and matching, zip equals `extension/` byte for byte, not a test build, hash published here); every page links to the current release.

## The tests

`npm test` runs `tests/run.mjs`, which fails if a test file is not run. Engine unit tests (Node); engine-in-a-page tests (Playwright, fixtures: static, rewriter, SPA, replaced title element, site API); extension-in-Chromium tests (the test build loaded unpacked: persistent rules at load, access removal, the popup, the options page); validator tests. Three manual checks before releases that touch the popup, permissions or engine, recorded in `admin/debriefs/`. The test build lists `http://127.0.0.1/*` in `host_permissions` and is never shipped.

## Building it yourself

```
git clone https://github.com/SGit-AI/SGit-AI__Website__Chrome-Extension__Fix-The-Page.git
cd SGit-AI__Website__Chrome-Extension__Fix-The-Page
npm test
node admin/build/package.mjs
node admin/build/validate.js
```

## Licence and credits

Code Apache 2.0; content CC BY 4.0. Validator and stylesheet started from the hub's. Idea and first fix from the newsroom's [Fix the page yourself](https://newsroom.sgit.ai/articles/fix-the-page-yourself.html) by Dinis Cruz. Chrome facts quoted from Chrome's extension documentation.
