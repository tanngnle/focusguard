# FocusGuard

FocusGuard is a Manifest V3 Chrome extension that blocks distracting websites. When you navigate to a domain you've added to your list, it intercepts the navigation and replaces the page with a full-screen Pomodoro timer instead of loading the site. It's built as plain JS/HTML/CSS with no build step and no external runtime dependencies.

## Install from source

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the repo root (the folder containing `manifest.json`).

There is nothing to compile — Chrome loads the JS/HTML/CSS files directly off disk.

## Usage

- **Add a site**: type a domain (e.g. `twitter.com`) into the popup's input field and click add, or press Enter. Domains are normalized (protocol, `www.`, path, and whitespace stripped) and validated before being saved.
- **Per-site toggle**: each entry in the blocked-sites list has its own on/off switch, so you can keep a site in your list without actively blocking it.
- **Master toggle**: the switch in the popup header turns blocking off entirely without clearing your site list.
- **Pomodoro settings**, adjustable via sliders in the popup:
  - Work duration — 1 to 60 minutes (default 25)
  - Short break — 1 to 30 minutes (default 5)
  - Long break — 1 to 60 minutes (default 15)
  - Rounds before a long break — 1 to 8 (default 4)

When you're redirected to the timer page, controls let you start/pause, reset, or skip to the next phase. Timer state persists across tab reloads (for up to 2 hours) but is tied to that tab — closing it ends the running timer.

## How it works

A background service worker (`background.js`) listens for `chrome.webNavigation.onBeforeNavigate` on the top frame of every navigation. It checks whether blocking is enabled and matches the navigated hostname (with `www.` stripped) against your stored site list, either exactly or as a subdomain. On a match, it redirects the tab to the bundled timer page (`blocked/blocked.html`) with `chrome.tabs.update()` — this is a redirect after navigation starts, not a network-level block, so the original page may begin loading briefly before the swap happens.

The extension has three isolated contexts — the background service worker, the popup, and the blocked/timer page — and they communicate **only through `chrome.storage`**. There is no content script and no message passing between them.

- Site list, master toggle, and Pomodoro settings live in `chrome.storage.sync`.
- Running timer state (phase, round, time remaining) lives in `chrome.storage.local`, saved on every tick so it can resume after a reload.

## Permissions and privacy

`manifest.json` currently requests:

- **`storage`** — to save your blocked-site list, Pomodoro settings, and in-progress timer state locally/synced via your Chrome profile.
- **`webNavigation`** — to detect when a tab is about to navigate to a blocked domain, so it can be intercepted before the page loads.

The extension makes **no network requests at all** — it collects no data, sends nothing anywhere, and contacts no third party. Everything it renders is bundled:

- **Fonts are self-hosted.** Inter and Orbitron live in `fonts/` as latin-subset variable `woff2` files (54 KB total) rather than being pulled from Google's CDN, so opening the popup does not tell Google you opened it. Both are licensed under the SIL Open Font License 1.1; the license texts ship alongside them in `fonts/OFL-Inter.txt` and `fonts/OFL-Orbitron.txt`, as the OFL requires.
- **Site icons are generated locally.** Each blocked site shows a letter avatar coloured from a hash of its own domain. An earlier version fetched favicons from `google.com/s2/favicons`, which leaked your entire blocklist to Google on every render.

It follows that the extension works identically offline.

## Development

```
npm install
npm test
npm run lint
```

`npm test` runs the automated test suite and `npm run lint` runs the linter; see `package.json` for the exact tooling.

If you change `background.js` or `manifest.json`, click **Reload** on the extension's card in `chrome://extensions` — service worker and manifest changes are not picked up automatically. Editing files under `popup/` or `blocked/` only requires reopening the popup or reloading the blocked-page tab.

For manual QA steps, see `docs/QA-TEST-PLAN.md`. For a deeper architectural walkthrough (matching rules, storage schema, timer state machine), see `CLAUDE.md`.

## Project structure

```
.
├── background.js    # Service worker: watches navigation, redirects blocked domains
├── manifest.json    # MV3 manifest
├── lib/             # Pure logic shared across contexts: domain normalization, site matching, timer state machine
├── popup/           # Toolbar popup: site list, toggles, Pomodoro settings UI
├── blocked/         # Full-screen Pomodoro timer page shown in place of a blocked site
├── fonts/           # Self-hosted Inter + Orbitron (SIL OFL 1.1, licenses included)
├── icons/           # Extension icons
├── tests/           # Vitest unit + integration tests and the chrome API mock
└── docs/            # Manual QA test plan
```

## License

MIT — see [LICENSE](LICENSE).
