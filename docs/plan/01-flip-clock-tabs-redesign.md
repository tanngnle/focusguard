# MindfulBrowse — Flip Clock Redesign, Timer Fix & Popup Tabs

> Feature branch: `feature/pomodoro-improvements`
> Status: Approved plan (synthesized from 3 independent research passes: simplicity, performance, minimal-change)

## Summary

Three independent research passes converged on one confirmed root cause: **the Bao panda chat overlay permanently covers the blocked page** (`.chat-overlay` at `blocked/blocked-chat.css:8-18` is `position:fixed; inset:0; z-index:100; display:flex` with **no close mechanism anywhere**), so the Start/Pause/Reset/Skip buttons never receive clicks — the timer engine itself (`lib/timer.js`) is correct. The plan fixes that bug, replaces the SVG ring with a reusable flip-clock component, unifies the two divergent color palettes into one minimalist token sheet, and restructures the popup into a two-tab UI with a live Timer tab.

**Work setup (before coding):** all implementation happens on branch/worktree `feature/pomodoro-improvements`. Project constraints from `AGENTS.md`: vanilla JS, **no build step**, **zero network requests** (no new `<link>`, `fetch`, or remote assets), tests via Vitest, lint via ESLint.

## Verified Root Cause

- `blocked/blocked.html:104-125` — `<div class="chat-overlay" id="chat-overlay">` rendered unconditionally on every load.
- `blocked/blocked-chat.css:8-18` — full-viewport, near-opaque layer at `z-index:100`; `.main-container` (timer + controls) sits at `z-index:1` (`blocked.css:137-147`).
- No JS or CSS anywhere hides, opens, or toggles the overlay. `#btn-start` handler is correctly wired (`blocked.js:112`) but unreachable. Regression introduced by commit `aabbcb9` (panda chat feature).
- Pre-existing unrelated test failure: `tests/popup/popup.test.js:228` ("rapid-succession toggle"), plus a debug `console.log` at line 224 — fix as part of this work.

## Phase A — Fix the timer bug (gates everything)

Files: `blocked/blocked-chat.css`, `blocked/blocked.html`, `blocked/blocked-chat.js`, new `tests/blocked/blocked.test.js`

1. **Hide overlay by default**: change `.chat-overlay` to `display:none`; add `.chat-overlay.open { display:flex }` (keep existing fade-in animation).
2. **Add launcher**: one floating `#chat-launcher` button (🐼 "Talk to Bao") in `blocked.html` after the overlay div, styled with existing tokens, ≥44px touch target, `aria-label`.
3. **Add close path**: in `blocked-chat.js` (~20 lines, no AI-logic changes): launcher click adds `.open`; clicking `#timer-strip` (already `cursor:pointer`, `blocked-chat.css:40`) removes `.open`. No state persisted.
4. **Regression tests**: new `tests/blocked/blocked.test.js` using `mountBlockedDom()`/`fireDomContentLoaded()` from `tests/helpers/dom-fixture.js` + `vi.useFakeTimers()`: (a) overlay hidden at load and `#btn-start` reachable; (b) clicking Start advances `#timer-digits` after a 1s tick; (c) pause/reset/skip behavior; (d) launcher opens and strip closes the overlay.
5. **Fix pre-existing failure**: repair the mutation race in `queueSiteMutation` (`popup/popup.js:47-58`) and remove the debug `console.log` (`tests/popup/popup.test.js:224`) until the suite is 100% green.

## Phase B — Flip clock (presentation-only over the verified engine)

Files: `blocked/blocked.html`, `blocked/blocked.js`, `blocked/blocked.css`, new `lib/flip-clock.js`, new `lib/flip-clock.css`

6. **Shared flip-clock module** `lib/flip-clock.js` (pure DOM, no chrome deps — matches existing `lib/` pattern): builds per-digit cards with top/bottom halves + colon separators; exposes `setTime("MM:SS")` that **diffs digits and only animates changed ones** (minute digits flip once per 60 ticks). `lib/flip-clock.css`: CSS-only `rotateX` flips, `backface-visibility:hidden`, **transform/opacity only** (no layout properties), fixed-size digit cells (no reflow), Orbitron font, `prefers-reduced-motion` fallback to instant text swap.
7. **Wire into blocked page**: inside `.timer-display` (`blocked.html:53-56`) add the flip-clock markup; **keep `#timer-digits` in DOM as `aria-hidden` source of truth** — it backs `window.__MindfulBrowseTimer.getDisplay()` (`blocked.js:488-497`, consumed by `blocked-chat.js:137`) and the a11y path via `#timer-sr-status`. Extend `renderTime()` (`blocked.js:304-308`) to call `flipClock.setTime(formatTime(secs))` while keeping `timerDigits.textContent` writes exactly as today.
8. **SVG ring**: hide via CSS (keep code, zero-risk) or remove `updateRing`/`RING_*` — implementer may choose; if kept hidden, leave a thin linear progress bar for phase progress. Preserve the `--phase-color` indirection (`blocked.css:16-17`) so body `phase-*` theming still works.
9. **Timer strip** (`blocked-chat.js:92-145`): keep as plain text readout (already mirrors `getDisplay()`); delete nothing structural — it must keep live-updating while the overlay is open.

## Phase C — Minimalist unified color scheme

Files: new `shared/theme.css`, `blocked/blocked.css`, `popup/popup.css`, `blocked/blocked-chat.css`, `blocked/breathing.html`

10. **Single token sheet** `shared/theme.css` (local `<link>`, buildless): near-black base (reuse `--bg-dark: #08080f`), off-white text (`--text-primary: #e8e8f0`), one neutral surface, keep the three phase colors (`--work-color/--short-break-color/--long-break-color`) as the **only** accent hues, reduced glow/shadow values, spacing/radius/typography scale. This replaces the two divergent palettes (`blocked.css:6-27` vs `popup.css:6-18`).
11. **Re-theme surfaces**: point both `:root` blocks at shared tokens; neutralize decorative excess (lower blob/particle opacity to ~0 via CSS only — `createParticles()` JS can stay); re-map site avatar letter hues (`popup.js:255-266`) into the minimalist palette. Verify no remote assets added (`grep http` on touched files).

## Phase D — Popup segmented into two tabs

Files: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `lib/timer.js`

12. **Tab structure — preserve every existing element ID verbatim** (the 15 popup tests mount the real `popup.html` and assert by ID: `master-toggle-input`, `site-input`, `add-site-btn`, `input-hint`, `sites-list`, `site-count`, `empty-state`, 4 sliders, 4 value labels). Insert `<nav role="tablist">` after the header with `#tab-btn-sites` ("Blocklist") and `#tab-btn-timer` ("Timer"); wrap `add-site-section` + `sites-list-section` in `role="tabpanel" id="tab-panel-sites"` and `settings-section` in `role="tabpanel" id="tab-panel-timer"`. Header + master toggle stay outside the tabs (global controls).
13. **Timer control in popup**: extract pure state-transition helpers (`start(state, now)`, `pause(state, now)`, `reset(settings)`, `skip(state, now)`) from the start/pause/skip math in `blocked.js:157-213` into `lib/timer.js` (keep functions pure, `now` as param — existing convention; existing 34 model tests must stay green). Popup Timer tab reads/writes `chrome.storage.local["MindfulBrowse_timer_state"]` (contract already defined at `blocked.js:15`, written by `saveState()` at `blocked.js:387-398`) **serialized through a mutation queue** (reuse the `queueSiteMutation` pattern); live updates via the `chrome.storage.onChanged` listener already present (`popup.js:119`). Render a compact flip-clock instance (same `lib/flip-clock.js`, scaled via CSS custom property), Start/Pause/Skip/Reset buttons, phase + session dots, and the existing settings sliders. Add "Open full-screen timer" button → `chrome.tabs.create({ url: chrome.runtime.getURL("blocked/blocked.html") })` (no new permission needed; page is already `web_accessible_resources`).
14. **Blocked page consumes the same helpers**: refactor `blocked.js` callsites to use the extracted `lib/timer.js` transitions (behavior-identical; covered by existing + new tests).
15. **Tab behavior**: toggle `hidden` + `aria-selected`; ArrowLeft/Right keyboard navigation; persist last tab in `localStorage`; guard all new JS behind element-existence checks so partial fixtures can't crash.
16. **Responsive popup CSS**: fluid widths (Chrome controls popup width), `minmax` grid for site cards, ≥44px touch targets, container-width behavior for narrow popups; no fixed panel heights.

## Phase E — UX polish & docs

17. Consistent `:focus-visible` outlines and ARIA across popup + blocked page; Space toggles timer on blocked page (guarded against input focus).
18. **Default-intervention clarity** (UX gap found in research: new sites default to `interventionMode:"strip"` at `popup.js:219` and never redirect to the timer page, `background.js:87-92`): keep the `strip` default (product design — do not silently change) but add an onboarding hint/empty-state note in the Blocklist tab explaining Strip vs Block modes and how the Pomodoro page is reached.
19. Update `docs/QA-TEST-PLAN.md` with new flip-clock/tab scenarios; update `README.md` screenshots/UI description; bump `manifest.json` version; keep `docs/adr/` convention if any decision warrants an ADR.

## Dependencies

- A gates everything (page untestable behind overlay). Step 5 independent.
- B depends on A (same files); step 6 gates 7; 9 after 7.
- C depends on B (markup settled before retheme); step 10 gates 11.
- D is mostly independent of B/C except shared tokens; **step 13's `lib/timer.js` extraction must land before both popup wiring (13) and blocked.js refactor (14)**.
- E last. Recommended order: A → B → D → C → E (each phase independently shippable/testable).

## Test Plan

- Full suite green after each phase: `npx vitest run` (target 100% — including the currently failing popup race test fixed in A5) and `npx eslint .`.
- New `tests/blocked/blocked.test.js` regression coverage (A4) — the bug went undetected precisely because `blocked.js` had zero tests.
- New unit tests for the extracted `lib/timer.js` transitions and flip-clock digit diffing.
- Manual/loaded-extension check: add a site in Block mode → navigate → timer starts, flips, pauses, survives popup↔page control handoff via storage.
- Final **Browser E2E verification** of popup tabs + blocked page before delivery; **3 parallel CodeReview passes** (completeness / correctness / impact) before completion.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Popup tests break on ID changes | Preserve all existing IDs verbatim; wrap sections instead of replacing; guard new JS |
| `getDisplay()` consumer breaks | Keep `timerDigits.textContent` writes unchanged; flip cards are additive siblings |
| Popup + blocked page race on shared timer state | Serialized mutation queue on all writes; blocked page treats `storage.onChanged` as authority |
| Flip animation jank | Transform/opacity-only CSS, fixed cell sizes, animate only changed digits, `prefers-reduced-motion` fallback |
| Hiding Bao regresses the chat feature | Launcher button keeps Bao one click away; AI init code untouched |
| Offline guarantee broken | All art pure CSS; fonts already self-hosted; grep for remote URLs in touched files |
| Pre-existing failing test muddies verification | Fixed explicitly in A5; documented as pre-existing on clean HEAD |

## Rejected Alternatives

- **`chrome.alarms` background-owned timer + new `lib/timer-store.js` + heartbeat removal** (performance plan): robust for out-of-tab timing but adds an `alarms` manifest permission, service-worker phase-advance logic, and large `blocked.js` refactor — disproportionate risk for this iteration; deadline-based `endsAt` already keeps displayed time correct after tab close. Defer to a future hardening ticket.
- **Read-only timer status card in popup** (minimal plan): safest, but the user explicitly asked for a tab "to start the pomodoro timers" — full controls are required.
- **Deleting the panda overlay entirely**: regresses the Bao feature; hidden-by-default + launcher restores the timer while keeping Bao reachable.
- **Changing the default intervention mode from `strip` to `block`**: silently changes product behavior for all new sites; instead, clarify via onboarding hint (E18).
