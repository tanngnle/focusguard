/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Stripping Rules Tests
    Tests for the stripping rule engine that determines
    which CSS selectors to apply for each platform.
    ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { getStrippingRules, PLATFORM_TEMPLATES } from "../../lib/stripping-rules.js";

describe("PLATFORM_TEMPLATES", () => {
  it("should have YouTube template with required elements", () => {
    const yt = PLATFORM_TEMPLATES.youtube;
    expect(yt).toBeDefined();
    expect(yt.domain).toBe("youtube.com");
    expect(yt.elements).toBeDefined();
    // Key distracting elements should be present
    expect(yt.elements.homeFeed).toBeDefined();
    expect(yt.elements.sidebar).toBeDefined();
    expect(yt.elements.shorts).toBeDefined();
    expect(yt.elements.comments).toBeDefined();
  });

  it("should have Facebook template with required elements", () => {
    const fb = PLATFORM_TEMPLATES.facebook;
    expect(fb).toBeDefined();
    expect(fb.domain).toBe("facebook.com");
    expect(fb.elements).toBeDefined();
    // Key distracting elements should be present
    expect(fb.elements.newsFeed).toBeDefined();
    expect(fb.elements.rightSidebar).toBeDefined();
    expect(fb.elements.stories).toBeDefined();
    expect(fb.elements.reels).toBeDefined();
  });
});

describe("getStrippingRules", () => {
  it("should return empty rules for unknown domain", () => {
    const rules = getStrippingRules("unknown.com", {});
    expect(rules).toEqual([]);
  });

  it("should return empty rules when no profile provided", () => {
    const rules = getStrippingRules("youtube.com", null);
    expect(rules).toEqual([]);
  });

  it("should return CSS selectors for enabled YouTube elements", () => {
    const profile = {
      homeFeed: true,
      sidebar: true,
      shorts: false,
      comments: true,
    };
    const rules = getStrippingRules("youtube.com", profile);
    expect(rules.length).toBeGreaterThan(0);
    // All rules should be valid CSS selector strings
    rules.forEach((rule) => {
      expect(typeof rule).toBe("string");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  it("should return empty array when all elements disabled", () => {
    const profile = {
      homeFeed: false,
      sidebar: false,
      shorts: false,
      comments: false,
    };
    const rules = getStrippingRules("youtube.com", profile);
    expect(rules).toEqual([]);
  });

  it("should match domain with www prefix stripped", () => {
    const profile = { homeFeed: true };
    const rules = getStrippingRules("www.youtube.com", profile);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("should return Facebook rules for facebook.com", () => {
    const profile = {
      newsFeed: true,
      rightSidebar: true,
      stories: false,
      reels: true,
    };
    const rules = getStrippingRules("facebook.com", profile);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("should handle subdomain matching (m.youtube.com)", () => {
    const profile = { homeFeed: true };
    const rules = getStrippingRules("m.youtube.com", profile);
    expect(rules.length).toBeGreaterThan(0);
  });
});
