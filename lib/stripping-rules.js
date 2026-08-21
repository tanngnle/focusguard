/*  ═══════════════════════════════════════════════════════
    FocusGuard — Stripping Rules (Pure Module)
    Maps platform domains to CSS selectors for hiding
    distracting UI elements. No DOM, no chrome.*.
    ═══════════════════════════════════════════════════════ */

// ── Platform Templates ──────────────────────────────────
// Pre-configured stripping profiles for major platforms.
// Each template defines the domain and CSS selectors for
// distracting elements. Selectors use `display: none` via
// content script injection — never DOM removal.

export const PLATFORM_TEMPLATES = {
  youtube: {
    domain: "youtube.com",
    elements: {
      // Home page video grid
      homeFeed: "ytd-rich-section-renderer, ytd-rich-grid-renderer, ytd-two-column-browse-results-renderer #primary",
      // Right sidebar recommendations on watch pages
      sidebar: "ytd-watch-next-secondary-results-renderer, #secondary",
      // Shorts shelf on homepage and watch pages
      shorts: "ytd-rich-section-renderer[is-shorts], ytd-reel-shelf-renderer, #shorts-container",
      // Comments section
      comments: "ytd-comments, #comments",
      // Trending tab content
      trending: "ytd-browse[page-subtype='trending'] ytd-rich-grid-renderer",
      // End screen related videos
      endScreen: "ytd-compact-video-renderer, ytd-compact-movie-renderer, ytd-compact-radio-renderer",
    },
  },

  facebook: {
    domain: "facebook.com",
    elements: {
      // Main news feed
      newsFeed: '[data-pagelet="MainFeed"], [data-pagelet="Stories"], div[role="feed"]',
      // Right sidebar (suggestions, sponsored, contacts)
      rightSidebar: '[data-pagelet="RightRail"], div[aria-label="Sponsored"], div[aria-label="Contacts"]',
      // Stories row at top of feed
      stories: '[data-pagelet="Stories"], div[aria-label="Stories"]',
      // Reels section
      reels: '[data-pagelet="ReelsFeed"], div[aria-label="Reels"], a[href*="/reel/"]',
      // Watch video suggestions
      watch: '[data-pagelet="WatchFeed"], div[aria-label="Watch"]',
      // Marketplace suggestions
      marketplace: '[data-pagelet="Marketplace"], div[aria-label="Marketplace"]',
    },
  },
};

// ── Domain Matching ─────────────────────────────────────
// Matches exact domain or subdomain (e.g., m.youtube.com → youtube.com).
// Strips "www." prefix for comparison.
function matchesDomain(hostname, templateDomain) {
  const clean = hostname.replace(/^www\./, "").toLowerCase();
  const target = templateDomain.toLowerCase();
  return clean === target || clean.endsWith("." + target);
}

// ── getStrippingRules ───────────────────────────────────
/**
 * Get CSS selectors for elements to hide on a given domain.
 * Returns an array of CSS selector strings based on the
 * user's stripping profile (which elements are enabled).
 *
 * @param {string} domain - The hostname (e.g., "youtube.com", "www.facebook.com")
 * @param {object|null} profile - User's stripping profile (element name → boolean)
 * @returns {string[]} Array of CSS selectors to hide
 */
export function getStrippingRules(domain, profile) {
  if (!profile || typeof profile !== "object") return [];

  // Find matching template
  const template = Object.values(PLATFORM_TEMPLATES).find((t) =>
    matchesDomain(domain, t.domain)
  );

  if (!template) return [];

  // Collect selectors for enabled elements
  const rules = [];
  for (const [elementName, selector] of Object.entries(template.elements)) {
    if (profile[elementName] === true) {
      rules.push(selector);
    }
  }

  return rules;
}

// ── getDefaultProfile ───────────────────────────────────
/**
 * Get the default stripping profile for a platform.
 * Returns a profile with all elements enabled (maximum stripping).
 *
 * @param {string} domain - The hostname
 * @returns {object|null} Default profile or null if no template matches
 */
export function getDefaultProfile(domain) {
  const template = Object.values(PLATFORM_TEMPLATES).find((t) =>
    matchesDomain(domain, t.domain)
  );

  if (!template) return null;

  // Enable all elements by default
  const profile = {};
  for (const elementName of Object.keys(template.elements)) {
    profile[elementName] = true;
  }
  return profile;
}

// ── getAvailableElements ────────────────────────────────
/**
 * Get the list of available stripping elements for a platform.
 * Used by the popup UI to show toggles.
 *
 * @param {string} domain - The hostname
 * @returns {string[]|null} Array of element names or null if no template
 */
export function getAvailableElements(domain) {
  const template = Object.values(PLATFORM_TEMPLATES).find((t) =>
    matchesDomain(domain, t.domain)
  );

  if (!template) return null;
  return Object.keys(template.elements);
}
