---
date: 2026-08-22
repo: MindfulBrowse
branch: master
commit: (updated)
ticket: ""
topic: "Product Roadmap: Mindful Delay + Strip Flow and Freemium Monetization"
tags: [research, product-roadmap, monetization, mindful-delay, freemium, privacy-first]
---

# Research: Product Roadmap - Mindful Delay + Strip Flow and Freemium Monetization

**Date**: 2026-08-22 (updated)
**Repo**: MindfulBrowse

## Executive Summary

MindfulBrowse will adopt a **Mindful Delay + Strip** flow (inspired by one sec's peer-reviewed model) combined with a **Freemium** monetization strategy. This positions MindfulBrowse as the privacy-first, free alternative to one sec with superior DOM control.

## Market Validation

### one sec (Market Leader)
- **100K+ 5-star reviews** on App Store
- **Peer-reviewed research** (Max Planck Institute): 57% reduction in app opens
- **Pricing**: $19.99/year for premium features
- **Weaknesses**: Requires account, cloud sync, no DOM stripping, weak browser extension

### User Feedback (Reddit r/nosurf, r/digitalminimalism)
- "Strict blocking doesn't work—social media is embedded in life. One Sec forces a pause to think."
- "I set mine to where the apps I want to block take over 30-60 seconds before loading"
- "The forced pause is critical to be able to consciously make the choice"

### Key Insight
Users don't want binary block/unblock. They want **a spectrum of control** that breaks impulses without removing agency.

---

## Decision 1: Mindful Delay + Strip Flow

### The Flow

```
User clicks blocked site link
         |
         v
  Mindful delay interstitial (10s breathing)
         |
         v
  "Still want to go?" -> Yes
         |
         v
  Site loads with elements stripped
  (sidebar, comments, feeds hidden)
```

### Why This Works

1. **Delay breaks the dopamine loop** - one sec's research shows 57% reduction in opens
2. **Stripping reduces doomscrolling** - if they proceed, distractions are hidden
3. **User retains agency** - not a hard block, they can still access the site
4. **Two layers of protection** - impulse + environment

### Restriction Levels

| Level | Delay | After Delay | Use Case |
|-------|-------|-------------|----------|
| **Strip** (default) | 10s breathing | Site loads stripped | Most sites |
| **Friction** | 30-60s + intention prompt | Site loads stripped | High-risk sites |
| **Block** | None | Redirect to timer | Sites to avoid completely |

### Lock Down Mode (Optional Escalation)

User can start a timed focus session (e.g., 25 min) from the popup. During the session:
- ALL blocklist sites use Block mode regardless of individual settings
- After timer ends, sites revert to base levels

---

## Decision 2: Freemium Monetization

### Free Tier (Forever)

- Mindful delay (10 seconds, breathing exercise)
- Basic DOM stripping (YouTube + Facebook)
- Up to 5 blocked sites
- Pomodoro timer
- Zero data logging, fully local

### Pro Tier ($3.99/mo or $29.99/yr)

- Unlimited sites
- All platforms (Reddit, LinkedIn, Twitter/X, Instagram, TikTok)
- Custom delay duration (5s-120s)
- Multiple interruption types (breathing, intention prompt, random text, 4-7-8 breathing)
- Re-intervention timer (periodic check-ins during browsing)
- Scheduling (time-based rules)
- Lock Down mode
- Export/import settings

### Why This Model

1. **Free tier builds user base** - viral growth, low barrier
2. **Undercuts one sec** - $29.99/yr vs $19.99/yr but with more features
3. **Privacy-first** - no ads, no data selling
4. **Power users pay** - customization and advanced features

### Revenue Projection

Conservative estimate (Year 1):
- 100K free users (achievable with Chrome Web Store + word of mouth)
- 5% conversion to Pro = 5K paying users
- 5K × $30/yr = **$150K ARR**

---

## Competitive Positioning

| Feature | MindfulBrowse | one sec | Unhook |
|---------|-----------|---------|--------|
| Mindful delay | Yes (10s) | Yes (various) | No |
| DOM stripping | Yes | No | Yes (YouTube only) |
| Privacy (zero-network) | Yes | No (requires account) | Yes |
| Price | Free core, $3.99/mo Pro | $19.99/yr | Free |
| Platforms | YouTube, Facebook (more coming) | All apps | YouTube only |
| Per-site granularity | Yes | No (same delay for all) | Yes |

**Unique Value Proposition:**
"The privacy-first, free alternative to one sec with better DOM control."

---

## Implementation Phases

### Phase 1 (Current) - MVP

**Already implemented:**
- Content script infrastructure
- Stripping CSS for YouTube/Facebook
- Attribute-based toggling
- Pomodoro timer

**Next steps:**
1. Create mindful delay interstitial page
2. Wire up navigation flow: intercept -> interstitial -> stripped page
3. Add breathing animation (CSS-only, no external assets)
4. Update popup UI: 3-way restriction level selector

**Timeline:** 2-3 weeks

### Phase 2 (Pro Tier) - Monetization

1. Add more platforms (Reddit, LinkedIn, Twitter/X)
2. Custom delay durations
3. Multiple interruption types
4. Re-intervention timer
5. Scheduling system
6. License key system (honor-based initially)

**Timeline:** 4-6 weeks

### Phase 3 (Later) - Advanced Features

1. AI intent classification (on-device, Chrome Prompt API)
2. Enterprise anti-circumvention
3. Family co-pilot mode

**Timeline:** TBD

---

## Architecture Changes

### New Components

1. **Interstitial page** (`blocked/interstitial.html`)
   - Breathing animation
   - Countdown timer
   - "Still want to go?" button (disabled until timer ends)
   - Optional: intention text input (for Friction level)

2. **Updated background.js**
   - Check restriction level instead of intervention mode
   - Route to interstitial for Strip/Friction
   - Route to timer page for Block
   - Check focusSessionActive for Lock Down mode

3. **Updated popup UI**
   - 3-way toggle: Strip / Friction / Block
   - Delay duration slider (for Friction)
   - Lock Down panel at top of Blocklist tab

### Storage Schema Updates

```javascript
sites: [
  {
    domain: "youtube.com",
    active: true,
    restrictionLevel: "strip",  // NEW: was interventionMode
    frictionDelay: 10,          // NEW: seconds
    strippingProfile: { ... }
  }
]

focusSessionActive: false,      // NEW: Lock Down flag
focusSessionEndsAt: null,       // NEW: timestamp
proLicense: null,               // NEW: license key
```

### Migration Path

- `interventionMode: "strip"` -> `restrictionLevel: "strip"`
- `interventionMode: "block"` -> `restrictionLevel: "block"`
- `frictionLevel: 1` -> `restrictionLevel: "friction"`, `frictionDelay: 10`
- `frictionLevel: 2, 3` -> `restrictionLevel: "block"`

---

## Open Questions

1. **Payment infrastructure**: Honor-system license keys vs. Chrome Web Store payments vs. external gateway (Gumroad/LemonSqueezy)?
   - Recommendation: Start with honor-system to preserve zero-network promise
   
2. **Re-intervention timer frequency**: How often to prompt during browsing sessions?
   - Recommendation: Configurable, default 15 minutes
   
3. **Breathing animation**: CSS-only vs. lightweight JS?
   - Recommendation: CSS-only (no external assets, preserves privacy)

4. **Chrome Web Store description**: How to position vs. one sec?
   - Recommendation: "Privacy-first alternative to one sec with DOM stripping"

---

## Related Documents

- `CONTEXT.md` - Updated domain model with new terms
- `docs/plan/flow-design.md` - Detailed flow diagrams
- `docs/adr/0001-hybrid-architecture-mv3.md` - Architecture decisions

## References

- one sec app: https://one-sec.app/
- one sec research: https://one-sec.app/research/
- Session app: https://www.stayinsession.com/
- Reddit r/nosurf: https://www.reddit.com/r/nosurf/
