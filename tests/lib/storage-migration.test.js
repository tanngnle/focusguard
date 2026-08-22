import { describe, it, expect } from "vitest";
import { migrateStorage, CURRENT_SCHEMA_VERSION } from "../../lib/storage-migration.js";

describe("migrateStorage", () => {
  // ── Slice 1: Fresh install (empty storage) ──────────────
  it("adds schemaVersion and new top-level keys to empty data", () => {
    const result = migrateStorage({});
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.focusSessionActive).toBe(false);
    expect(result.focusSessionEndsAt).toBe(null);
    expect(result.proLicense).toBe(null);
  });

  // ── Slice 2: Already migrated ───────────────────────────
  it("returns already-migrated data unchanged", () => {
    const data = {
      schemaVersion: 1,
      focusSessionActive: false,
      focusSessionEndsAt: null,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    };
    const result = migrateStorage(data);
    expect(result).toEqual(data);
  });

  // ── Slice 3: strip migration ────────────────────────────
  it('converts interventionMode "strip" to restrictionLevel "strip"', () => {
    const data = {
      sites: [{ domain: "youtube.com", active: true, interventionMode: "strip" }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("strip");
    expect(result.sites[0].interventionMode).toBeUndefined();
  });

  // ── Slice 4: block with frictionLevel 3 ─────────────────
  it('converts interventionMode "block" + frictionLevel 3 to restrictionLevel "block"', () => {
    const data = {
      sites: [{
        domain: "reddit.com",
        active: true,
        interventionMode: "block",
        frictionLevel: 3,
      }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("block");
    expect(result.sites[0].interventionMode).toBeUndefined();
    expect(result.sites[0].frictionLevel).toBeUndefined();
  });

  // ── Slice 5: block with frictionLevel 1 → friction ──────
  it('converts interventionMode "block" + frictionLevel 1 to restrictionLevel "friction" with delay', () => {
    const data = {
      sites: [{
        domain: "twitter.com",
        active: true,
        interventionMode: "block",
        frictionLevel: 1,
      }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("friction");
    expect(result.sites[0].frictionDelay).toBe(5);
    expect(result.sites[0].interventionMode).toBeUndefined();
    expect(result.sites[0].frictionLevel).toBeUndefined();
  });

  // ── Slice 6: block with frictionLevel 2 → friction ──────
  it('converts interventionMode "block" + frictionLevel 2 to restrictionLevel "friction" with delay', () => {
    const data = {
      sites: [{
        domain: "twitter.com",
        active: true,
        interventionMode: "block",
        frictionLevel: 2,
      }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("friction");
    expect(result.sites[0].frictionDelay).toBe(30);
  });

  // ── Slice 7: missing interventionMode defaults to strip ──
  it("defaults to restrictionLevel strip when interventionMode is missing", () => {
    const data = {
      sites: [{ domain: "example.com", active: true }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("strip");
  });

  // ── Slice 8: preserves existing site fields ─────────────
  it("preserves strippingProfile and other existing site fields", () => {
    const data = {
      sites: [{
        domain: "youtube.com",
        active: true,
        interventionMode: "strip",
        strippingProfile: { hideShorts: true, hideComments: true },
        label: "YouTube",
      }],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].strippingProfile).toEqual({ hideShorts: true, hideComments: true });
    expect(result.sites[0].label).toBe("YouTube");
  });

  // ── Slice 9: mixed sites ────────────────────────────────
  it("handles a mix of old and new format sites", () => {
    const data = {
      sites: [
        { domain: "youtube.com", active: true, interventionMode: "strip" },
        { domain: "reddit.com", active: true, restrictionLevel: "block" },
        { domain: "twitter.com", active: true, interventionMode: "block", frictionLevel: 1 },
      ],
    };
    const result = migrateStorage(data);
    expect(result.sites[0].restrictionLevel).toBe("strip");
    expect(result.sites[1].restrictionLevel).toBe("block");
    expect(result.sites[2].restrictionLevel).toBe("friction");
    expect(result.sites[2].frictionDelay).toBe(5);
  });

  // ── Slice 10: no sites key ──────────────────────────────
  it("handles data with no sites key", () => {
    const result = migrateStorage({ enabled: true });
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.sites).toBeUndefined();
  });

  // ── Slice 11: does not mutate input ─────────────────────
  it("does not mutate the input data", () => {
    const data = {
      sites: [{ domain: "youtube.com", active: true, interventionMode: "strip" }],
    };
    const inputSnapshot = JSON.parse(JSON.stringify(data));
    migrateStorage(data);
    expect(data).toEqual(inputSnapshot);
  });
});
