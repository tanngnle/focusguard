# AGENT.md

## Project

**FocusGuard** — a Manifest V3 Chrome extension that intercepts navigation to user-listed domains and redirects the tab to a full-screen Pomodoro timer page.

Vanilla JS/HTML/CSS with **no build step** — files are loaded by Chrome exactly as they sit on disk. npm exists for tests and lint only (Vitest + ESLint); nothing in `node_modules/` is required to load the extension.

The extension makes **no network requests**. Fonts are self-hosted in `fonts/` and site avatars are generated locally — both were previously third-party fetches. Keep it that way: any new `<link>`, `fetch`, or remote asset breaks the offline guarantee and the privacy claim in `README.md`.

## Development workflow

```bash
npm install
npm test        # Vitest — unit tests for lib/, integration tests for background.js
npm run lint    # ESLint
```

The extension itself needs no build. To run it:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the project root.
2. After editing `background.js` or `manifest.json`, click **Reload** on the extension card (service worker changes are not hot-reloaded).
3. Editing `popup/*` or `blocked/*` only requires reopening the popup / reloading the blocked tab.

Debugging surfaces (each has its own DevTools console):
- Service worker: extension card → **Inspect views: service worker**
- Popup: right-click the toolbar icon → **Inspect popup**
- Blocked page: normal DevTools on the redirected tab

Inspect persisted state from any of those consoles:
```js
chrome.storage.sync.get(null)    // enabled, sites[], pomodoroSettings
chrome.storage.local.get(null)   // focusguard_timer_state
```

## Architecture

Three isolated contexts that communicate **only through `chrome.storage`** — there is no message passing and no content script. All three are ES modules (`"type": "module"` on the service worker, `<script type="module">` in both HTML pages) and share pure logic from `lib/`.

### `lib/` — the only shared, testable code
`domain.js` (`normalizeDomain`, `isValidDomain`), `matcher.js` (`SKIPPED_PROTOCOLS`, `matchSite`), `timer.js` (`initialState`, `phaseDuration`, `remainingSeconds`, `advancePhase`, `formatTime`).

These are **pure** — no `chrome.*`, no DOM, and `timer.js` takes `now` as an injected parameter rather than calling `Date.now()`. That is what makes them unit-testable, so keep new logic here and keep it pure. `matchSite` must never throw on a malformed URL; it returns `null`.

Security-critical detail in `matchSite`: subdomain matching uses `hostname.endsWith("." + blockedDomain)`. The leading dot is what stops `notreddit.com` and `reddit.com.evil.com` from matching a `reddit.com` entry. Don't "simplify" it to `includes`.

### 1. `background.js` — service worker (the blocker)
- `onInstalled` **merges** `DEFAULTS` into `chrome.storage.sync` per key, filling only keys that are `undefined`. It must never overwrite an existing value — doing so wipes the user's site list on upgrade.
- `chrome.webNavigation.onBeforeNavigate` (top frame only) consults a **module-scoped cache** of `enabled` + `sites`, hydrated by a top-level promise and kept current by a `chrome.storage.onChanged` listener. The hot path does **zero async storage I/O** — every `await` there delays the redirect while the distracting page loads. If you add state to this path, cache it the same way.
- On a match it calls `chrome.tabs.update()` to `blocked/blocked.html?domain=<matched>`.
- Blocking is done via redirect, **not** `declarativeNetRequest` — so it is asynchronous and races the original page load.

### 2. `popup/` — settings UI
- Owns the blocked-site list and Pomodoro durations, writing to `chrome.storage.sync`.
- **Site identity is the `domain` string**, never the array index. Toggle and delete re-read `sites` and find by domain, no-opping if it is gone. Index-keying is what caused a wrong-site deletion race behind the 250ms removal animation.
- Slider writes are **debounced (~400ms)** and flushed on `change`. `chrome.storage.sync` allows only 120 writes/min; writing on every `input` event silently exceeded it and dropped settings. All writes go through a wrapper that surfaces failures via `showHint()`.
- Site cards are built with `createElement`/`textContent`, not `innerHTML`. MV3's default CSP (`script-src 'self'`) blocks inline handlers, so an `onerror=` attribute in an `innerHTML` string will never fire.
- Favicons are locally generated letter avatars — no network, no blocklist leak.

### 3. `blocked/` — Pomodoro timer
- Timer state machine lives in `lib/timer.js`; `blocked.js` is the view plus persistence.
- **Timing is wall-clock, not counted.** While running, the source of truth is `endsAt` (epoch ms) and remaining time is derived from `Date.now()`; while paused it is `remaining` (seconds), with `endsAt` null. The `setInterval` is only a repaint trigger. This matters: Chrome throttles timers in hidden tabs to ~1/min, so any implementation that decrements a counter runs the timer slow. Never reintroduce one.
- **Resume:** state older than 2h is discarded; otherwise if the deadline already passed while the tab was closed, it advances one phase (deliberately not a loop) rather than freezing at `00:00`.
- Persists to `storage.local` under `focusguard_timer_state` on transitions, a 10s heartbeat, and `pagehide`/`visibilitychange` — not every tick.
- A `storage.onChanged` listener applies setting changes immediately when idle, but defers to the next phase while running so a session in progress isn't disrupted.
- `advancePhase()` drives the cycle: work → short break (or long break when `currentRound >= totalRounds`) → work, with `currentRound` reset to 1 after a long break. It passes `isRunning` straight through — callers wanting "stop and wait for Start" must pass `{...state, isRunning: false}`.
- Phase changes are expressed by swapping `phase-work` / `phase-short-break` / `phase-long-break` classes on `<body>`; the whole color theme lives in CSS keyed off those classes.
- The progress ring reads `r` off the SVG circle at init and computes its circumference once.
- Completion chime is synthesized with the Web Audio API (no audio asset) through a single reused `AudioContext`. Autoplay policy means it stays suspended until a user gesture, so it is unlocked on the control-button clicks.

## Constraints to keep in mind

- `manifest.json` declares only `storage` and `webNavigation`. `chrome.tabs.update(tabId, {url})` does **not** require the `tabs` permission — that permission only gates reading `url`/`title`/`favIconUrl` off `Tab` objects.
- `chrome.storage.sync` limits writes to 120/min and 1800/hr, and the whole blocked-site list is one `sites` array under a single key. Anything that writes on a continuous input event needs debouncing.
- Timing authority lives in the page, so a running timer stops advancing only in the sense that no chime fires while the tab is shut — elapsed time is still accounted for on reopen. Moving it into the service worker with `chrome.alarms` is a known, deliberately deferred follow-up.
- `web_accessible_resources` still lists `blocked/*` for `<all_urls>`. This is believed unnecessary — an extension navigating a tab to its own page is privileged regardless, and there are no content scripts — but it has not been verified in-browser, so it was left in place.
