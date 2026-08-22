/*  ══════════════════════════════════════════════════════
    FocusGuard — Content Script (Stripping)
    Injected declaratively on YouTube and Facebook pages.
    Controls stripping by setting html[data-fg-*] attributes
    that gate CSS rules in content/stripping.css.

    This mirrors the Unhook extension approach:
    - CSS is declared in the manifest and injected
      synchronously by the browser at document_start.
    - The content script reads the user's profile from
      storage and sets/removes html attributes to toggle
      individual element visibility.
    - No dynamic <style> injection — the browser handles
      CSS delivery, eliminating timing races.
    - Self-contained: no ES module imports, works regardless
      of how Chrome loads the script.
    ═══════════════════════════════════════════════════════ */

// ── Platform Element Definitions ────────────────────────
// Maps platform domains to their strippable element names.
// Inlined here to avoid ES module imports.

const PLATFORM_ELEMENTS = {
  "youtube.com": ["homeFeed", "sidebar", "shorts", "comments", "trending", "endScreen"],
  "facebook.com": ["sidebar", "newsFeed", "rightSidebar", "stories", "reels", "watch", "marketplace"],
};

function getAvailableElements(hostname) {
  const clean = hostname.replace(/^www\./, "").toLowerCase();
  for (const [domain, elements] of Object.entries(PLATFORM_ELEMENTS)) {
    if (clean === domain || clean.endsWith("." + domain)) {
      return elements;
    }
  }
  return null;
}

// ── Attribute Helpers ───────────────────────────────────
// The CSS file uses html[data-fg-{element}="true"] gates.
// Setting an attribute instantly activates the corresponding
// CSS rule; removing it deactivates the rule. No style
// element creation/removal needed.

const html = document.documentElement;

function setStripAttribute(elementName, enabled) {
  // Convert camelCase to kebab-case: homeFeed → home-feed
  const kebab = elementName.replace(/([A-Z])/g, '-$1').toLowerCase();
  const attr = `data-fg-${kebab}`;
  if (enabled) {
    html.setAttribute(attr, "true");
  } else {
    html.removeAttribute(attr);
  }
}

function clearAllStripAttributes() {
  // Remove any data-fg-* attributes we may have set
  const attrs = Array.from(html.attributes).filter((a) =>
    a.name.startsWith("data-fg-")
  );
  attrs.forEach((a) => html.removeAttribute(a.name));
}

// ── Apply Stripping Profile ─────────────────────────────
// Reads the stripping profile from storage and sets the
// appropriate html attributes. The CSS file (injected
// synchronously by the browser) handles the actual hiding.

async function applyStrippingProfile() {
  const hostname = window.location.hostname;

  try {
    const data = await chrome.storage.sync.get(["sites", "enabled"]);
    const sites = data.sites || [];

    // Master toggle off — strip nothing
    if (data.enabled === false) {
      clearAllStripAttributes();
      return;
    }

    // Find the site entry for this domain
    const site = sites.find((s) => {
      const siteDomain = s.domain.replace(/^www\./, "").toLowerCase();
      const currentDomain = hostname.replace(/^www\./, "").toLowerCase();
      return (
        siteDomain === currentDomain ||
        currentDomain.endsWith("." + siteDomain)
      );
    });

    // Site not in list or toggled off — strip nothing
    if (!site || site.active === false) {
      clearAllStripAttributes();
      return;
    }

    // Check intervention mode
    const interventionMode = site.interventionMode || "strip";
    if (interventionMode !== "strip") {
      clearAllStripAttributes();
      return;
    }

    // Get available elements for this platform
    const availableElements = getAvailableElements(hostname);
    if (!availableElements) {
      // Not a supported platform — clear any attributes
      clearAllStripAttributes();
      return;
    }

    // Get stripping profile (use stored profile or default: all enabled)
    const profile = site?.strippingProfile || {};

    // Set attributes for each available element
    availableElements.forEach((elementName) => {
      // Default to enabled (true) if not explicitly set to false
      const enabled = profile[elementName] !== false;
      setStripAttribute(elementName, enabled);
    });
  } catch (err) {
    // Storage read failed — apply default profile (all enabled)
    const availableElements = getAvailableElements(hostname);
    if (availableElements) {
      availableElements.forEach((elementName) => {
        setStripAttribute(elementName, true);
      });
    }
  }
}

// ── Initialization ──────────────────────────────────────
// 1. Apply stripping profile from storage.
// 2. Listen for YouTube's SPA navigation event to re-apply
//    attributes when the page content changes.
// 3. Listen for storage changes (profile updates from popup).

applyStrippingProfile();

// YouTube SPA navigation — fires on every in-app page change
// (watch → home → search → etc.). Re-apply attributes to
// ensure stripping persists across navigation.
window.addEventListener("yt-page-data-updated", () => {
  // Small delay to let YouTube finish rendering the new page
  setTimeout(applyStrippingProfile, 100);
});

// Listen for storage changes (profile updates from popup)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  // Re-apply when sites change (toggle, profile, mode) or master toggle flips
  if (changes.sites || changes.enabled) {
    applyStrippingProfile();
  }
});
