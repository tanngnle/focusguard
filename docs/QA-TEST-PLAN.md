# FocusGuard — Manual QA Test Plan

This plan covers what automated tests (`tests/`, pure-logic unit tests for
`lib/matcher.js` / `lib/domain.js`) cannot: real browser navigation
interception, cross-tab/cross-surface behavior, timer accuracy over real
elapsed wall-clock time, and visual/interaction correctness. Every case has a
stable ID so results can be tracked and referenced release over release.

Written for someone who has never opened this codebase. Where a case name
is followed by **(PRIMARY BUG)**, it is a deliberate regression test for one
of four bugs that were actively being fixed at the time this plan was
written — run those every release, no exceptions.

The four bugs and their regression IDs:

| Bug | Test IDs |
|---|---|
| Background-tab timer drift (Chrome throttles `setInterval` in hidden/closed tabs; the timer isn't wall-clock corrected while a tab stays open) | `TMR-05`, `TMR-06` |
| `chrome.storage.sync` write-quota exhaustion (120 writes/min) from dragging a settings slider | `SET-05` |
| Wrong-site deletion race when deleting two sites in quick succession | `CRUD-09` |
| CSP-blocked inline event handler (MV3's default CSP silently blocks `onclick="…"` attributes — the control looks dead, no visible error unless the console is open) | `CC-05` |
| Chat overlay permanently covering the blocked page (the Bao overlay rendered full-viewport with no close mechanism, so Start/Pause/Reset/Skip were unreachable; fixed in v1.1.0 by hiding it behind a launcher) | `UI-06` |

---

## 1. Setup

### 1.1 Record environment

Fill in before every test pass:

| Field | Value |
|---|---|
| Chrome version (`chrome://version`) | |
| OS + version | |
| Extension version tested (`manifest.json` → `version`) | |
| Date | |
| Tester | |

### 1.2 Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the project root (the folder containing `manifest.json`).
4. Confirm the "FocusGuard" card appears with no errors badge. If a red **Errors** button appears on the card, click it and record the error before proceeding — a case in this plan will likely fail for the same reason.

After editing `background.js` or `manifest.json`, click the circular **Reload** icon on the extension card — service worker changes are not hot-reloaded. Editing `popup/*` or `blocked/*` only requires reopening the popup / reloading the blocked tab.

### 1.3 The three DevTools consoles

FocusGuard runs as three isolated contexts that only talk to each other through `chrome.storage`. Each needs its own console open to observe:

| Surface | How to open its console |
|---|---|
| **Service worker** (`background.js`) | `chrome://extensions` → FocusGuard card → **Inspect views: service worker** (link appears only while the worker is alive; if it says "service worker (inactive)", click it to wake and inspect it) |
| **Popup** (`popup/popup.js`) | Right-click the FocusGuard toolbar icon → **Inspect popup**. The popup closes if you click outside it, which also kills this DevTools window — reopen both together. |
| **Blocked page** (`blocked/blocked.js`) | Navigate a tab to a blocked site so it redirects, then open normal DevTools (F12) on that tab, same as any web page |

### 1.4 Inspecting persisted state

Run in **any** of the three consoles above (storage is shared across contexts):

```js
chrome.storage.sync.get(null)    // { enabled, sites: [...], pomodoroSettings }
chrome.storage.local.get(null)   // { focusguard_timer_state }
```

To seed or corrupt state for a test (e.g. simulating an upgrade or a stale saved session):

```js
chrome.storage.sync.set({ sites: [{ domain: "example.com", active: true }] })
chrome.storage.local.set({
  focusguard_timer_state: { /* ... */ savedAt: Date.now() - 3 * 60 * 60 * 1000 }
})
```

---

## 2. Install & Upgrade

| ID | Preconditions | Steps | Expected |
|---|---|---|---|
| `INST-01` | Extension not currently loaded; no prior FocusGuard storage in this Chrome profile | 1. Load unpacked per §1.2. 2. Open the service worker console. 3. Run `chrome.storage.sync.get(null)`. | Returns `{ enabled: true, sites: [], pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 } }`. |
| `INST-02` — **upgrade must not clobber an existing site list** | Extension already loaded | 1. In any console, run `chrome.storage.sync.set({ sites: [{ domain: "example.com", active: true }, { domain: "news.ycombinator.com", active: false }], pomodoroSettings: { workDuration: 40, shortBreak: 10, longBreak: 20, roundsBeforeLong: 3 } })`. 2. Go to `chrome://extensions` and click **Reload** on the FocusGuard card (this re-fires `onInstalled` with reason `"update"`, the same hook a real version bump uses). 3. Re-run `chrome.storage.sync.get(null)`. | The `sites` array and `pomodoroSettings` are **byte-for-byte unchanged** from step 1 — both `example.com` (active) and `news.ycombinator.com` (inactive) are still present, custom durations intact. Nothing was reset to defaults. |
| `INST-03` — partial-key backfill | Extension loaded | 1. Run `chrome.storage.sync.remove(["pomodoroSettings"])` while leaving `sites` populated (reuse state from `INST-02`). 2. Reload the extension. 3. Re-check `chrome.storage.sync.get(null)`. | `pomodoroSettings` is backfilled to the default `{25, 5, 15, 4}` (it was genuinely missing), but `sites` is **untouched** — confirms defaults are merged per-key, not as an all-or-nothing overwrite. |

---

## 3. Blocking Matrix

Preconditions common to all rows unless stated otherwise: extension loaded, master toggle **on**, the named site is the **only** entry in `sites` and is **active**. Add sites via the popup (§4) or directly via `chrome.storage.sync.set`. After each row, remove/reset the site list before the next row unless chained.

| ID | Blocked list contains | Navigate to | Expected |
|---|---|---|---|
| `BLK-01` | `reddit.com` (active) | `https://reddit.com/` | **Blocked** — tab redirects to `blocked/blocked.html?domain=reddit.com` |
| `BLK-02` | `reddit.com` (active) | `https://m.reddit.com/r/all` | **Blocked** (subdomain suffix match) |
| `BLK-03` | `reddit.com` (active) | `https://www.reddit.com/` | **Blocked** (`www.` is stripped from the navigated hostname before comparison) |
| `BLK-04` | `reddit.com` (active) | `https://reddit.com/r/programming/comments/abc123/some_title/` | **Blocked** — deep paths match the same as the bare domain; redirect URL carries only `?domain=reddit.com`, no return-to-original-path param |
| `BLK-05` — **must not block** | `reddit.com` (active) | `https://notreddit.com/` | **Not blocked**, page loads normally. `notreddit.com` merely contains `reddit.com` as a substring but is not the domain nor a subdomain of it |
| `BLK-06` — **must not block** | `reddit.com` (active) | `https://reddit.com.evil.com/` | **Not blocked**. Confirms the subdomain check anchors on the *end* of the hostname (`.reddit.com` suffix), not merely "contains reddit.com" |
| `BLK-07` — SPA in-page routing (known architecture limit) | A domain that is itself a client-routed SPA (e.g. `x.com`), added and active | 1. **Before** adding the site to the block list, open a tab on that domain and let it fully load. 2. Now add the domain to the block list (popup, master toggle on). 3. Without reloading or re-entering the URL, click an in-app link that changes the URL via client-side routing (no full page reload — watch the tab's loading spinner, it should *not* spin). | **Not blocked** while staying on the same in-page navigation — `chrome.webNavigation.onBeforeNavigate` only fires on real top-frame loads, not on History API `pushState`/`replaceState` used by SPA routers. Confirm this is what happens (it is expected given the architecture), then reload the tab or type the URL again in the address bar and confirm **that** triggers the redirect. |
| `BLK-08` | any (or empty list) | `chrome://extensions`, `chrome://settings` | **Never intercepted** — loads normally, no error in the service worker console |
| `BLK-09` — extension's own pages never blocked | `reddit.com` active, tab already redirected to `blocked/blocked.html?domain=reddit.com` | 1. From the blocked tab, manually navigate the address bar to the same `chrome-extension://<id>/blocked/blocked.html?domain=reddit.com` URL again. 2. Also try `chrome-extension://<id>/popup/popup.html`. | No redirect loop, no re-redirect — `chrome-extension:` is an explicitly skipped protocol |
| `BLK-10` | `reddit.com` active, **master toggle switched OFF** in popup | `https://reddit.com/` | **Not blocked** — global disable short-circuits before the site list is even checked |
| `BLK-11` | `reddit.com` present but its **per-site toggle switched OFF** (master toggle stays on) | `https://reddit.com/` | **Not blocked** — inactive entries are skipped |
| `BLK-12` — iframe must not redirect the parent tab | `reddit.com` active | Create a scratch local HTML file: `<iframe src="https://reddit.com"></iframe>`, open it as a tab (`file://…` or drag into Chrome). | The **parent tab does not redirect** (frame ID ≠ 0 is explicitly ignored). The iframe itself loads whatever `reddit.com` serves, unblocked — this is expected, not a bug, since the extension only inspects top-level navigations |
| `BLK-13` | `reddit.com` active | Open an **Incognito** window (`Ctrl+Shift+N`) and navigate to `https://reddit.com/` | **Not blocked** by default — confirm at `chrome://extensions` → FocusGuard → Details that **"Allow in incognito" is OFF**. This is expected default MV3 behavior, not a bug. Repeat with the toggle switched ON to confirm blocking *does* work once explicitly allowed. |

---

## 4. Popup CRUD

Open via right-click → **Inspect popup** (§1.3) alongside the popup itself so console errors are visible during every step.

| ID | Case | Steps | Expected |
|---|---|---|---|
| `CRUD-01` | Add a valid site | Type `twitter.com` into the input, click **+**. | Card for `twitter.com` appears in the list, `site-count` increments, hint shows "✓ twitter.com added" (green), `chrome.storage.sync.get(["sites"])` contains `{domain:"twitter.com", active:true}` |
| `CRUD-02` | Duplicate rejection | With `twitter.com` already listed, type `twitter.com` again and click **+**. | Hint shows "This site is already blocked" (default/error styling), no second card, `sites` array unchanged |
| `CRUD-03` | Invalid input — empty | Leave the input blank, click **+**. | Hint shows "Please enter a website domain", nothing added |
| `CRUD-04` | Invalid input — malformed | Type `not a domain` (or a single-label host like `localhost`), click **+**. | Hint shows "Invalid domain format (e.g. twitter.com)", nothing added |
| `CRUD-05` — **input normalization** | Type `https://WWW.Example.com/path`, click **+**. | Stored/displayed domain is exactly `example.com` — protocol, `www.`, path, and casing are all stripped |
| `CRUD-06` | Toggle persists | Click a site's toggle off, close the popup, reopen it. | Card shows the toggle off and has the `inactive` visual style both immediately and after reopen; `chrome.storage.sync.get(["sites"])` shows `active: false` for that entry |
| `CRUD-07` | Delete a site | Click the delete (×) button on one card. | Card plays its removal transition (~250ms `removing` class) then disappears; `site-count` decrements; `sites` array in storage no longer contains that domain |
| `CRUD-08` | Empty state | Delete every site in the list. | The empty-state panel ("No sites blocked yet…") is shown, `site-count` reads `0` |
| `CRUD-09` — **delete-race regression (PRIMARY BUG)** | List has at least 4 distinct sites, e.g. `a.com`, `b.com`, `c.com`, `d.com` | 1. Click delete on `b.com`'s card. 2. **Within one second**, before the first card's removal animation finishes, click delete on `d.com`'s card. | Exactly `b.com` and `d.com` are gone. `a.com` and `c.com` remain, untouched and in their original order. `chrome.storage.sync.get(["sites"])` matches what's rendered — no duplicate, no wrong-site removal, no card left visually "stuck". Repeat 3–4 times with different pairs/timings since races are timing-sensitive. |
| `CRUD-10` (bonus) | Rapid toggle on two different sites within 1 second | Toggle `a.com` and, within a second, toggle `c.com`. | Both toggles land correctly on the right domains; no cross-talk between the two in-flight storage writes |

---

## 5. Settings

Open the popup, expand **Timer Settings** (gear button) for all cases below.

### 5.1 Persistence across close/reopen

| ID | Slider | Steps | Expected |
|---|---|---|---|
| `SET-01` | Work Duration (1–60) | Drag to a distinct value (e.g. 42), close the popup, reopen it, re-expand settings | Slider position and label read "42 min"; `chrome.storage.sync.get(["pomodoroSettings"])` → `workDuration: 42` |
| `SET-02` | Short Break (1–30) | Same, e.g. drag to 12 | Persists as `shortBreak: 12` |
| `SET-03` | Long Break (1–60) | Same, e.g. drag to 33 | Persists as `longBreak: 33` |
| `SET-04` | Rounds (1–8) | Same, e.g. drag to 6 | Persists as `roundsBeforeLong: 6` |

### 5.2 Other settings cases

**`SET-05` — slider drag storage-quota regression (PRIMARY BUG)**
Preconditions: popup + its console open (§1.3), service worker console also open.
Steps:
1. Grab the Work Duration slider thumb with the mouse and drag it rapidly back and forth across its *full* range (1 → 60 → 1 → 60...) for several seconds, the way a user idly fidgeting with it would — this fires many `input` events.
2. Release the thumb.
3. Close the popup, reopen it, re-expand settings.
Expected: the slider shows the value it was released at (not some earlier fired-but-not-settled value); neither the popup console nor the service worker console shows a storage error (`chrome.storage.sync` throws/rejects at >120 writes/minute — look specifically for `QUOTA_BYTES`, `MAX_WRITE_OPERATIONS_PER_MINUTE`, or the popup's own surfaced "Couldn't save: …" hint). The debounced `input` handler plus the immediate `change`-commit-on-release should keep writes well under quota even under an aggressive drag.

**`SET-06` — settings changed while a blocked page is open**
Preconditions: `reddit.com` blocked and active; a tab is currently showing `blocked/blocked.html` with the timer running (started).
Steps:
1. In the popup (a separate window/click), change Work Duration from its current value to a very different one (e.g. 25 → 5).
2. Switch back to the already-open blocked tab. Do **not** reload it.
3. Observe the running countdown for ~10 seconds, then click **Reset** on the blocked page.
Expected: `blocked.js` listens on `chrome.storage.onChanged` (sync area) for `pomodoroSettings`, so the edit **does** reach the open tab — but its effect depends on timer state:
- **Timer running** (this case): the in-progress session is deliberately *not* disturbed — its deadline holds, so the countdown keeps running against the original duration. The new value takes effect from the **next phase** onward. Yanking time out from under a running session would be the wrong behavior; confirm it does not happen.
- **Timer idle/paused**: re-run this case with the timer paused instead. The new duration applies **immediately** — the displayed time and ring update without a reload.

`Reset` re-reads settings via `initialState()`, so after a reset the new value is in force either way. Confirm no console errors appear in either surface during this sequence.

---

## 6. Timer Lifecycle

All cases run on the blocked page (`blocked/blocked.js`) — navigate a tab into a blocked site first, or open `blocked/blocked.html` directly for setup convenience. Open DevTools on this tab (§1.3).

Tip: For any case requiring a full phase or cycle, first set short durations in the popup (Work / Short Break / Long Break = 1 minute each, Rounds = 2) **and reload the blocked tab afterward** so it picks up the new settings on load (see `SET-06`) — this keeps multi-phase cases to a few minutes instead of the ~100-minute default cycle.

| ID | Case | Steps | Expected |
|---|---|---|---|
| `TMR-01` | Start / Pause | Click the play/pause button. | Clicking once starts the countdown (icon swaps to pause, digits tick down every second); clicking again pauses (digits freeze, icon swaps back to play) |
| `TMR-02` | Reset | Start the timer, let it run ~30s, click **Reset**. | Phase returns to `work`, round returns to 1, timer shows the full work duration, ring is full, timer is paused (not auto-started) |
| `TMR-03` | Skip | Start the timer during Work phase, click **Skip**. | Immediately advances to the next phase (Short Break, or Long Break if the round threshold was already met) per the same phase logic as natural completion — **but no completion chime plays on Skip** (only a natural countdown-to-zero plays the sound); timer starts paused after a skip |
| `TMR-04` | Full cycle + round counter/session dots | With Work/Short/Long = 1 min, Rounds = 2 (reload the tab after setting): 1. Start, let Work round 1 finish naturally. 2. Let Short Break finish. 3. Let Work round 2 finish. 4. Let Long Break finish. | After step 1: phase → Short Break, "Session 1 of 2", dot 1 shows `active` (not yet `completed` — round hasn't incremented). After step 2: phase → Work, "Session 2 of 2", dot 1 now `completed`, dot 2 `active`. After step 3: phase → Long Break (round 2 ≥ totalRounds 2), still "Session 2 of 2". After step 4: phase → Work, round resets to 1, "Session 1 of 2", dot 1 `active` again. Each natural phase-end also plays the chime (§ `TMR-08`). |
| `TMR-05` | **Background-tab timer drift (PRIMARY BUG)** | 1. Set Work Duration to at least 10 minutes (reload tab). 2. Click Start. 3. Immediately switch to a *different* tab (making the blocked tab hidden/backgrounded) and note the wall-clock time. 4. Wait **at least 5 real minutes** doing something else — do not touch the blocked tab. 5. Switch back to the blocked tab and immediately read the displayed time, without reloading. | Displayed remaining time should equal `workDuration*60 − (real elapsed seconds)`, accurate to within a few seconds. It must **not** still show close to its value from step 3 (i.e. must not look like it barely moved). Chrome throttles `setInterval` in hidden tabs to roughly once per minute, which is what broke the original counter-decrementing implementation. The timer now stores an `endsAt` epoch-ms deadline and derives the remaining time from `Date.now()` on every tick, so throttling should cost only repaint smoothness, never accuracy — this case is the direct check on that. |
| `TMR-06` | **Tab closed & reopened — elapsed must be accounted for (PRIMARY BUG)** | 1. Set Work Duration to 2 minutes (reload tab), Start the timer. 2. Close the tab entirely (not just switch away). 3. Wait 3+ real minutes (long enough the phase should have completed while closed). 4. Navigate a tab to the blocked domain again (fresh redirect) so `blocked.html` reloads from scratch. | On load, the page must **not** sit frozen at `00:00` — within at most ~1 second it should register the phase as complete: play the completion chime, and advance to the next phase (Short Break) with the correct duration loaded, matching what would have happened had the tab stayed open. If it instead shows a static `00:00` indefinitely with no phase advance, that's the bug still present. Also confirm: if the elapsed closed-time was long enough that *multiple* phases should have completed, the code as written only advances **one** phase transition on reopen (it does not fast-forward through several) — note this as current expected behavior, not something to fail the case over unless it changes. |
| `TMR-07` | Machine sleep/resume | 1. Set Work Duration to 5+ minutes, Start. 2. Put the machine to sleep (or lock/suspend) for several minutes. 3. Wake it and immediately look at the tab (still open, not reloaded). | Record what's actually displayed vs. true elapsed time — sleep suspends all JS execution including the interval, so this is a harsher version of `TMR-05`. If time is visibly stale/wrong until a manual reload, log it against the same root cause as `TMR-05`/`TMR-06`. |
| `TMR-08` | Completion chime | Let a short (1 min) Work phase run to natural completion without touching anything. | A four-note ascending chime plays via Web Audio at the moment the phase completes (the ring also does a brief pulse animation) |
| `TMR-09` | Progress ring matches remaining time | Start a timer, observe the ring at roughly 75%, 50%, 25%, and 0% remaining. | The ring's filled arc visually tracks the fraction of time remaining at each checkpoint — full ring at start, empty at `00:00`, no jumps or mismatches vs. the digital readout |
| `TMR-10` | Resume-on-reload while paused | Start, let it run a bit, click **Pause**, reload the tab. | On reload, the exact paused `timeRemaining` is restored unchanged (no time is subtracted for a paused/non-running state) and the timer stays paused |
| `TMR-11` | Stale saved state discarded (>2h) | 1. Start the timer briefly then pause it. 2. In console: `chrome.storage.local.get(["focusguard_timer_state"])`, copy the object, then `chrome.storage.local.set({focusguard_timer_state: {...copy, savedAt: Date.now() - 3*60*60*1000}})` to backdate it 3 hours. 3. Reload the tab. | The backdated state is discarded — the page falls back to a fresh default timer (Work phase, round 1, full duration) instead of restoring the stale saved values |

---

## 7. Cross-cutting

| ID | Case | Steps | Expected |
|---|---|---|---|
| `CC-01` | Offline behavior | Disable network (DevTools → Network → Offline, or disconnect Wi-Fi), then open the popup and a blocked page. | Both surfaces are **fully identical to their online appearance and behavior** — add/toggle/delete sites, run the timer, and both fonts still render correctly, because fonts are self-hosted and site avatars are generated locally. The extension makes no network requests at all, so there is nothing to degrade. Any failed request in the Network tab is a defect (see `CC-06`). |
| `CC-02` | `prefers-reduced-motion` respected | Enable "Reduce motion" at the OS level (Windows: Settings → Accessibility → Visual effects → Animation effects, off), then reload both the popup and a blocked page. | **Popup**: site-card add/remove animations and control transitions are suppressed (`popup.css` has a `prefers-reduced-motion` override). **Blocked page**: `blocked.css` now has one too — the drifting particles, phase-dot pulse, and the timer-ring completion pulse must all stop. Note the particles are not merely hidden: `createParticles()` skips generating the 20 elements entirely when `matchMedia("(prefers-reduced-motion: reduce)").matches`, so inspect the DOM and confirm `#particles` is empty rather than just visually still. |
| `CC-03` | Keyboard-only navigation (popup) | Unplug/ignore the mouse. Tab through the popup from the top: master toggle → site input → add button → each site card's toggle then delete button → settings disclosure button → all four sliders. | Every control is reachable in a sane order, has a visible focus outline, and is operable via keyboard (Enter/Space to activate buttons and toggles, Left/Right or Up/Down arrows to move sliders). The site input's Enter key specifically triggers Add (per its `keydown` handler). |
| `CC-04` | Screen-reader labels | Turn on a screen reader (Windows Narrator: `Win+Ctrl+Enter`, or NVDA). Tab through the same controls as `CC-03`. | Toggle checkboxes announce "Enable blocking for `<domain>`"; delete buttons announce "Remove `<domain>`"; the settings disclosure button announces its expanded/collapsed state (`aria-expanded`); each slider announces a human value via `aria-valuetext` (e.g. "42 minutes", "6 rounds") rather than a raw number |
| `CC-05` | **Console-cleanliness / CSP check (PRIMARY BUG regression)** | With all three consoles open (§1.3), exercise every interactive control across all three surfaces in one pass: popup (toggle, add, duplicate-reject, toggle site, delete, drag every slider, expand/collapse settings), blocked page (start, pause, reset, skip, let one full phase complete), and trigger at least one real blocking redirect. | **Zero** red console errors on any of the three surfaces across the whole pass. In particular, watch for: (a) any `Refused to execute inline event handler because it violates the following Content Security Policy directive…` — MV3's default CSP silently blocks `onclick="…"`-style attributes, and the symptom is a control that visibly does nothing when clicked, not just a console entry, so also confirm every control's *action* actually happened, not only that the console is quiet; (b) any `Cannot use import statement outside a module` or similar script-parse error, which would mean an entire surface's script failed to load — worth an explicit sanity check right after opening each surface, since a script that fails to parse doesn't run *anything*, including its DOMContentLoaded listener. |

| `CC-06` | **Self-hosted fonts / zero network requests** | Open DevTools → **Network** tab on each surface *before* opening it, with the cache disabled. 1. Open the popup. 2. Trigger a redirect to a blocked page. 3. Filter the request list by `google`. | **Zero** requests to `fonts.googleapis.com`, `fonts.gstatic.com`, or any other external host on either surface — the only entries should be `chrome-extension://` resources, including `fonts/inter-latin-var.woff2` and (on the blocked page) `fonts/orbitron-latin-var.woff2`. Then confirm rendering: popup headings and the "Blocked Sites" count render in **Inter at their intended weights** (the heading must look genuinely bolder than body text, not synthetically smeared), and the blocked page's timer digits render in **Orbitron**, not a monospace fallback. Both fonts are single variable files covering the whole weight range, so a wrong `@font-face` weight range shows up here as flat or faux-bold text. Repeat with the machine offline — appearance must be identical. |

---

## 8. Two-Tab Popup, Flip Clock & Chat Overlay (v1.1.0 UI)

Covers the v1.1.0 redesign: the popup is segmented into a **Blocklist** tab
and a **Timer** tab, the blocked page renders the countdown as a split-flap
**flip clock**, the Bao chat overlay is hidden behind a floating launcher,
and the popup's Timer tab shares one timer state with the blocked page via
`chrome.storage.local["focusguard_timer_state"]`.

| ID | Case | Steps | Expected |
|---|---|---|---|
| `UI-01` | Two-tab popup switching | 1. Open the popup. 2. Click **Timer**, then **Blocklist**, several times. 3. Close the popup on the Timer tab and reopen it. | Exactly one panel is visible at a time; content never overlaps or blanks. The tab buttons expose `role="tab"` with `aria-selected` reflecting the visible panel (inspect the DOM). The last open tab survives close/reopen (persisted in `localStorage`). Arrow Left/Right moves between the two tab buttons when one is focused. |
| `UI-02` | Popup Timer tab controls | Open the Timer tab and click Start / Pause / Skip / Reset. | The compact flip clock and phase/round readout update for every control (Start begins the countdown, Pause freezes it, Skip advances the phase, Reset restores the full work phase). All writes land in `chrome.storage.local.get(["focusguard_timer_state"])`. |
| `UI-03` | Popup → blocked page timer sync | 1. In the popup Timer tab, click **Start**. 2. Click **Open full-screen timer**. 3. Watch the new tab. | The blocked page opens already running with the same phase/remaining time the popup showed — both surfaces read the same `focusguard_timer_state` key, so control passes between them without any message passing. Pause from either surface; the other reflects it within ~1s of its next storage event/reload. |
| `UI-04` | Blocked page → popup timer sync | 1. Start the timer on the blocked page. 2. Open the popup and switch to the Timer tab while the page keeps running. | The popup flip clock shows the running countdown (live-updating via `chrome.storage.onChanged`) and its Start button reflects the running state. Pausing in the popup pauses the blocked page's timer too. |
| `UI-05` | Flip clock rendering | On the blocked page, start the timer and watch several ticks including a minute rollover (e.g. `25:00 → 24:59`, and let it reach `24:00` or set a 1–2 min work duration). | Digits render as split-flap cards in Orbitron; on each tick only the digits that actually changed flip (at `25:00 → 24:59` the minutes-tens "2" stays static while the other three flip; at a minute rollover the minute cards flip once, not once per second). No layout shift during flips, and with OS "Reduce motion" enabled the digits swap instantly with no animation. |
| `UI-06` — **chat overlay regression (PRIMARY BUG)** | Chat launcher open/close | 1. On the blocked page, confirm the timer controls are clickable immediately (no overlay covering them). 2. Click the floating 🐼 button (bottom-right). 3. Click the minimized timer strip at the top of the overlay. 4. Reopen and try the chat input. | The overlay is hidden at load; the launcher opens it (focus moves to the chat input); the timer strip closes it again. While closed, Start/Pause/Reset/Skip all respond to clicks. The timer strip keeps live-updating while the overlay is open. |
| `UI-07` | Space toggles the timer | 1. On the blocked page with nothing focused (click the background first), press **Space**. 2. Press Space again. 3. Open the chat overlay via the launcher and press Space with the chat input focused. | Steps 1–2: timer starts then pauses (same as clicking Start). Step 3: nothing happens — Space is ignored while typing in the chat input or while the overlay is open. Space also never scrolls the page. |
| `UI-08` | Escape closes the chat | Open the chat overlay via the launcher, then press **Escape**. | The overlay closes and focus returns to the launcher button. Pressing Escape while the overlay is already closed does nothing. |
| `UI-09` | Strip vs Block onboarding | 1. With an empty blocklist, open the Blocklist tab. 2. Add a site and inspect its card. 3. In the card's mode button, cycle it to `block` (friction level 3) and navigate to that domain. | The Blocklist tab shows a static hint explaining that sites start in **Strip** mode and that **Block** mode triggers the full-screen Pomodoro redirect. The new site's card shows mode `strip` by default and does **not** redirect when visited in strip mode; only after switching to `block` (level 3) does navigation redirect to the timer page. |
| `UI-10` | Minimalist theme + focus outlines | Keyboard-Tab through every control on both surfaces (see `CC-03`) and inspect the stylesheets. | Every keyboard-focused control shows a 2px outline with a 2px offset in the current phase color (shared `--focus-color` token). No surface uses hues beyond the three phase colors plus the semantic error red; the popup footer reads `FocusGuard v1.1.0`, matching `manifest.json`. |

---

## 9. Results Template

Copy this table per test pass. One row per case executed; leave rows out for cases not run this pass and say so in the summary.

| Test ID | Description | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|---|
| | | | | | |

### Per-release regression checklist

Full execution of all ~50 cases above is expensive; run this subset every release at minimum, since these are the highest-risk / previously-broken paths:

1. `TMR-05` — background-tab timer drift
2. `TMR-06` — tab closed/reopened elapsed-time accounting
3. `SET-05` — slider drag doesn't exceed storage write quota
4. `CRUD-09` — delete-two-sites-fast doesn't remove the wrong site
5. `CC-05` — console-cleanliness / CSP violation sweep across all three surfaces
6. `INST-02` — upgrade never clobbers an existing site list
7. `BLK-01`, `BLK-02`, `BLK-05` — exact match, subdomain match, and the "contains but isn't a subdomain" non-match (the core matching correctness the whole extension depends on)
8. `BLK-10`, `BLK-11` — master toggle and per-site toggle both actually gate blocking
9. `UI-06` — chat overlay must not cover the timer controls (v1.1.0 regression)
10. `UI-03`, `UI-04` — popup ↔ blocked page stay in agreement on the shared timer state

If all ten pass with a clean console, the release is safe to ship pending the rest of the suite at normal cadence (e.g. before a major version bump, or after any change touching `background.js`, `lib/matcher.js`, `lib/domain.js`, or the storage schema).
