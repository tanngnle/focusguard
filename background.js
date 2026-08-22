/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Background Service Worker
    Intercepts navigation to blocked sites and redirects
    to the Pomodoro timer page.
    ═══════════════════════════════════════════════════════ */

import { matchSite } from "./lib/matcher.js";
import { BUILTIN_SITES, isInContentScriptScope } from "./lib/domain.js";
import { migrateStorage, CURRENT_SCHEMA_VERSION } from "./lib/storage-migration.js";

// Default settings. NOTE: focusSessionActive/focusSessionEndsAt are
// deliberately absent — the Lock Down session lives exclusively in
// chrome.storage.local (see hydration below) and must never be seeded
// into sync, where it would leak session state across devices.
const DEFAULTS = {
  enabled: true,
  sites: [],
  pomodoroSettings: {
    workDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    roundsBeforeLong: 4,
  },
  schemaVersion: CURRENT_SCHEMA_VERSION,
  proLicense: null,
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
let cache = { enabled: DEFAULTS.enabled, sites: DEFAULTS.sites, focusSessionActive: false };
// Last-seen Lock Down deadline (epoch ms). Kept alongside the cache so the
// local onChanged handler can run the expiry check even when an event only
// carries one of the two session keys.
let cacheSessionEndsAt = null;
let hydrated = false;

// A Lock Down deadline is valid only when it's a finite epoch-ms number
// still in the future. Anything else (past, null, missing, malformed)
// means an expired or corrupt session.
function isValidSessionDeadline(endsAt, now) {
  return typeof endsAt === "number" && Number.isFinite(endsAt) && endsAt > now;
}

// Clear an expired session by writing both keys back to storage.local —
// the write fires onChanged, which keeps every listener-driven cache
// (this worker's, the popup's panel) coherent with the same code path.
function clearExpiredSession() {
  return chrome.storage.local.set({ focusSessionActive: false, focusSessionEndsAt: null });
}

const ready = (async () => {
  const syncData = await chrome.storage.sync.get(["enabled", "sites"]);
  const localData = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
  if (syncData.enabled !== undefined) cache.enabled = syncData.enabled;
  if (syncData.sites !== undefined) cache.sites = syncData.sites;
  if (localData.focusSessionEndsAt !== undefined) {
    cacheSessionEndsAt = localData.focusSessionEndsAt;
  }
  if (localData.focusSessionActive === true) {
    if (isValidSessionDeadline(localData.focusSessionEndsAt, Date.now())) {
      cache.focusSessionActive = true;
    } else {
      // Service worker woke after the session deadline passed (or the
      // deadline is missing/corrupt) — expire it before any navigation
      // can observe an active Lock Down.
      cache.focusSessionActive = false;
      cacheSessionEndsAt = null;
      await clearExpiredSession();
    }
  } else if (localData.focusSessionActive !== undefined) {
    // Strict boolean coercion — a corrupt truthy non-boolean must never
    // arm enforcement (mirrors the onChanged branch below).
    cache.focusSessionActive = localData.focusSessionActive === true;
  }
  hydrated = true;
})();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync") {
    if (changes.enabled) cache.enabled = changes.enabled.newValue;
    if (changes.sites) cache.sites = changes.sites.newValue;
  }
  if (areaName === "local" && (changes.focusSessionActive || changes.focusSessionEndsAt)) {
    if (changes.focusSessionEndsAt) {
      cacheSessionEndsAt = changes.focusSessionEndsAt.newValue ?? null;
    }
    if (changes.focusSessionActive) {
      cache.focusSessionActive = changes.focusSessionActive.newValue === true;
    }
    // Same expiry gate as hydration, applied the moment a session write
    // lands. The clear-write's own onChanged echo flips the cache back
    // off through this very branch (newValue false), so no loop.
    if (cache.focusSessionActive && !isValidSessionDeadline(cacheSessionEndsAt, Date.now())) {
      cache.focusSessionActive = false;
      cacheSessionEndsAt = null;
      clearExpiredSession();
    }
  }
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
  let data = await chrome.storage.sync.get(null);
  const toSet = {};

  // ── Schema migration (v0 → v1) ──────────────────────
  // Runs once per user: converts interventionMode/frictionLevel
  // to restrictionLevel/frictionDelay and stamps schemaVersion.
  if (data.schemaVersion === undefined) {
    const migrated = migrateStorage(data);
    // Write back every key that changed
    for (const key of Object.keys(migrated)) {
      if (JSON.stringify(migrated[key]) !== JSON.stringify(data[key])) {
        toSet[key] = migrated[key];
      }
    }
    // Refresh data so the DEFAULTS backfill below sees migrated values
    data = { ...data, ...toSet };
  }

  // ── DEFAULTS backfill ───────────────────────────────
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

    // ── Lock Down override ──────────────────────────────
    // Absolute while armed: matches listed sites regardless of their
    // per-site `active` flag (product decision — Lock Down blocks ALL
    // listed sites, individual toggles notwithstanding).
    if (cache.focusSessionActive) {
      if (isValidSessionDeadline(cacheSessionEndsAt, Date.now())) {
        const lockdownSite = matchSite(
          details.url,
          cache.sites.map((site) =>
            site && site.active !== true ? { ...site, active: true } : site
          )
        );
        if (lockdownSite) {
          const lockedDownUrl = chrome.runtime.getURL("blocked/blocked.html");
          const lockdownRedirectUrl = `${lockedDownUrl}?domain=${encodeURIComponent(lockdownSite.domain)}`;
          try {
            await chrome.tabs.update(details.tabId, { url: lockdownRedirectUrl });
          } catch (err) {
            // Tab may have closed mid-navigation — nothing to redirect.
          }
        }
        return;
      }
      // The deadline passed while this worker stayed awake (webNavigation
      // events keep it alive, so hydration/onChanged never re-ran). Expire
      // it now — the storage write's onChanged echo is the same path every
      // other surface uses, and it flips this very cache back off without
      // looping (newValue false) — then fall through to per-site handling.
      cache.focusSessionActive = false;
      cacheSessionEndsAt = null;
      await clearExpiredSession();
    }

    const matchedSite = matchSite(details.url, cache.sites);
    if (!matchedSite) return;

    // Read restriction level (strip/friction/block), defending against
    // legacy entries missing the key entirely — they default to strip,
    // matching what the popup displays for them. Strip and in-scope
    // friction are delivered by the content script overlay; background
    // lets them fall through and only redirects for block.
    const restrictionLevel = matchedSite.restrictionLevel || "strip";
    if (restrictionLevel === "strip") {
      return;
    }
    if (restrictionLevel === "friction") {
      // The friction overlay only exists where the content scripts
      // inject (youtube.com / facebook.com). Anywhere else nobody would
      // ever show it, so fall back to Block instead of letting the site
      // run unrestricted.
      let hostname = null;
      try {
        hostname = new URL(details.url).hostname;
      } catch {
        hostname = null; // unparseable → treat as out of scope
      }
      if (hostname !== null && isInContentScriptScope(hostname)) {
        return;
      }
    }

    // Block mode (or friction outside the content-script scope):
    // redirect to the Pomodoro timer page.
    const blockedPageUrl = chrome.runtime.getURL("blocked/blocked.html");
    const redirectUrl = `${blockedPageUrl}?domain=${encodeURIComponent(matchedSite.domain)}`;

    try {
      await chrome.tabs.update(details.tabId, { url: redirectUrl });
    } catch (err) {
      // Tab may have closed mid-navigation — nothing to redirect.
    }
  } catch (err) {
    // Never let a malformed navigation event crash the service worker.
  }
});
