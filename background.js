/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Background Service Worker
    Intercepts navigation to blocked sites and redirects
    to the Pomodoro timer page.
    ═══════════════════════════════════════════════════════ */

import { matchSite } from "./lib/matcher.js";
import { getFrictionConfig } from "./lib/friction-rules.js";
import { BUILTIN_SITES } from "./lib/domain.js";

// Default settings
const DEFAULTS = {
  enabled: true,
  sites: [],
  pomodoroSettings: {
    workDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    roundsBeforeLong: 4,
  },
};

// ── Hot-Path Cache ──────────────────────────────────────
// The navigation listener below runs on every top-frame navigation
// and must not `await` storage before deciding whether to redirect
// (that would let the distracting page start loading first). We
// keep `enabled`/`sites` mirrored here and refresh them reactively
// via chrome.storage.onChanged instead.
//
// MV3 service workers are killed and restarted between events, so
// this hydration runs at module top level — every time the worker
// wakes up — rather than only in onInstalled/onStartup. `ready`
// is awaited as a one-time fallback if a navigation arrives before
// the initial read completes.
let cache = { enabled: DEFAULTS.enabled, sites: DEFAULTS.sites };
let hydrated = false;

const ready = (async () => {
  const data = await chrome.storage.sync.get(["enabled", "sites"]);
  if (data.enabled !== undefined) cache.enabled = data.enabled;
  if (data.sites !== undefined) cache.sites = data.sites;
  hydrated = true;
})();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.enabled) cache.enabled = changes.enabled.newValue;
  if (changes.sites) cache.sites = changes.sites.newValue;
});

/**
 * Initialize storage with defaults on install/upgrade.
 * Merges per-key so an existing `sites` array (or any other
 * existing value) is never clobbered — only keys that are
 * genuinely missing get backfilled, including new DEFAULTS keys
 * introduced in a later version.
 *
 * Also seeds built-in sites (YouTube, Facebook) into the sites
 * array. Existing user-added sites are preserved; built-in sites
 * are only added if not already present (by domain).
 */
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get(null);
  const toSet = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (data[key] === undefined) toSet[key] = DEFAULTS[key];
  }

  // Seed built-in sites — merge with existing sites, skip duplicates
  const existingSites = data.sites || toSet.sites || [];
  const existingDomains = new Set(existingSites.map((s) => s.domain));
  const newBuiltins = BUILTIN_SITES.filter((s) => !existingDomains.has(s.domain));
  if (newBuiltins.length > 0) {
    toSet.sites = [...existingSites, ...newBuiltins];
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
});

/**
 * Intercept navigation events and redirect blocked sites
 */
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  try {
    // Only intercept top-level navigations (not iframes, etc.)
    if (details.frameId !== 0) return;

    // Cold-start fallback: the service worker may have just woken
    // up and not finished its initial storage read yet.
    if (!hydrated) await ready;

    // If blocking is globally disabled, do nothing
    if (!cache.enabled) return;

    const matchedSite = matchSite(details.url, cache.sites);
    if (!matchedSite) return;

    // Determine intervention mode (strip vs block)
    const interventionMode = matchedSite.interventionMode || "strip";

    // If in strip mode, don't redirect — let content script handle it
    if (interventionMode === "strip") {
      return;
    }

    // Get friction level (default to 3 for backward compatibility)
    const frictionLevel = matchedSite.frictionLevel || 3;
    const frictionConfig = getFrictionConfig(frictionLevel);

    let redirectUrl;

    if (frictionConfig.type === "interstitial") {
      // Level 1: Breathing delay
      const breathingPageUrl = chrome.runtime.getURL("blocked/breathing.html");
      redirectUrl = `${breathingPageUrl}?domain=${encodeURIComponent(matchedSite.domain)}&delay=${frictionConfig.delaySeconds}`;
    } else {
      // Level 3: Hard block (redirect to Pomodoro timer)
      const blockedPageUrl = chrome.runtime.getURL("blocked/blocked.html");
      redirectUrl = `${blockedPageUrl}?domain=${encodeURIComponent(matchedSite.domain)}`;
    }

    try {
      // Use chrome.tabs.update to redirect
      await chrome.tabs.update(details.tabId, { url: redirectUrl });
    } catch (err) {
      // Tab may have closed mid-navigation — nothing to redirect.
    }
  } catch (err) {
    // Never let a malformed navigation event crash the service worker.
  }
});
