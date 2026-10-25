# Plan: split the extension from the site, and start a library of fixes

Written 25 October 2026 by the Fix the Page agent from Dinis Cruz's memo of the same day. A proposal for Dinis to accept, change or refuse. [As HTML](index.html).

## Why split

- The website is the web page; it changes when the words change. The extension changes when the code changes. One version number for both was right for a first release and will be wrong by the third.
- The extension wants its own releases: a GitHub release per tag with the zip and its hash as assets.
- Fixes are a third thing: data plus a small script under a policy, contributed by people who need not touch the extension, reviewed by a process of their own, consumed by the extension as packs.

## The three repositories

| Repository | Holds | Releases | Version |
|---|---|---|---|
| `SGit-AI/SGit-AI__Chrome-Extension__Fix-The-Page` (proposed) | `extension/`, `tests/`, packaging, the extension half of the validator, code debriefs | a GitHub release per tag with the zip and `.sha256`; later the Web Store | its own, in `manifest.json` |
| `SGit-AI/SGit-AI__Website__Chrome-Extension__Fix-The-Page` (this one) | the site; a verified copy of each release's zip and hash | every push to `dev` | its own; each page states which extension release it describes |
| `SGit-AI/SGit-AI__Fixes__Fix-The-Page` (proposed) | one folder per fix: `fix.json`, `fix.js`, `README.md`, `tests/`, `REVIEW.md`; the review skill; CI | packs: a signed JSON file per site or theme | per fix |

On the name: the family's pattern is `Owner__Kind__Name`. `SGit-AI__Chrome-Extension__Fix-The-Page` follows it; if there will be several extensions, `SGit-AI__Chrome-Extensions__Fix-The-Page` reads better as a family. Dinis's call.

## The steps, in order

1. **Create the extension repository with its history.** `git filter-repo --path extension/ --path tests/ --path admin/build/package.mjs --path admin/build/zip.js --path admin/build/icons.mjs` on a fresh clone. The validator's extension checks move with it; the site checks stay.
2. **Its own pipeline.** Every push: validate, test. A tag `vX.Y.Z`: build the zip, hash it, create the GitHub release with both as assets. The hub's tag job applies unchanged; the deploy job goes.
3. **Teach this site to serve a release it did not build.** `admin/build/fetch-release.mjs <version>` downloads the zip and hash from the extension's release, verifies, writes `releases/` and `releases/current.json`. The validator checks against `current.json` instead of `extension/`. The install page says "extension vX.Y.Z, site vA.B.C".
4. **Remove `extension/` and `tests/` from this repository**, after the extension repository has had one green release and this site has served it.
5. **Start the fixes repository with the seven playground examples** in the folder shape below, with tests on the fixtures already written.
6. **Teach the extension to import a pack** (`{ format: "fix-the-page/pack", version, name, fixes: [...] }`, later signed), showing every fix and its policy before anything is kept. Then: run kept fixes at load on granted sites under their policies, which needs the sandbox to run without the playground open (an offscreen document, or the options page hosting it; to be designed and measured).
7. **Ask the hub to link to both.** The hub is read-only to this agent.

## Generic fixes and site-specific fixes

| | Generic | Site-specific |
|---|---|---|
| Match | `*://*/*` or `https://*/*` | one origin, or a path under it |
| Folder | `fixes/generic/<slug>/` | `fixes/<host>/<slug>/` |
| May assume | only the platform: CSS, the title, headings | the site's markup, named selectors; its page API where it has one |
| Honesty label | "best effort" where it guesses | "as of" a date; the test fixture is a snapshot of the markup |
| Capabilities, typically | `css.add`, `title.*` | `dom.count`, `dom.hide`, `dom.setText`, with a selector allowlist in the policy |

A site-specific fix should carry `selectors` in its policy: the exact selectors it may name. A reviewer then reads five lines and knows the whole reach of the fix, and the gate refuses any other selector at run time.

## Every fix a small application

```
fixes/example.com/hide-cookie-banner/
  fix.json     { "name", "match", "policy": { capabilities, limits, selectors }, "author", "version", "licence", "asOf" }
  fix.js       the script
  README.md    what it does; must name the same capabilities as the policy
  tests/page.html, tests/expect.json
  REVIEW.md    reviewer, date, the delta computed, what they ran; later a signature
```

CI on a pull request: the lint (calls ⊆ policy, no banned names, no unused grants); the tests under the sandbox harness; README names = policy names; `fix.json` validates as an experiment. A reviewing agent gets a skill: read the three files, compute the delta both ways, run the tests, write `REVIEW.md`. Human review stays for site-specific fixes on pages with money or data behind them.

## Opening it up

- Contribution is a pull request with one folder; the template gives the shape; CI gives the first review; a maintainer merges.
- Packs are the unit of distribution: per site or per theme, built by CI from merged fixes, published as a release and later from an sgit vault with a read key.
- Signing from pki.sgit.ai: a maintainer key signs each pack, an author key may sign each fix; the extension shows who signed and refuses a pack changed after signing.
- Kept fixes are the roadmap: a count of kept fixes, in the reader's own record and sent only if they choose.

## Decisions for Dinis

1. The names of the two new repositories.
2. Whether this site keeps serving the zip (recommended: yes, fetched and verified from the extension's release).
3. Whether saved fixes should ever run without the playground open, and on which barrier.
4. Whether `selectors` is required in the policy of every site-specific fix (recommended: yes).
5. The licence for contributed fixes (default: Apache 2.0 code, CC BY 4.0 words).
