# ADR-0002: Shared Timer State Contract Between Popup and Blocked Page

## Status

Accepted

## Context

Before v1.1.0, the Pomodoro timer ran only on the blocked page (`blocked/blocked.js`), and `chrome.storage.local["MindfulBrowse_timer_state"]` was a persistence detail of that single surface. The v1.1.0 popup redesign adds a **Timer tab** with full controls (Start / Pause / Skip / Reset) and its own flip-clock readout, giving the same timer **two writers and two readers** in two isolated contexts. MV3 forbids message passing shortcuts we'd otherwise reach for (no persistent ports between popup and extension pages worth the wiring), and the repo's standing convention is that contexts communicate only through `chrome.storage`.

Two risks had to be addressed:

- **Write races**: both surfaces do read-modify-write cycles against one key; two rapid controls (e.g. Start then Skip) in either surface must not clobber each other.
- **Stale views**: whichever surface is open must reflect changes made in the other without polling.

## Decision

Keep a **single shared state object** in `chrome.storage.local["MindfulBrowse_timer_state"]` and make storage the only communication channel:

- **Shape**: the timer state fields (`phase`, `currentRound`, `totalRounds`, `totalTime`, `isRunning`, `endsAt`, `remaining`) plus `savedAt` (epoch ms). All phase math goes through the pure transitions in `lib/timer.js` (`start`, `pause`, `reset`, `skip`) so both surfaces compute identically.
- **Deadline-based timing**: `endsAt` is the source of truth while running; `remaining` only while paused. A revived session derives its display from `Date.now()`, so neither surface needs to trust the other's tick cadence. If a deadline expires while a surface is open, that surface's ticker runs the completion transition; if a restored state's deadline already passed, it is advanced exactly one phase.
- **Serialized writes**: every write in each surface goes through a promise-chain mutation queue (`queueTimerMutation` in the popup, `saveState()` call sites in the blocked page), mirroring the `queueSiteMutation` pattern used for the sites array.
- **`chrome.storage.onChanged` is authority**: each surface treats external changes to the key (area `local`) as ground truth, re-renders, and re-arms/disarms its ticker+heartbeat to match. Self-triggered events are suppressed **by value** — an event is skipped only when its `savedAt` equals the one the surface itself last wrote, so a concurrent external write is never swallowed by a bare boolean flag. Restore applies the same rules on both surfaces: the 2-hour staleness gate (`STALE_MS` / `isStateFresh`) and the revival logic (`reviveState`) live in `lib/timer.js` so the popup and the blocked page cannot drift.

## Consequences

### Positive
- No new permissions and no message passing — the contract rides entirely on the existing `storage` permission.
- Control handoff works both directions (start in popup → continue full-screen, and vice versa) with zero extra protocol.
- Both surfaces already had `storage.onChanged` listeners, so live sync was nearly free.

### Negative
- The key's shape is now a two-consumer contract: any field change must be made in `lib/timer.js` and verified against both surfaces' tests.
- Timing accuracy still depends on whichever surface is alive; when **both** the popup and the blocked tab are closed, nothing ticks (deadline revival on next open keeps the displayed time correct, matching the rejected `chrome.alarms` alternative in `docs/plan/01-flip-clock-tabs-redesign.md`).
