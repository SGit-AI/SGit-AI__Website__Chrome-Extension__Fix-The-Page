# Fix the Page

A Chrome extension that fixes the page you are on, only when you ask, and can say exactly what it changed. One generic extension, built on `activeTab`: the tab's title as a rule, and a playground where your own fixes run as scripts under a Script Behaviour Policy, in a sandbox, with undo. No network calls, no telemetry.

Site: https://fix-the-page.chrome-extensions.sgit.ai (GitHub Pages, deployed from `dev`). A child of the hub [chrome-extensions.sgit.ai](https://chrome-extensions.sgit.ai); the idea is the newsroom's [Fix the page yourself](https://newsroom.sgit.ai/articles/fix-the-page-yourself.html).

## The one rule

> The extension touches a page only because the user asked it to, on that page, and it can say exactly what it changed.

So: `activeTab` instead of host permissions; fixes as declarative rules, not code; per-site opt-in for persistence; a visible list of every rule and every site with access, each with a remove button; no network calls from the extension.

## Install, from this clone

1. `chrome://extensions`
2. Developer mode on
3. Load unpacked, and pick the `extension/` folder

Then click the icon on any page, type a title, Apply. Tick "Always on this site" to keep it; Chrome asks for that one site. **Playground** in the popup opens the editor for your own fixes: a script, a policy of what it may do, run, undo, save, export. The [install page](https://fix-the-page.chrome-extensions.sgit.ai/install/) has the zip route and screenshots; [the playground page](https://fix-the-page.chrome-extensions.sgit.ai/use/playground/) and the article [Script Behaviour Policies](https://fix-the-page.chrome-extensions.sgit.ai/articles/script-behaviour-policies/) explain the rest.

## Structure

```
extension/           the extension: manifest.json, engine.js, bridge.js, service-worker.js, popup.*, options.*, playground.*, sandbox.*, sbp.js, build.json, icons/
releases/            fix-the-page-vX.Y.Z.zip and .sha256, one per release
tests/               engine unit tests (Node), engine-in-a-page and extension-in-Chromium tests (Playwright), fixtures, run.mjs
admin/build/         version.txt (owns the version) · validate.js (the gate) · package.mjs (the zip) · icons.mjs · screenshots.mjs · zip.js
admin/               versions.html · debriefs/ (one per working session) · index.html (how this site is built)
install/ use/ articles/ permissions/ privacy/ source/   the site, each page with a .md twin
admin/plans/         plans, starting with the split of the extension from the site
assets/              site.css (the sgit.ai design language, from the hub) · version.js · favicon.svg
.github/workflows/   deploy-pages.yml: validate → test → tag → deploy on every push to dev
```

## Develop

```
npm test                          # tests/run.mjs: builds the test extension, runs every test file, fails if one is not run
node admin/build/package.mjs      # stamps build.json, builds releases/fix-the-page-vX.Y.Z.zip and its .sha256, re-points the pages
node admin/build/validate.js      # the pre-release gate
node admin/build/screenshots.mjs  # the install page's screenshots, from the test build
```

Needs Node 22 and Playwright with Chromium (`npm install --no-save playwright && npx playwright install chromium`). The test build (`package.mjs --test`) lists `http://127.0.0.1/*` in `host_permissions` so tests can cover persistent rules without clicking Chrome's prompt; it is never shipped, and the validator refuses a release zip that carries it.

## Release

1. `git pull --ff-only origin dev`
2. Bump `admin/build/version.txt` once; set `extension/manifest.json` and `package.json` to match.
3. `node admin/build/package.mjs`
4. `npm test`
5. `node admin/build/validate.js`
6. Add a row to `admin/versions.html`; write `admin/debriefs/YYYY-MM-DD.md`.
7. `git commit -am "site vX.Y.Z: what changed"` and `git push origin dev`

Every push to `dev` runs the workflow: validate, test, auto-tag `vX.Y.Z` (verified against version.txt and the commit subject, next minor enforced), deploy. The site's version and the extension's version are the same number.

## Agent Behaviour Policy, in short

This repository is maintained by a dedicated Claude Code session under the policy in its briefing pack: `activeTab` is the only standing access; no remotely hosted code; no network calls from the extension; the page's own data stays in the page; never commit a secret; version everything; never push a red build; research before writing, citing Chrome's documentation; British English, no em-dashes; contact nobody. Dinis Cruz is the editor and owner.

## What needs a human

DNS (a CNAME for `fix-the-page.chrome-extensions` to GitHub Pages), enabling Pages and allowing `dev` in the `github-pages` environment, and anything to do with the Chrome Web Store.

Code Apache 2.0 (see LICENSE); site content CC BY 4.0.
