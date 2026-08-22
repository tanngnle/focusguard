---
date: 2026-08-21
repo: focusguard
branch: master
commit: aabbcb9
ticket: ""
topic: "Product Roadmap: Market Gap Analysis to Implementation Strategy"
tags: [research, codebase, product-roadmap, market-analysis, dom-manipulation, friction-engine, anti-circumvention, ai-intent, family-mode]
---

# Research: Product Roadmap — Market Gap Analysis to Implementation Strategy

**Date**: 2026-08-21
**Repo**: focusguard
**Branch**: master
**Commit**: aabbcb9

## Research Question

Given the strategic market analysis of the productivity site-blocker and parental control ecosystem, what is the current state of FocusGuard, what gaps exist between FocusGuard and market opportunities, and what should the product roadmap prioritize?

## Summary

FocusGuard v1.0.0 is a well-architected MV3 Chrome extension with **binary domain blocking + Pomodoro timer replacement**. It has strong privacy fundamentals (zero network requests, self-hosted fonts, local letter avatars) and clean module boundaries. However, it occupies only the most basic tier of the market — simple browser-bound extension with domain-level blocking — while the market research reveals **five high-value unaddressed opportunities**: surgical DOM manipulation, progressive psychological friction, context-aware AI intent, enterprise anti-circumvention, and privacy-first family co-pilot mode.

## Detailed Findings

### Current FocusGuard Architecture (v1.0.0)

**What exists today:**

| Layer | Implementation | Files |
|-------|---------------|-------|
| Navigation interception | `chrome.webNavigation.onBeforeNavigate` → redirect to timer page | `background.js:70-97` |
| Domain matching | Exact + subdomain matching, www-stripped, case-insensitive | `lib/matcher.js:31-56` |
| Domain validation | ASCII-only regex, 2+ label requirement | `lib/domain.js:13-44` |
| Pomodoro timer | Full state machine with persistence, audio, phase transitions | `lib/timer.js`, `blocked/blocked.js` |
| Popup UI | Site list management, master toggle, Pomodoro settings sliders | `popup/popup.js` |
| Storage | `sync` for settings/sites, `local` for timer state | Throughout |
| Privacy | Zero network requests, self-hosted fonts, local avatars | `manifest.json`, `popup/popup.js:253-264` |

**Architecture strengths:**
- Clean separation: 3 isolated contexts (background, popup, blocked page) communicating only via `chrome.storage`
- Hot-path cache in background.js avoids storage reads before redirect decisions
- Site mutation queue prevents race conditions on rapid toggle/delete
- Wall-clock-based timer (not interval-counting) survives background tab throttling
- Testable pure modules (`lib/`) with no chrome.* or DOM dependencies
- Comprehensive test suite with Vitest

**Architecture limitations (relative to market opportunities):**
- No content scripts → cannot do DOM manipulation on live pages
- No scheduling system → cannot do time-based blocking or recurring focus sessions
- No URL path matching → only domain-level granularity
- No friction/delay mechanism → binary redirect, no breathing prompt or intention logging
- No enterprise policy integration → trivially bypassable via chrome://extensions
- No multi-device sync beyond chrome.storage.sync's built-in profile sync

### Gap Analysis: Market Opportunities vs. Current State

#### GAP 1: Surgical DOM Manipulation (HIGH PRIORITY)

**Market signal:** Unhook has 1M+ users doing surgical YouTube element stripping. Users overwhelmingly want to separate productive utility from algorithmic distraction on multi-purpose platforms (YouTube, Reddit, LinkedIn, Twitter/X).

**Current state:** FocusGuard does binary domain blocking only. No content scripts exist. Cannot distinguish between "watching a specific tutorial" and "doomscrolling recommendations."

**What's needed:**
- Content scripts for major platforms (YouTube, Reddit, Twitter/X, LinkedIn, Instagram Web, TikTok Web)
- Pre-configured toggle templates: strip home feeds, recommendation sidebars, Shorts/Reels, comments, trending sections
- Preserve: search bars, direct messaging, specific video/content playback
- User-selectable per-site stripping profiles

**Effort estimate:** Large — requires new content script architecture, per-platform CSS/DOM selectors, maintenance burden as platforms change their DOM.

#### GAP 2: Progressive Psychological Friction (HIGH PRIORITY)

**Market signal:** one sec (backed by Max Planck Institute research) pioneered mindful delays. Users want habit-loop disruption without total bans. Re-intervention timers prevent passive doomscrolling.

**Current state:** FocusGuard does an immediate hard redirect to the timer page. No breathing exercise, no intention logging, no graduated response.

**What's needed:**
- Interstitial overlay before redirect: breathing animation, intention entry prompt
- Re-intervention timer: periodic ejection during browsing sessions on monitored sites
- Progressive friction matrix: Level 1 (mindful delay) → Level 2 (re-intervention) → Level 3 (hard block)
- Configurable per-site friction levels

**Effort estimate:** Medium — can build on existing blocked page infrastructure, needs new interstitial overlay and timing logic.

#### GAP 3: Context-Aware AI Intent Engine (MEDIUM-HIGH PRIORITY)

**Market signal:** The market research identifies a "context-aware AI intent engine" using localized small language models as a key differentiator. Evaluate user intent on navigation — grant access for productive queries, strip elements for unstructured browsing.

**Current state:** FocusGuard has no on-device AI integration. Intent classification is URL-pattern heuristics only (`lib/intent-classifier.js`).

**What's needed:**
- Integrate Chrome's Prompt API for intent classification: analyze URL + page context to determine productive vs. distracting intent
- Intent-aware routing: productive intent → allow with stripped DOM; distracting intent → apply friction or block
- Could leverage Chrome's built-in AI for on-device classification without network requests (aligns with privacy-first positioning)

**Effort estimate:** Medium — the Prompt API integration needs to be built from scratch, and intent classification prompt engineering and integration with the navigation flow need design.

#### GAP 4: Enterprise Anti-Circumvention (MEDIUM PRIORITY)

**Market signal:** Standard Chrome extensions are trivially bypassed via chrome://extensions, Incognito, or secondary browsers. Cold Turkey and DigitalZen achieve system-level enforcement but require heavy daemons. The market wants lightweight enforcement without system daemons.

**Current state:** FocusGuard has zero anti-circumvention. Users can disable the extension in one click.

**What's needed:**
- Optional lightweight installer (Windows .exe / macOS script) that applies enterprise policies
- `ExtensionInstallForcelist` policy to force-install and prevent removal
- `URLBlocklist` policy to block `chrome://extensions`, `chrome://kill`, `chrome://hang`, `chrome://flags`
- One-click setup, no heavy background daemon

**Effort estimate:** Medium — the policy files are straightforward, but building and distributing the installer executables requires platform-specific tooling.

#### GAP 5: Family Co-Pilot Mode (MEDIUM PRIORITY, LATER PHASE)

**Market signal:** Parents want privacy-first filtering. Legacy tools that scrape text messages strain parent-teen trust. Canopy's on-device computer vision approach (redacting explicit images without logging messages) is the preferred model.

**Current state:** FocusGuard is self-regulation only. No parental controls, no content filtering, no computer vision.

**What's needed:**
- On-device image scanning via TensorFlow.js or similar (no cloud processing)
- Explicit content detection and redaction before page rendering
- Device pause schedules (bedtime, homework hours)
- Multi-device management dashboard for parents
- Privacy guarantee: no image data leaves the device

**Effort estimate:** Very large — requires computer vision model integration, new UI paradigm, significant new permissions.

#### GAP 6: Scheduling & Recurring Sessions (LOW-MEDIUM PRIORITY)

**Market signal:** Freedom and FocusMe offer recurring focus sessions, scheduled blocks. Users want "set and forget" configurations.

**Current state:** FocusGuard is always-on or always-off. No scheduling.

**What's needed:**
- Time-based blocking schedules (e.g., block Twitter 9am-5pm weekdays)
- Recurring focus session schedules
- Calendar integration or preset templates (work hours, study time, etc.)

**Effort estimate:** Low-Medium — needs a scheduler module in background.js and schedule UI in popup.

### Proposed Product Tier Structure

| Tier | Target | Price | Features |
|------|--------|-------|----------|
| **Free Core** | Everyday users, students | $0 | Surgical YouTube DOM stripping, basic 1-site breathing delays, zero data logging |
| **Pro Focus** | Professionals, power users | $4.99/mo or $39.99/yr | Full AI intent engine, multi-site DOM stripping, progressive friction matrix, scheduling |
| **Pro Lifetime** | Subscription-averse | $79 one-time | All Pro features, perpetual updates, enterprise anti-bypass script |
| **Family Co-Pilot** | Parents | $6.99/mo or $59.99/yr | Local CV explicit media redaction, device pause schedules, multi-device management |

## Code References

- `background.js:70-97` — Navigation interception (needs content script registration for DOM stripping)
- `background.js:21-47` — Hot-path cache (would need schedule-aware cache for time-based blocking)
- `lib/matcher.js:31-56` — Site matching (needs URL path and pattern matching for surgical rules)
- `lib/timer.js` — Timer state machine (friction engine could wrap this with delay phases)
- `popup/popup.js:34-56` — Site mutation queue (pattern for managing stripping profiles)
- `manifest.json` — Missing: `content_scripts`, `activeTab`, `scripting` permissions needed for DOM work

## Architecture Insights

1. **Content script gap is the critical architectural missing piece.** The extension has no content scripts at all. Every high-priority feature (DOM stripping, friction overlays on live pages, intent-aware browsing) requires content script infrastructure. This should be the first architectural addition.

2. **An on-device intent engine requires new AI infrastructure.** FocusGuard ships no AI integration today; a Prompt API (Gemini Nano) layer — availability detection, session management, streaming, and fallback — would need to be built from scratch to power an intent classifier. Keeping it on-device preserves the zero-network privacy guarantee.

3. **The blocked page can evolve into a friction interstitial.** The current full-screen Pomodoro timer page can be repurposed as a progressive friction surface — adding a breathing delay layer before the timer, and a re-intervention overlay that can appear on the actual target site (via content script) during browsing.

4. **Storage schema will need versioning.** Moving from `{enabled, sites, pomodoroSettings}` to include stripping profiles, friction levels, schedules, and intent preferences requires careful migration. The existing `onInstalled` backfill pattern (`background.js:56-65`) provides a good foundation.

5. **The pure-module architecture (`lib/`) is a testing advantage.** New features (friction engine, scheduler, intent classifier, stripping rule engine) can follow the same pattern: pure logic in `lib/` with no DOM/chrome dependencies, tested with Vitest, then wired into UI contexts.

## Historical Context (from the thoughts store)

No prior research documents or historical context found in the thoughts store. This is the first research document.

## Related Research

None yet.

## Open Questions

1. **Content script architecture:** Should content scripts be injected declaratively (manifest `content_scripts` key) or programmatically (`chrome.scripting.executeScript`)? Declarative is simpler but less flexible; programmatic allows per-site stripping profiles.

2. **DOM selector maintenance:** Platform DOM structures change frequently. Should stripping rules ship with the extension (static), be updated via `chrome.storage.sync` (dynamic ruleset), or use a hybrid approach?

3. **Intent classification latency:** The Prompt API has startup latency. Can intent classification run fast enough to intercept navigation without noticeable delay? Or should it run post-load on the content script side?

4. **Monetization infrastructure:** Chrome Web Store payments vs. external payment gateway. The extension currently has zero network requests — adding payments breaks this privacy guarantee. How to reconcile?

5. **Enterprise policy distribution:** Building Windows .exe and macOS .pkg installers requires CI/CD infrastructure. Is there a simpler path (e.g., a downloadable .reg file for Windows, a shell script for macOS)?

6. **Family mode CV model:** Which on-device computer vision model? Chrome's built-in image understanding? TensorFlow.js with a pre-trained NSFW classifier? The choice affects bundle size, accuracy, and Chrome Web Store review.
