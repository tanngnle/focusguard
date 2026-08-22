# FocusGuard Domain Model

## Glossary

**FocusGuard** - A privacy-first focus tool that combines mindful delay with surgical DOM stripping to help users break impulsive browsing habits and separate productive utility from algorithmic distraction.

**Mindful delay** - A brief breathing exercise (default 10 seconds) that interrupts the impulse to visit a distracting site. Breaks the dopamine loop and gives users a moment to choose intentionally. Inspired by one sec app (peer-reviewed, 57% reduction in app opens).

**Surgical stripping** - Selective removal of distracting UI elements (feeds, recommendations, Shorts, comments) from a platform while preserving productive functionality (search, video playback, messaging). Applied after the mindful delay if the user chooses to proceed.

**Binary blocking** - The original FocusGuard behavior: when a user navigates to a blocked domain, the extension redirects the tab to a full-screen Pomodoro timer page. Available as an escalation option for users who want stricter control.

**Friction** - Progressive psychological interventions that delay or disrupt impulsive access to distracting sites. The core innovation: delay breaks the impulse, stripping reduces doomscrolling if they proceed.

**Pomodoro timer** - A time management technique (25min work / 5min break cycles) used in binary blocking mode. Includes phase transitions, persistence, and audio notifications.

**Site** - A domain entry in the user's blocklist. Each site has a **restriction level**: `strip` (default, mindful delay + hide elements), `friction` (longer delay + confirmation), or `block` (hard redirect to timer). Users choose per site how strict they want to be.

**Restriction level** - How FocusGuard responds when a user navigates to a monitored site:
- `strip` = 10-second breathing prompt, then site loads with distracting elements hidden (default)
- `friction` = longer delay (30-60s) + intention confirmation, then stripped
- `block` = immediate redirect to Pomodoro timer page (strictest)

**Stripping profile** - A per-site configuration that specifies which UI elements to hide (feeds, recommendations, comments, etc.). Ships with pre-configured templates for major platforms (YouTube, Facebook) with individual toggles for each element.

**Lock Down** - An optional escalation mode. User starts a timed focus session (e.g., 25 min) from the popup. During the session, ALL blocklist sites use `block` mode regardless of their individual restriction levels. After the timer ends, sites revert to their base levels.

## Target Users

- **Students** - Price-sensitive, need study focus, high volume potential. Free tier covers their needs.
- **Knowledge workers / professionals** - Willing to pay for advanced features. Pro tier unlocks all platforms and customization.
- **Privacy-conscious users** - Value zero-network, local-only tools. Differentiator vs. one sec (requires account, cloud sync).

## Monetization (Freemium)

**Free tier (forever):**
- Mindful delay (10 seconds, breathing exercise)
- Basic DOM stripping (YouTube + Facebook)
- Up to 5 blocked sites
- Pomodoro timer
- Zero data logging, fully local

**Pro tier ($3.99/mo or $29.99/yr):**
- Unlimited sites
- All platforms (Reddit, LinkedIn, Twitter/X, Instagram, TikTok)
- Custom delay duration (5s-120s)
- Multiple interruption types (breathing, intention prompt, random text, 4-7-8 breathing)
- Re-intervention timer (periodic check-ins during browsing)
- Scheduling (time-based rules, e.g., block Twitter 9am-5pm weekdays)
- Lock Down mode (session-based escalation)
- Export/import settings

**Why this model:**
- Free tier builds user base (viral growth)
- Undercuts one sec ($19.99/yr) with more features
- Privacy-first = no ads, no data selling
- Power users pay for customization and advanced features

## Product Phases

- **Phase 1 (current)** - Mindful delay + surgical stripping for YouTube/Facebook + basic blocking
  - Already implemented: content scripts, stripping CSS, attribute-based toggling
  - Next: add mindful delay interstitial
  
- **Phase 2 (Pro tier)** - All platforms + advanced friction + scheduling
  - Reddit, LinkedIn, Twitter/X, Instagram, TikTok stripping
  - Custom delay durations and interruption types
  - Re-intervention timer
  - Time-based scheduling
  - Lock Down mode
  
- **Phase 3 (later)** - AI intent classification + enterprise features
  - On-device AI to classify productive vs. distracting intent
  - Enterprise anti-circumvention (optional)
  - Family co-pilot mode (separate product line)

## Architecture Decisions

- **Content script injection**: Hybrid - declarative for always-on stripping (like Unhook), programmatic for conditional friction overlays.
- **Stripping rule maintenance**: Hybrid - ship default CSS selectors with extension, allow `chrome.storage.sync` overrides for emergency fixes.
- **Friction engine placement**: Mindful delay uses interstitial page (like one sec), re-intervention uses content script overlay, binary block uses redirect.
- **Privacy**: Zero network requests. No account required. All data stays on device. Self-hosted fonts, local avatars.
- **Payment**: Honor-system license keys for Pro tier (preserves zero-network promise). Optional external payment gateway later.

## Open Decisions

- **Payment infrastructure**: Honor-system license keys vs. Chrome Web Store payments vs. external gateway (Gumroad/LemonSqueezy)
- **Stripping profile configuration UX**: Templates + toggles (pre-configured defaults with individual element enable/disable)
- **Popup UI for restriction levels**: 3-way toggle (Strip / Friction / Block) per site
- **Storage schema versioning**: Add `schemaVersion` key, migrate on `onInstalled` event, one-way migration
- **Re-intervention timer frequency**: How often to prompt during browsing sessions (configurable?)
