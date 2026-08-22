/*  ══════════════════════════════════════════════════════
    FocusGuard — Content Script (Stripping)
    Injected declaratively on YouTube and Facebook pages.
    Hides distracting UI elements based on user's stripping
    profile from chrome.storage.sync.
    ═══════════════════════════════════════════════════════ */

import { getStrippingRules, getDefaultProfile } from "../lib/stripping-rules.js";

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

// ── Site Matching ───────────────────────────────────────
// Same domain semantics as lib/matcher.js: exact match or
// subdomain, "www." stripped, case-insensitive.

function findMatchingSite(hostname, sites) {
  const currentDomain = hostname.replace(/^www\./, "").toLowerCase();
  return sites.find((s) => {
    const siteDomain = s.domain.replace(/^www\./, "").toLowerCase();
    return (
      siteDomain === currentDomain ||
      currentDomain.endsWith("." + siteDomain)
    );
  });
}

// ── Apply Stripping ─────────────────────────────────────
// Reads config from storage and applies the appropriate
// CSS rules. Gating order (all gates must pass):
//   1. Master toggle (`enabled`) is not false
//   2. The current domain is explicitly listed — unlisted
//      sites are NEVER stripped, even on supported platforms
//   3. The site entry is active
//   4. Intervention mode resolves to "strip"
// Stored stripping profiles are PARTIAL (the popup writes
// only toggled keys), so they are merged over the platform
// default profile before use.

async function applyStripping() {
  const hostname = window.location.hostname;

  try {
    const data = await chrome.storage.sync.get(["enabled", "sites"]);

    // Gate 1: master toggle off → no stripping at all.
    if (data.enabled === false) {
      removeStrippingStyles();
      stopObserving();
      return;
    }

    // Gate 2: site must be explicitly listed. No default-profile
    // fallback — merely being a supported platform is not enough.
    const site = findMatchingSite(hostname, data.sites || []);
    if (!site) {
      removeStrippingStyles();
      stopObserving();
      return;
    }

    // Gate 3: per-site active toggle.
    if (site.active === false) {
      removeStrippingStyles();
      stopObserving();
      return;
    }

    // Gate 4: intervention mode.
    const interventionMode = site.interventionMode || "strip";
    if (interventionMode !== "strip") {
      removeStrippingStyles();
      stopObserving();
      return;
    }

    // Merge the stored (possibly partial) profile over the platform
    // default so `undefined` keys resolve as enabled, exactly like the
    // popup renders its toggles.
    const profile = {
      ...(getDefaultProfile(hostname) || {}),
      ...(site.strippingProfile || {}),
    };
    const selectors = getStrippingRules(hostname, profile);

    removeStrippingStyles();
    injectStrippingStyles(selectors);

    // The injected stylesheet already covers nodes created later
    // (CSS matches dynamically), so the observer only exists to
    // re-inject if the style element itself gets removed (SPAs can
    // wipe <head>). Nothing to observe when no rules were emitted.
    if (selectors.length > 0) {
      startObserving();
    } else {
      stopObserving();
    }
  } catch (err) {
    // Storage read failed — fail open: without readable config we
    // cannot verify the master toggle, so strip nothing.
    removeStrippingStyles();
    stopObserving();
  }
}

// ── Mutation Observer ───────────────────────────────────
// Connected only while stripping is actually active. The
// callback skips all mutations as long as the style element
// is present (the stylesheet already hides later-created SPA
// nodes), so normal SPA churn costs one getElementById per
// mutation batch instead of a full re-evaluation.

let observer = null;
let observing = false;

function onDomMutation() {
  if (document.getElementById("focusguard-stripping-styles")) return;
  applyStripping();
}

function startObserving() {
  if (observing) return;
  if (!observer) {
    observer = new MutationObserver(onDomMutation);
  }
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  observing = true;
}

function stopObserving() {
  if (!observing) return;
  if (observer) observer.disconnect();
  observing = false;
}

// ── Initialization ──────────────────────────────────────
applyStripping();

// Listen for storage changes (profile updates from popup, or the
// master toggle flipping) — re-evaluate on either key.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.sites || changes.enabled)) {
    applyStripping();
  }
});
