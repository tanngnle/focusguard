/*  ═══════════════════════════════════════════════════════
    FocusGuard — Stripping Rules Tests
    Tests for the stripping rule engine that determines
    which CSS selectors to apply for each platform.
    ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { getStrippingRules, getDefaultProfile, PLATFORM_TEMPLATES } from "../../lib/stripping-rules.js";

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

  it("should cover post-2023 YouTube markup in shorts and end-screen selectors", () => {
    const yt = PLATFORM_TEMPLATES.youtube;
    // Shorts: keep legacy renderers AND cover the current shelf, which
    // lives under ytd-rich-section-renderer without a reel-shelf child.
    expect(yt.elements.shorts).toContain("ytd-rich-section-renderer");
    expect(yt.elements.shorts).toContain("/shorts/");
    expect(yt.elements.shorts).toContain("ytd-reel-shelf-renderer");
    // End screen / related: legacy compact renderers AND the lockup
    // view-models YouTube is migrating to (scoped to the watch page).
    expect(yt.elements.endScreen).toContain("ytd-compact-video-renderer");
    expect(yt.elements.endScreen).toContain("yt-lockup-view-model");
    expect(yt.elements.endScreen).toContain("ytd-lockup-view-model");
    expect(yt.elements.endScreen).toContain("ytd-watch-flexy");
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

  it("should treat a partial profile as 'everything else enabled' (popup writes only toggled keys)", () => {
    // The popup's toggleElement persists ONLY the toggled key, so
    // `{ comments: false }` must keep every other element active —
    // this is the regression that zeroed out all stripping.
    const profile = { comments: false };
    const rules = getStrippingRules("youtube.com", profile);
    const allElements = Object.entries(PLATFORM_TEMPLATES.youtube.elements);
    expect(rules).toHaveLength(allElements.length - 1);
    // Comments selectors are excluded...
    rules.forEach((rule) => {
      expect(rule).not.toBe(PLATFORM_TEMPLATES.youtube.elements.comments);
    });
    // ...and every other element's selector is still emitted.
    for (const [elementName, selector] of allElements) {
      if (elementName === "comments") continue;
      expect(rules).toContain(selector);
    }
  });

  it("should treat an empty profile as all elements enabled (default-on)", () => {
    const rules = getStrippingRules("youtube.com", {});
    const expected = Object.values(PLATFORM_TEMPLATES.youtube.elements);
    expect(rules).toEqual(expected);
  });

  it("should emit identical rules for a default profile and a merged partial one", () => {
    const defaults = getDefaultProfile("youtube.com");
    const merged = { ...defaults, comments: false };
    const rules = getStrippingRules("youtube.com", merged);
    expect(rules).not.toContain(PLATFORM_TEMPLATES.youtube.elements.comments);
    expect(rules).toHaveLength(Object.keys(defaults).length - 1);
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
    // Under partial-profile semantics every element must be explicitly
    // disabled to emit no rules — an omitted key means "still on".
    const profile = Object.fromEntries(
      Object.keys(PLATFORM_TEMPLATES.youtube.elements).map((name) => [name, false])
    );
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
