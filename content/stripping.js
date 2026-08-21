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

// ── Apply Stripping ─────────────────────────────────────
// Reads the stripping profile from storage and applies
// the appropriate CSS rules. Falls back to default profile
// (all elements hidden) if no profile is stored.

async function applyStripping() {
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
    if (interventionMode !== "strip") {
      // Not in strip mode — don't apply stripping
      removeStrippingStyles();
      return;
    }

    // Get stripping profile (use stored profile or default)
    const profile = site?.strippingProfile || getDefaultProfile(hostname);
    const selectors = getStrippingRules(hostname, profile);

    removeStrippingStyles();
    injectStrippingStyles(selectors);
  } catch (err) {
    // Storage read failed — apply default profile as fallback
    const profile = getDefaultProfile(hostname);
    const selectors = getStrippingRules(hostname, profile);
    removeStrippingStyles();
    injectStrippingStyles(selectors);
  }
}

// ── Initialization ──────────────────────────────────────
// Apply stripping on initial load. YouTube and Facebook are
// SPAs that dynamically update content, so we also observe
// DOM mutations to re-apply styles when new elements appear.

applyStripping();

// Observe DOM mutations for SPA navigation
const observer = new MutationObserver(() => {
  // Debounce: only re-apply if styles are missing or DOM changed significantly
  const existing = document.getElementById("focusguard-stripping-styles");
  if (!existing) {
    applyStripping();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Listen for storage changes (profile updates from popup)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.sites) {
    applyStripping();
  }
});
