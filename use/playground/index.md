# The playground

https://fix-the-page.chrome-extensions.sgit.ai/use/playground/ · [as HTML](index.html) · site v0.2.0 · status: built

Write a small script, tick what it may do, run it on the tab you came from, read what it did, undo it, keep it.

## Opening it

Click the Fix the Page icon on the page you want to work on, then **Playground** in the popup. It opens in a new tab bound to the tab you came from (the activeTab grant from the click). Opened on its own, it says so and still lets you write, save, export and import.

## The script

The body of an `async` function. It sees `page` and `log()`, nothing else: no `document`, `window`, `fetch` or `chrome`.

```js
const title = await page.title.get();
const url = await page.url.get();
await page.title.set('[' + url.split('/')[2] + '] ' + title);
```

## The eight capabilities

| Call | Kind | Does | Undo |
|---|---|---|---|
| `page.title.get()` | read | the tab's title | |
| `page.title.set(text)` | write | sets and holds the title | the page's own title returns |
| `page.url.get()` | read | the page's address | |
| `page.dom.count(selector)` | read | elements a selector matches | |
| `page.dom.text(selector)` | read | text of the first match, up to 2000 characters | |
| `page.dom.hide(selector)` | write | hides every match, up to 200 | shown again |
| `page.dom.setText(selector, text)` | write | replaces the text of the first match | the old text returns |
| `page.css.add(css)` | write | adds a stylesheet, up to 20000 characters | removed |

No verb exists for the network, storage, cookies, navigation or inserting markup; a policy cannot grant what does not exist.

## The policy

Tick the capabilities; set the limits (at most 1000 calls and 30 seconds; defaults 100 and 5). The static review compares script and policy as you type: a call not granted means not ready to run; an unused grant is advice; a banned name (`window`, `document`, `fetch`, `eval`, `chrome`, and others) means not ready to run, with the line.

## Run, read, undo

Run sends the script to the sandbox. The log shows each call, what it returned or why it was refused, then the effects recorded. Undo this run reverses them in reverse order; Undo every run clears the tab. Leaving or reloading the tab also clears it.

## Generic or site-specific

"Where it applies" is a match pattern. `*://*/*` marks a generic fix; the site's origin marks a site-specific one that can name the exact element. In 0.2 the pattern is a label and a record; running saved fixes on their own is not built.

## Keeping and sharing

Save keeps the experiment in `chrome.storage.local`, in this browser only. Export writes every saved experiment to a JSON file (`{ "format": "fix-the-page/experiments", "version": 1, "exported", "experiments": [...] }`); Import reads one back, replacing by id, refusing a bad file whole; nothing runs until you open it and press Run. Copy experiment as JSON puts the one in the editor on the clipboard.

## Not yet

Running a saved fix at load on a granted site (specified); inserting markup, calling a site's page API, navigating (proposed); stopping a script that never yields; sync.
