# FocusGuard Domain Model

## Glossary

**FocusGuard** — A hybrid focus tool that combines binary domain blocking with surgical DOM stripping to help users separate productive utility from algorithmic distraction on multi-purpose platforms.

**Binary blocking** — The original FocusGuard behavior: when a user navigates to a blocked domain, the extension redirects the tab to a full-screen Pomodoro timer page. All-or-nothing access control.

**Surgical stripping** — Selective removal of distracting UI elements (feeds, recommendations, Shorts, comments) from a platform while preserving productive functionality (search, video playback, messaging). The key differentiator from binary blocking.

**Friction** — Progressive psychological interventions that delay or disrupt impulsive access to distracting sites. Ranges from mindful delays (breathing exercises) to hard blocks.

**Intent classification** — Using on-device AI (Chrome Prompt API / Gemini Nano) to evaluate whether a user's navigation to a monitored site is productive or distracting, and routing accordingly.

**Bao** — The on-device AI panda personality that guilt-trips users when they try to access blocked sites. Implemented via Chrome's Prompt API with streaming responses and mood escalation.

**Pomodoro timer** — A time management technique (25min work / 5min break cycles) that replaces blocked sites. Includes phase transitions, persistence, and audio notifications.

**Site** — A domain entry in the user's blocklist. Currently identified by domain string only (e.g., "youtube.com"). Each site has an **intervention mode**: `strip` (default, hides distracting elements) or `block` (hard redirect to timer). Users toggle between modes via a switch on the site card. Future: may include URL path patterns and custom stripping profiles.

**Intervention mode** — How FocusGuard responds when a user navigates to a monitored site. `strip` = site loads with distracting elements hidden (default). `block` = hard redirect to Pomodoro timer page (escalation option). Default is `strip` to match the progressive philosophy.

**Stripping profile** — A per-site configuration that specifies which UI elements to hide (feeds, recommendations, comments, etc.). Ships with pre-configured templates for major platforms (YouTube, Reddit, LinkedIn, Twitter/X) with individual toggles for each element. Not yet implemented.

**Friction level** — The intensity of intervention for a site: Level 1 (mindful delay), Level 2 (re-intervention timer), Level 3 (hard block). Not yet implemented.

**Family co-pilot mode** — A deferred feature for parental controls using on-device computer vision to filter explicit content. Out of scope for v2.

## Target Users

- **Students** — Price-sensitive, need study focus, high volume potential
- **Knowledge workers / professionals** — Willing to pay, need surgical stripping for YouTube/LinkedIn/Reddit

## Monetization

- **Free tier** — YouTube surgical stripping only + basic blocking + Bao chat. No data logging.
- **Pro Focus** — $4.99/mo or $39.99/yr. Unlocks all platforms (Reddit, LinkedIn, Twitter/X, Instagram, TikTok) + progressive friction engine + AI intent classification + scheduling.
- **Student pricing** — Deferred. Launch without verification, add later if data supports it.

## Product Phases

- **Phase 1 (current)** — Binary domain blocking + Pomodoro timer + Bao AI chat
- **Phase 2 (next)** — Hybrid: add surgical DOM stripping + progressive friction + AI intent classification
  - Build order: Content script infrastructure → YouTube stripping prototype → Friction engine → AI intent → Scheduling → Anti-circumvention
- **Phase 3 (later)** — Family co-pilot mode (separate product line)

## Architecture Decisions

- **Content script injection**: Hybrid — declarative for always-on stripping (like Unhook), programmatic for conditional friction overlays and intent classification.
- **Stripping rule maintenance**: Hybrid — ship default CSS selectors with extension, allow `chrome.storage.sync` overrides for emergency fixes.
- **Friction engine placement**: Hybrid — Level 1 (breathing delay) uses interstitial page, Level 2 (re-intervention) uses content script overlay on live site, Level 3 (hard block) uses current redirect.
- **AI intent classification**: Hybrid — URL pattern heuristics for instant classification (80% of cases), escalate to on-device AI for ambiguous cases (runs post-load in content script).

## Open Decisions

- Privacy boundary (zero-network vs pragmatic)
- **Stripping profile configuration UX**: Templates + toggles (pre-configured defaults with individual element enable/disable)
- **Popup UI for intervention mode**: Default = strip, toggle switch to escalate to block
- **Storage schema versioning**: Add `schemaVersion` key, migrate on `onInstalled` event, one-way migration
