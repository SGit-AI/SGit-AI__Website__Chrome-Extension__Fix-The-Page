# Install

https://fix-the-page.chrome-extensions.sgit.ai/install/ · [as HTML](index.html) · site v0.1.0

Fix the Page is installed by loading it unpacked, from a clone of its repository or from the release zip. Chrome shows no "read and change all your data" warning, because the extension asks for none of that.

## Route A: from a clone of the repository (start here)

1. `git clone https://github.com/SGit-AI/SGit-AI__Website__Chrome-Extension__Fix-The-Page.git`. The extension is the `extension/` folder.
2. Open `chrome://extensions`. (Chrome's tutorial: "Go to the Extensions page by entering chrome://extensions in a new tab.")
3. Turn on Developer mode, top right. ("Enable Developer Mode by clicking the toggle switch next to Developer mode.")
4. Click Load unpacked and choose the `extension` folder inside your clone. ("Click the Load unpacked button and select the extension directory.")

To update: `git pull`, then the reload arrow on the extension's card.

## Route B: from the release zip

1. Download [fix-the-page-v0.1.0.zip](../releases/fix-the-page-v0.1.0.zip) and [its SHA-256](../releases/fix-the-page-v0.1.0.zip.sha256). Check with `shasum -a 256 fix-the-page-v0.1.0.zip` against the hash on the [source page](../source/index.md).
2. Unzip into a folder you will keep.
3. `chrome://extensions`, Developer mode.
4. Load unpacked, and pick the unzipped folder (the one with `manifest.json`).

## Your first fix

Open any normal web page, click the icon, type a title, press Enter. The tab changes at once. Nothing was saved; the page gets its own title back when you leave or reload. See [the title fix](../use/title/index.md).

## What Chrome will and will not ask

- At install: nothing about your data. `activeTab` "displays no warning message during installation" (Chrome's documentation).
- When you tick "Always on this site": Chrome's own prompt, for that one site. The optional host permissions `https://*/*` and `http://*/*` are Chrome's documented way "to request hosts that you only discover at runtime"; nothing is granted until you say yes, site by site.
- On Chrome's own pages: the popup says Chrome does not allow it there. "Access is not granted to restricted pages, such as chrome:// pages."

## The keyboard shortcut

Alt+Shift+T opens the popup for the current tab. If taken, set one at `chrome://extensions/shortcuts`. The options page shows the shortcut in force.

## Uninstall

Remove it from `chrome://extensions`. Chrome deletes the extension's storage with it, so export your rules first if you want them.
