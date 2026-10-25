---
title: Script Behaviour Policies: a behaviour policy for a line of JavaScript
date: 2026-10-25
author: Dinis Cruz, written up by the Fix the Page agent
summary: A line of JavaScript on a page can do everything the page can. The Agent Behaviour Policy writes down what an agent can reach, what you asked of it, the gap, and what stands in the way; the Process Behaviour Policy did the same for a process. This article does it for a script, the Script Behaviour Policy, a short document that says a script may set the title and nothing else, checked when the script is read and enforced while it runs by something the script cannot reach. The first one is running in Fix the Page's playground.
version: v0.2.0
license: https://creativecommons.org/licenses/by/4.0/
tags: behaviour-policies, javascript, browser-extensions, security, sandbox, article
status: published
---

# Script Behaviour Policies: a behaviour policy for a line of JavaScript

https://fix-the-page.chrome-extension.sgit.ai/articles/script-behaviour-policies/ · [as HTML](index.html) · status: built

## In short

- **A script's grant is the whole page.** Whatever a page can do, any script on it can do: the DOM, the network, storage, navigation. There is no smaller unit of trust in the platform.
- **The mandate is almost always one line.** "Set the title." "Hide that banner." The gap between the two is the problem, and it is the same gap the ABP was built to write down.
- **A Script Behaviour Policy is a list of capabilities and limits.** `title.set`, and at most a hundred calls in five seconds. Eight capabilities exist today. A name not in the vocabulary cannot be granted and will not be performed.
- **Static review is the lint, the reviewer and the CI.** Compare what the script calls with what the policy grants; refuse names that have no place in a fix; keep the policy as tight as the script.
- **Runtime enforcement is a realm with nothing in it.** The script runs in a sandboxed page with an opaque origin and no network. It sees one object, `page`, whose methods post messages. The playground, in another realm, checks every message against the policy; the engine on the page checks the arguments again and keeps an undo log.
- **"A control bounds a grant only if it is enforced by something the grant does not include."** The ABP's test, and the design rule here: the gate is never in the script's realm.
- **Every fix becomes a small application.** A script, its policy, a README that says the same thing, tests on a fixture page, a review.

## The grant of a script is the page

Chrome's documentation on content scripts: they "live in an isolated world"; "JavaScript variables in an extension's content scripts are not visible to the host page"; content scripts and the host page "share access to the page's DOM". That isolation protects the extension from the page. It does nothing to narrow what a script may do to the page. Measured the way the ABP measures a grant:

| Capability of a script on a page | Through | The title fix needs it |
|---|---|---|
| Read any element: text, inputs, passwords typed so far, hidden fields | `document.querySelector`, `.value` | no |
| Change any element, submit a form, click a button | the DOM | one of them: the title |
| Read cookies the page can see; read and write its storage | `document.cookie`, `localStorage` | no |
| Open a connection anywhere the page's policy allows, and send what it read | `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` | no |
| Navigate, open windows, rewrite history | `location`, `window.open`, `history` | no |
| Load more code, from text or from the web | `eval`, `new Function`, a `<script src>` | no |
| Run forever | a loop | no |

Seven rows; the mandate touches one of them, partially. In the usual arrangement (a bookmarklet, a userscript manager, an extension with host permissions) the barrier on every row is **none**. A reviewer's "it only sets the title" is an **expectation**: "a rule in prose, enforced by nobody".

## From ABP, through PBP, to SBP

The [Agent Behaviour Policy](https://abp.sgit.ai/) is four objects: the mandate (elicited), the grant (measured), the delta (derived), the barrier (recorded per capability, from one of four kinds). The [Process Behaviour Policy](https://cli.sgit.ai/dev/sealed-vault-keys/03-process-behaviour-policy.html) applied them to a process and added two rules that transfer: layers can only narrow, and "a business rule is only a Boundary if it is enforced in a different process from the one it constrains". For a script, the different process is a different realm.

| Object | ABP | PBP | SBP |
|---|---|---|---|
| Subject | one agent in one deployment | one process, subcommand, invocation | one script, on the pages its match pattern names, for one run |
| Mandate (elicited) | the job asked for | files, hosts, syscalls, edges, limits | the capabilities ticked, limits on calls and time, optionally the selectors it may name |
| Grant (measured) | the account, machine and tools | uid plus environment | the table above |
| Delta (derived) | grant minus mandate | per release and policy version | the lint computes it live, both ways |
| Barrier (recorded) | none, expectation, setting, boundary | mostly boundary: the kernel | see below |
| Layers | the deployment shape | L0 OS to L5 invocation | L0 manifest, L1 engine vocabulary, L2 policy, L3 run; intersection only |
| Who enforces | a gateway above the agent | the kernel, another process | the playground and the engine, two realms the script cannot reach |

## Where each line is enforced

| What stands in the way | Kind | Why |
|---|---|---|
| A reviewer reads the script | expectation | Prose. Necessary; not sufficient. |
| The lint: calls versus grants, banned names, unused grants | expectation | Advice the author can ignore and a regex a script can hide from. In CI it is a boundary for the repository, not for the running script. |
| Shadowing `window`, `document`, `fetch` and the rest inside the script's function | setting | The script's own realm, so it can undo it: `(async () => {}).constructor` reaches the real function constructor. The tests do exactly that. |
| The sandboxed page: Chrome's `sandbox` key, "served in a sandboxed unique origin", "won't have access to extension APIs" | boundary | Enforced by the browser. The escape finds an empty page with no extension API. |
| The sandbox's CSP: `connect-src 'none'`, no frames, images or forms | boundary | Enforced by the browser; a `fetch` from the escaped window is refused. |
| The gate: the playground checks every message against the policy | boundary | Another realm the sandbox cannot script. A forged message meets the same check. |
| The engine: checks arguments again, knows eight verbs, logs every effect | boundary | A third realm. It never sees the policy; it cannot do anything outside its vocabulary. |
| The limits: calls and milliseconds | boundary, partly | A tight synchronous loop cannot be interrupted from outside. A gap. |

## Layers that can only narrow

L0, the extension's manifest: activeTab, no host permissions, no network. L1, the engine's vocabulary: eight verbs with bounded arguments and undo. L2, the policy: the subset ticked. L3, the run: this tab, this press of Run. Effective = L0 ∩ L1 ∩ L2 ∩ L3. A policy cannot ask for `network.send` because L1 has no such verb.

## Static enforcement

1. The lint, as you type: every `page.x.y(` versus the policy; banned names with line numbers; unused grants. A regex, not a parser; it says so.
2. A reviewer, human or agent, with the policy and the README: does the fix do what it says, no more than its policy, and is the policy as small as the job. For an agent, a skill.
3. CI, for a library: the lint as a gate, the tests under the sandbox harness, README names equal policy names.

## Runtime enforcement

1. The playground builds the policy and runs the lint. Not clean, no run.
2. It posts the script, the capability list and the limits to the sandbox iframe (Chrome: "served in a sandboxed unique origin", "won't have access to extension APIs", "may communicate with them using postMessage()"), under a CSP of `sandbox allow-scripts; script-src 'self' 'unsafe-eval'; connect-src 'none'` and nothing else.
3. The sandbox builds a `page` object with the granted capabilities and nothing else, builds the script into a function with the usual globals shadowed, runs it under a timer.
4. Each call is a message. `checkCall(policy, call)`, a pure function tested in Node, refuses anything not granted, any wrong argument shape, any selector outside an allowlist. Refusals are logged in words.
5. Allowed calls reach the engine, which checks arguments again, applies, records. Undo reverses a run in reverse order.
6. When the script ends or the timer fires, later messages for the run are refused.

## The worked example

```json
{ "policy": "fix-the-page/sbp", "version": 1, "capabilities": ["title.set"], "limits": { "calls": 100, "ms": 5000 } }
```

```js
await page.title.set('Ops dashboard');
```

Change the script to `await page.css.add('body { display: none }')` and the lint says the policy does not grant `css.add`. Force the run and the gate logs `refused page.css.add("body { display: none }"): css.add is not in the policy`. The page is unchanged.

## What fits in eight verbs

Set, prefix or template the title: yes. Bigger text, high contrast, text spacing: `css.add`, yes. Hide a banner: `dom.count`, `dom.hide`, yes. Rename a heading: `dom.text`, `dom.setText`, yes. Reading mode: best effort. An outline of headings: needs `dom.insert`, not yet. Open the markdown twin: needs navigation, which Undo cannot reverse. Call a site's own page API: needs `site.apply`, the next verb worth adding.

## Every fix is a small application

```
fixes/example.com/hide-cookie-banner/   or  fixes/generic/bigger-text/
  fix.json      name, match, the policy, author, version, licence
  fix.js        the script
  README.md     what it does, in words a reader can compare with the policy
  tests/        a fixture page and what the fix must change
  REVIEW.md     who read it, the delta they computed, when; later a signature
```

CI runs the lint and the tests, compares README with policy, refuses the merge otherwise. A reviewing agent gets the same files and a skill. Later, policy and script are hashed together and signed with a key the pki.sgit.ai register vouches for.

## What this does not claim

- Not a boundary against a malicious extension: the gate and the engine are the extension's own code. The source is public so that trust can be checked.
- A bug in a capability is a bug in the boundary. The vocabulary is small so each verb can be read, bounded and tested.
- The lint is advice; the gate does not depend on it.
- A tight synchronous loop is not stopped. A gap.
- A policy describes and does not judge: `css.add` is harmless on a newspaper and can hide the pay button on a shop.
- One realm, one run: saved experiments run when you press Run. Running them at load on granted sites is specified, not built.
- Eight verbs. A start, not a library.

## Where this comes from

A memo from Dinis Cruz on 25 October 2026, after the first install. The model: [abp.sgit.ai](https://abp.sgit.ai/), [riskmandate.ai](https://riskmandate.ai/abp.html), and cli.sgit.ai's [Process Behaviour Policies](https://cli.sgit.ai/dev/sealed-vault-keys/03-process-behaviour-policy.html). The idea of fixes as one-line calls on primitives: the newsroom's [Fix the page yourself](https://newsroom.sgit.ai/articles/fix-the-page-yourself.html). Chrome facts: the [sandbox manifest reference](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox) and the [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) page, fetched 25 October 2026. The code: `extension/sbp.js`, `sandbox.js`, `playground.js`, the capability half of `engine.js`, and `tests/`.

**For an agent.** A Script Behaviour Policy is `{ "policy": "fix-the-page/sbp", "version": 1, "capabilities": [...], "limits": { "calls": n, "ms": n }, "selectors": [...]? }`. The vocabulary is the eight names in `extension/sbp.js`. To review a fix: compute the calls (`page.x.y(`), compare with the policy, name the delta both ways, check the README names the same capabilities, run the tests under `tests/fixtures/sandbox-host.html`. The gate is `checkCall(policy, call)`; the lint is `lintScript(script, policy)`; both run in Node.
