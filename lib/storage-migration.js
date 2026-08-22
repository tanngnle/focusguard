/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Storage Migration
    One-way migration from the v0 schema (interventionMode,
    frictionLevel) to v1 (restrictionLevel, frictionDelay).
    Pure function — no chrome.* dependencies.
    ═══════════════════════════════════════════════════════ */

export const CURRENT_SCHEMA_VERSION = 1;

// Maps old frictionLevel numbers to frictionDelay seconds
const FRICTION_LEVEL_TO_DELAY = {
  1: 5,
  2: 30,
};

/**
 * Migrate raw storage data from v0 → v1 schema.
 *
 * v0 → v1 changes:
 *   Per-site:
 *     interventionMode "strip"         → restrictionLevel "strip"
 *     interventionMode "block" + fl 3  → restrictionLevel "block"
 *     interventionMode "block" + fl 1/2 → restrictionLevel "friction" + frictionDelay
 *     (missing interventionMode)       → restrictionLevel "strip"
 *     frictionLevel, interventionMode  → deleted
 *   Top-level:
 *     + schemaVersion, focusSessionActive, focusSessionEndsAt, proLicense
 *
 * Idempotent: data already at CURRENT_SCHEMA_VERSION is returned
 * as a shallow clone without modification.
 *
 * @param {object} data  Raw object from chrome.storage.sync.get(null)
 * @returns {object}     Migrated copy (input is never mutated)
 */
export function migrateStorage(data) {
  const result = { ...data };

  // Already at current version → nothing to do
  if (result.schemaVersion >= CURRENT_SCHEMA_VERSION) {
    return result;
  }

  // ── Per-site migration ────────────────────────────────
  if (Array.isArray(result.sites)) {
    result.sites = result.sites.map((site) => {
      // Already migrated this site (has restrictionLevel, no interventionMode)
      if (site.restrictionLevel && !site.interventionMode) {
        return site;
      }

      const migrated = { ...site };
      const mode = site.interventionMode;

      if (mode === "block") {
        const fl = site.frictionLevel || 3;
        if (fl === 3) {
          migrated.restrictionLevel = "block";
        } else {
          migrated.restrictionLevel = "friction";
          migrated.frictionDelay = FRICTION_LEVEL_TO_DELAY[fl] ?? 10;
        }
      } else {
        // "strip" or undefined → default
        migrated.restrictionLevel = "strip";
      }

      delete migrated.interventionMode;
      delete migrated.frictionLevel;
      return migrated;
    });
  }

  // ── Top-level new keys ────────────────────────────────
  result.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (result.focusSessionActive === undefined) result.focusSessionActive = false;
  if (result.focusSessionEndsAt === undefined) result.focusSessionEndsAt = null;
  if (result.proLicense === undefined) result.proLicense = null;

  return result;
}
