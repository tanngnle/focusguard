/*  ══════════════════════════════════════════════════════
    FocusGuard — Intent Classifier (Pure Module)
    URL pattern heuristics for instant intent classification.
    No DOM, no chrome.*, no network requests.
    ═══════════════════════════════════════════════════════ */

// ── Intent Patterns ─────────────────────────────────────
// URL patterns that indicate productive vs distracting intent.
// Patterns are tested in order; first match wins.

export const INTENT_PATTERNS = {
  youtube: {
    productive: [
      /^\/watch$/,             // Specific video (query params handled separately)
      /^\/results$/,           // Search results
      /^\/playlist$/,          // Playlist
      /^\/channel\//,          // Channel page
      /^\/@[^/]+$/,            // Profile page
    ],
    distracting: [
      /^\/$/,                  // Homepage
      /^\/feed\//,             // Subscriptions feed
      /^\/shorts\//,           // Shorts
      /^\/trending\//,         // Trending
      /^\/gaming\//,           // Gaming
    ],
  },

  facebook: {
    productive: [
      /^\/[^/]+$/,              // Profile page (single path segment)
      /^\/messages\//,          // Messages
      /^\/groups\//,            // Groups
      /^\/events\//,            // Events
      /^\/watch\/party\//,      // Watch party
    ],
    distracting: [
      /^\/$/,                   // Homepage/feed
      /^\/home\//,              // Home feed
      /^\/reels\//,             // Reels
      /^\/gaming\//,            // Gaming
      /^\/marketplace\//,       // Marketplace
    ],
  },
};

// ── Domain Extraction ───────────────────────────────────
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
    // Extract base domain without TLD (e.g., "youtube.com" → "youtube")
    const parts = hostname.split(".");
    return parts.length >= 2 ? parts[0] : hostname;
  } catch {
    return null;
  }
}

// ── Path Extraction ─────────────────────────────────────
function extractPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return null;
  }
}

// ── classifyIntent ──────────────────────────────────────
/**
 * Classify user intent based on URL patterns.
 * Returns immediately with heuristic classification.
 *
 * @param {string} url - The URL to classify
 * @returns {object} { intent: 'productive'|'distracting'|'ambiguous', method: 'heuristic' }
 */
export function classifyIntent(url) {
  const domain = extractDomain(url);
  const path = extractPath(url);

  if (!domain || !path) {
    return { intent: "ambiguous", method: "heuristic" };
  }

  // Find matching platform patterns
  const patterns = INTENT_PATTERNS[domain];
  if (!patterns) {
    return { intent: "ambiguous", method: "heuristic" };
  }

  // Check productive patterns first
  for (const pattern of patterns.productive) {
    if (pattern.test(path)) {
      return { intent: "productive", method: "heuristic" };
    }
  }

  // Check distracting patterns
  for (const pattern of patterns.distracting) {
    if (pattern.test(path)) {
      return { intent: "distracting", method: "heuristic" };
    }
  }

  // No match — ambiguous
  return { intent: "ambiguous", method: "heuristic" };
}

// ── shouldApplyFriction ─────────────────────────────────
/**
 * Determine if friction should be applied based on intent.
 *
 * @param {string} url - The URL to evaluate
 * @param {number} frictionLevel - Current friction level (1, 2, or 3)
 * @returns {boolean} True if friction should be applied
 */
export function shouldApplyFriction(url, frictionLevel) {
  const { intent } = classifyIntent(url);

  // Productive intent — no friction
  if (intent === "productive") return false;

  // Distracting or ambiguous — apply friction based on level
  return frictionLevel >= 1;
}
