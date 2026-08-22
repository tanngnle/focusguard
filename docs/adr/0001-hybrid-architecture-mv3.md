# ADR-0001: Hybrid Architecture for MV3 Chrome Extension

## Status

Accepted

## Context

MindfulBrowse v1.0.0 uses binary domain blocking with no content scripts. The product roadmap requires adding surgical DOM stripping, progressive friction, and AI intent classification. Each feature has different injection requirements:

- **Stripping** needs to run on every page load for monitored platforms (always-on)
- **Friction overlays** need to appear conditionally based on user behavior (on-demand)
- **Intent classification** needs to run post-load for ambiguous cases (conditional)

Three approaches were considered:
1. Pure declarative (`manifest.json` `content_scripts`) — simple but runs on every page
2. Pure programmatic (`chrome.scripting.executeScript`) — flexible but requires service worker coordination
3. Hybrid — declarative for always-on, programmatic for conditional

## Decision

Adopt a **hybrid architecture**:

- **Declarative content scripts** for surgical stripping (like Unhook). Injected via `manifest.json`, runs automatically on matched domains. Reliable, no service worker dependency.
- **Programmatic injection** for friction overlays and intent classification. Triggered by background worker based on user behavior and AI classification results.

Additionally:
- **Stripping rules**: Ship default CSS selectors with extension, allow `chrome.storage.sync` overrides for emergency fixes
- **Friction placement**: Level 1 (breathing) = interstitial page, Level 2 (re-intervention) = content script overlay, Level 3 (hard block) = current redirect
- **Intent classification**: URL pattern heuristics for instant decisions (80%), on-device AI for ambiguous cases (20%)

## Consequences

### Positive
- Stripping is reliable and fast (no service worker wake-up latency)
- Friction and intent classification are flexible and conditional
- Matches proven approach (Unhook uses declarative for 1M+ users)
- Preserves zero-network constraint (no remote rule fetching)

### Negative
- Two injection mechanisms to maintain
- Programmatic injection requires `scripting` permission
- Service worker must coordinate with content scripts for conditional features
- More complex than pure declarative approach

### Risks
- MV3 service worker lifecycle may cause coordination issues (worker sleeps between events)
- Content script + background worker message passing adds complexity
- CSS selector maintenance burden as platforms update their DOM

## References

- Unhook extension (1M+ users): uses declarative content scripts for YouTube stripping
- Chrome MV3 documentation: content scripts vs programmatic injection
- MindfulBrowse wayfinder ticket #2: Content script injection strategy
