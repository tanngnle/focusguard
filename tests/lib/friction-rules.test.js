/*  ═══════════════════════════════════════════════════════
    FocusGuard — Friction Rules Tests
    Tests for the friction engine that determines
    intervention behavior based on friction level.
    ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { getFrictionConfig, FRICTION_LEVELS } from "../../lib/friction-rules.js";

describe("FRICTION_LEVELS", () => {
  it("should define three friction levels", () => {
    expect(FRICTION_LEVELS).toBeDefined();
    expect(FRICTION_LEVELS[1]).toBeDefined();
    expect(FRICTION_LEVELS[2]).toBeDefined();
    expect(FRICTION_LEVELS[3]).toBeDefined();
  });

  it("Level 1 should have breathing delay configuration", () => {
    const level1 = FRICTION_LEVELS[1];
    expect(level1.type).toBe("interstitial");
    expect(level1.delaySeconds).toBeGreaterThan(0);
    expect(level1.showBreathing).toBe(true);
  });

  it("Level 2 should have re-intervention timer configuration", () => {
    const level2 = FRICTION_LEVELS[2];
    expect(level2.type).toBe("overlay");
    expect(level2.intervalSeconds).toBeGreaterThan(0);
  });

  it("Level 3 should be hard block", () => {
    const level3 = FRICTION_LEVELS[3];
    expect(level3.type).toBe("redirect");
  });
});

describe("getFrictionConfig", () => {
  it("should return Level 3 config for unknown level", () => {
    const config = getFrictionConfig(99);
    expect(config.type).toBe("redirect");
  });

  it("should return Level 3 config for null level", () => {
    const config = getFrictionConfig(null);
    expect(config.type).toBe("redirect");
  });

  it("should return Level 1 config with breathing delay", () => {
    const config = getFrictionConfig(1);
    expect(config.type).toBe("interstitial");
    expect(config.delaySeconds).toBe(5);
    expect(config.showBreathing).toBe(true);
  });

  it("should return Level 2 config with re-intervention timer", () => {
    const config = getFrictionConfig(2);
    expect(config.type).toBe("overlay");
    expect(config.intervalSeconds).toBe(900); // 15 minutes
  });

  it("should return Level 3 config for hard block", () => {
    const config = getFrictionConfig(3);
    expect(config.type).toBe("redirect");
  });
});
