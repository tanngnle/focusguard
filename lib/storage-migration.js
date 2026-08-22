/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Storage Migration
    One-way migration from the v0 schema (interventionMode,
    frictionLevel) to v1 (restrictionLevel, frictionDelay).
    Pure function — no chrome.* dependencies.
    ═══════════════════════════════════════════════════════ */

import { isInContentScriptScope } from "./domain.js";

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
 *       — but ONLY inside the content-script scope (youtube.com /
 *       facebook.com). Friction is delivered by the content-script
 *       overlay, so on any other domain it would silently become no
 *       restriction at all; out-of-scope v0 friction sites migrate to
 *       "block" instead (the closest enforced behavior).
 *     sites carrying BOTH restrictionLevel and interventionMode keep
 *       restrictionLevel as authoritative (hand-edited/synced data);
 *       the legacy keys are dropped without re-deriving from them
 *     (missing interventionMode)       → restrictionLevel "strip"
 *     frictionLevel, interventionMode  → deleted
 *   Top-level:
 *     + schemaVersion, proLicense
 *     (focusSessionActive/focusSessionEndsAt are deliberately NOT
 *     seeded into sync — the runtime keeps them exclusively in
 *     chrome.storage.local so session state never leaks cross-device.)
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
      // v1 key already present → authoritative. Hand-edited or synced
      // data may carry BOTH restrictionLevel and interventionMode; keep
      // the v1 value and just drop the legacy keys — never re-derive
      // from interventionMode.
      if (site.restrictionLevel) {
        const kept = { ...site };
        delete kept.interventionMode;
        delete kept.frictionLevel;
        return kept;
      }

      const migrated = { ...site };
      const mode = site.interventionMode;

      if (mode === "block") {
        const fl = site.frictionLevel || 3;
        if (fl === 3) {
          migrated.restrictionLevel = "block";
        } else if (isInContentScriptScope(site.domain)) {
          migrated.restrictionLevel = "friction";
          migrated.frictionDelay = FRICTION_LEVEL_TO_DELAY[fl] ?? 10;
        } else {
          // Friction can't run outside the content-script scope —
          // fall back to the enforced tier instead of no restriction.
          migrated.restrictionLevel = "block";
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
  if (result.proLicense === undefined) result.proLicense = null;

  return result;
}
