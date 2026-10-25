# Fix the Page: fix the page you are on, only when you ask

Site and extension version v0.2.0 (25 October 2026). https://fix-the-page.chrome-extensions.sgit.ai/

One generic Chrome extension that can fix any kind of site, built on `activeTab`. It touches a tab only when you invoke it there, it keeps nothing it does not need, and it can say exactly what it changed. Version 0.1 ships one fix: the tab's title.

## The one rule

> The extension touches a page only because the user asked it to, on that page, and it can say exactly what it changed.

Everything else follows: `activeTab` instead of host permissions; fixes as rules rather than code; per-site opt-in for persistence; a visible list of every rule and every site with access, each with a remove button; no network calls.

## What version 0.1 does (built)

- **Set this tab's title.** Click the icon, type, Apply. Immediate, even on a single-page app that rewrites its title. Lasts until you leave or reload.
- **Keep it, on one site.** Tick "Always on this site"; Chrome asks for that one site; the title is applied on every visit with no further clicks.
- **Review, edit, undo.** "My rules" lists every rule and every site with access, each removable. Export and import as JSON. Undo on any page.
- **Say exactly what it may touch.** Four permissions, explained with Chrome's own words. No host permissions at install, no remote code, no network.

## New in 0.2: the playground, and a policy for every script (built)

Write a small fix as a script, tick what it may do, run it on a page, see exactly what it did, undo it, keep it. The script runs in a sandbox with nothing in it but the capabilities ticked, and every call is checked against a Script Behaviour Policy before it reaches the page. Eight reversible capabilities; saved experiments in your browser; export as a file to share. See [the playground](use/playground/index.md) and the article [Script Behaviour Policies](articles/script-behaviour-policies/index.md). The [plan](admin/plans/2026-10-25-split-and-fixes.md) proposes splitting the extension into its own repository and starting a library of fixes.

## How a fix reaches a page

1. **On demand, the default: `activeTab`.** Chrome: the permission "gives an extension temporary access to the currently active tab when the user invokes the extension"; access "lasts while the user is on that page, and is revoked when the user navigates away or closes the tab". No install warning.
2. **Persistent, per site, opt-in: `optional_host_permissions`.** The extension asks Chrome for one origin when you tick the box; Chrome shows its prompt; the engine is registered for that origin only.

## What it does not do

- No `host_permissions`, no `<all_urls>`, no `tabs`, `history`, `cookies`, `webRequest` or `debugger`.
- No code from anywhere else: fixes are data, interpreted by the bundled engine.
- No network, no telemetry: CSP `connect-src 'none'`, and the validator refuses `fetch`, `XMLHttpRequest` and `WebSocket`.
- Reads only the URL and the title of a page.

## Pages

- [Install](install/index.md): from a clone of the repository (the route to start with) or from the zip.
- [The title fix](use/title/index.md): modes, patterns, always on a site, undo, My rules, the export format.
- [The playground](use/playground/index.md): scripts under a policy, the eight capabilities, run and undo, experiments.
- [Articles](articles/index.md): Script Behaviour Policies.
- [Permissions](permissions/index.md): each one, why, what it can and cannot do, in Chrome's words.
- [Privacy](privacy/index.md): nothing leaves your browser; what is stored and where.
- [Source and releases](source/index.md): the files, the zip and its SHA-256, the validator, the tests.

## After the playground (proposed)

Saved fixes that run on their own on granted sites; the extension in its own repository; a library of fixes with contributors; packs and signed fixes; the Chrome Web Store; Firefox. None starts without Dinis's word. Scripts with the run of the page are out of scope by design: a script gets what its policy says, enforced outside its reach, or it does not run.

## Where this comes from

The newsroom article [Fix the page yourself](https://newsroom.sgit.ai/articles/fix-the-page-yourself.html) (Dinis Cruz, 17 October 2026) and the hub [chrome-extensions.sgit.ai](https://chrome-extensions.sgit.ai). Code Apache 2.0; content CC BY 4.0. Repository: https://github.com/SGit-AI/SGit-AI__Website__Chrome-Extension__Fix-The-Page
