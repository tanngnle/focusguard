/*  ══════════════════════════════════════════════════════
    FocusGuard — Content Script (Stripping)
    Injected declaratively on YouTube and Facebook pages.
    Hides distracting UI elements based on user's stripping
    profile from chrome.storage.sync.

    Key design decisions (learned from Unhook extension):
    - Runs at document_start so styles are injected before
      the page renders (no flash of distracting content).
    - Selectors are cached after the first storage read so
      DOM mutations don't trigger repeated async I/O.
    - Listens to YouTube's yt-page-data-updated event for
      reliable SPA navigation detection.
    ═══════════════════════════════════════════════════════ */

import { getStrippingRules, getDefaultProfile } from "../lib/stripping-rules.js";

// ── Cached State ────────────────────────────────────────
// After the first successful storage read we keep the
// resolved selectors in memory.  DOM mutations and SPA
// navigation can then re-inject styles synchronously —
// no repeated chrome.storage.sync.get() calls.

let cachedSelectors = null;
let cachedHostname = null;
let cachedInterventionMode = null;

// ── Style Injection ─────────────────────────────────────
// Creates a <style> element with display:none rules for
// all matching selectors. Single style element, not per-
// selector, to minimize DOM footprint.

function injectStrippingStyles(selectors) {
  if (!selectors || selectors.length === 0) return;

  const style = document.createElement("style");
  style.id = "focusguard-stripping-styles";
  style.textContent = selectors
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");

  // Insert at the end of <head> to override platform styles
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(style);
  }
}

// ── Remove Existing Styles ──────────────────────────────
// Removes any previously injected FocusGuard styles so
// profile changes take effect immediately.

function removeStrippingStyles() {
  const existing = document.getElementById("focusguard-stripping-styles");
  if (existing) {
    existing.remove();
  }
}

// ── Re-apply Cached Styles ──────────────────────────────
// Fast path: re-inject already-resolved selectors without
// touching storage.  Used by the MutationObserver and the
// YouTube SPA navigation handler.

function reapplyCachedStyles() {
  if (cachedInterventionMode !== "strip") {
    removeStrippingStyles();
    return;
  }
  if (!cachedSelectors || cachedSelectors.length === 0) return;

  removeStrippingStyles();
  injectStrippingStyles(cachedSelectors);
}

// ── Resolve Selectors from Storage ──────────────────────
// Reads the stripping profile from storage, resolves the
// CSS selectors, and caches them for future re-application.
// Falls back to the default profile (all elements hidden)
// if no profile is stored or the storage read fails.

async function resolveAndApplyStripping() {
  const hostname = window.location.hostname;

  try {
    const data = await chrome.storage.sync.get(["sites"]);
    const sites = data.sites || [];

    // Find the site entry for this domain
    const site = sites.find((s) => {
      const siteDomain = s.domain.replace(/^www\./, "").toLowerCase();
      const currentDomain = hostname.replace(/^www\./, "").toLowerCase();
      return (
        siteDomain === currentDomain ||
        currentDomain.endsWith("." + siteDomain)
      );
    });

    // Check intervention mode
    const interventionMode = site?.interventionMode || "strip";

    // Cache the intervention mode so reapplyCachedStyles
    // can short-circuit when the user switches to block mode.
    cachedInterventionMode = interventionMode;

    if (interventionMode !== "strip") {
      removeStrippingStyles();
      return;
    }

    // Get stripping profile (use stored profile or default)
    const profile = site?.strippingProfile || getDefaultProfile(hostname);
    const selectors = getStrippingRules(hostname, profile);

    // Cache for fast re-application
    cachedHostname = hostname;
    cachedSelectors = selectors;

    removeStrippingStyles();
    injectStrippingStyles(selectors);
  } catch (err) {
    // Storage read failed — apply default profile as fallback
    const profile = getDefaultProfile(hostname);
    const selectors = getStrippingRules(hostname, profile);

    cachedInterventionMode = "strip";
    cachedHostname = hostname;
    cachedSelectors = selectors;

    removeStrippingStyles();
    injectStrippingStyles(selectors);
  }
}

// ── Debounce Helper ─────────────────────────────────────
// The MutationObserver fires on every DOM change.  During
// YouTube's initial page build this can be hundreds of
// mutations per second.  Debouncing keeps re-application
// to once per animation frame at most.

function createDebounced(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Initialization ──────────────────────────────────────
// 1. Resolve selectors from storage and inject styles.
//    At document_start the DOM is still empty, so this is
//    purely a storage read + cache population.  The styles
//    will be injected as soon as <head> exists.
// 2. Observe DOM mutations for SPA navigation — re-apply
//    cached styles when YouTube replaces page content.
// 3. Listen for YouTube's own SPA navigation event.
// 4. Listen for storage changes (profile updates from popup).

resolveAndApplyStripping();

// Observe DOM mutations for SPA navigation.
// Re-applies cached styles (no storage read) when the DOM
// changes significantly — e.g. YouTube replacing #contents
// during in-app navigation.
const debouncedReapply = createDebounced(reapplyCachedStyles, 150);

const observer = new MutationObserver((mutations) => {
  // Only re-apply if there are meaningful child-list changes
  // (not just attribute tweaks or text changes).
  const hasChildChanges = mutations.some((m) => m.type === "childList" && m.addedNodes.length > 0);
  if (hasChildChanges) {
    debouncedReapply();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// YouTube SPA navigation — fires on every in-app page change
// (watch → home → search → etc.).  More reliable than the
// MutationObserver alone because it's YouTube's own signal
// that the page content has been replaced.
window.addEventListener("yt-page-data-updated", () => {
  // Small delay to let YouTube finish rendering the new page
  setTimeout(reapplyCachedStyles, 100);
});

// Listen for storage changes (profile updates from popup)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.sites) {
    // Invalidate cache — profile may have changed
    cachedSelectors = null;
    cachedHostname = null;
    cachedInterventionMode = null;
    resolveAndApplyStripping();
  }
});
