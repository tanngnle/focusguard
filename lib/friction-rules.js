/*  ═══════════════════════════════════════════════════════
    FocusGuard — Friction Rules (Pure Module)
    Defines friction levels and their configurations.
    No DOM, no chrome.*.
    ═══════════════════════════════════════════════════════ */

// ── Friction Levels ─────────────────────────────────────
// Three levels of intervention intensity:
// Level 1: Mindful delay (breathing exercise, intention prompt)
// Level 2: Re-intervention timer (periodic ejection during browsing)
// Level 3: Hard block (redirect to Pomodoro timer page)

export const FRICTION_LEVELS = {
  1: {
    type: "interstitial",
    delaySeconds: 5,
    showBreathing: true,
    showIntentionPrompt: true,
    description: "Mindful delay with breathing exercise",
  },
  2: {
    type: "overlay",
    intervalSeconds: 900, // 15 minutes
    showReIntervention: true,
    description: "Re-intervention timer during browsing",
  },
  3: {
    type: "redirect",
    description: "Hard block - redirect to Pomodoro timer",
  },
};

// ── getFrictionConfig ───────────────────────────────────
/**
 * Get the friction configuration for a given level.
 * Falls back to Level 3 (hard block) for unknown levels.
 *
 * @param {number|null} level - Friction level (1, 2, or 3)
 * @returns {object} Friction configuration
 */
export function getFrictionConfig(level) {
  if (!level || !FRICTION_LEVELS[level]) {
    return FRICTION_LEVELS[3]; // Default to hard block
  }
  return FRICTION_LEVELS[level];
}

// ── getDefaultFrictionLevel ─────────────────────────────
/**
 * Get the default friction level for a site.
 * Existing sites default to Level 3 (preserves current behavior).
 * New sites default to Level 1 (progressive philosophy).
 *
 * @param {boolean} isExistingSite - Whether this is an existing site from v1
 * @returns {number} Default friction level (1, 2, or 3)
 */
export function getDefaultFrictionLevel(isExistingSite = false) {
  return isExistingSite ? 3 : 1;
}
