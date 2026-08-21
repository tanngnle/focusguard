/*  ═══════════════════════════════════════════════════════
    FocusGuard — Intent Classifier Tests
    Tests for URL pattern heuristics and intent classification
    ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { classifyIntent, INTENT_PATTERNS } from "../../lib/intent-classifier.js";

describe("INTENT_PATTERNS", () => {
  it("should have patterns for YouTube", () => {
    expect(INTENT_PATTERNS.youtube).toBeDefined();
    expect(INTENT_PATTERNS.youtube.productive).toBeInstanceOf(Array);
    expect(INTENT_PATTERNS.youtube.distracting).toBeInstanceOf(Array);
  });

  it("should have patterns for Facebook", () => {
    expect(INTENT_PATTERNS.facebook).toBeDefined();
    expect(INTENT_PATTERNS.facebook.productive).toBeInstanceOf(Array);
    expect(INTENT_PATTERNS.facebook.distracting).toBeInstanceOf(Array);
  });
});

describe("classifyIntent", () => {
  it("should classify YouTube watch page as productive", () => {
    const result = classifyIntent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.intent).toBe("productive");
    expect(result.method).toBe("heuristic");
  });

  it("should classify YouTube search as productive", () => {
    const result = classifyIntent("https://www.youtube.com/results?search_query=react+tutorial");
    expect(result.intent).toBe("productive");
    expect(result.method).toBe("heuristic");
  });

  it("should classify YouTube homepage as distracting", () => {
    const result = classifyIntent("https://www.youtube.com");
    expect(result.intent).toBe("distracting");
    expect(result.method).toBe("heuristic");
  });

  it("should classify YouTube feed as distracting", () => {
    const result = classifyIntent("https://www.youtube.com/feed/subscriptions");
    expect(result.intent).toBe("distracting");
    expect(result.method).toBe("heuristic");
  });

  it("should classify YouTube shorts as distracting", () => {
    const result = classifyIntent("https://www.youtube.com/shorts/abc123");
    expect(result.intent).toBe("distracting");
    expect(result.method).toBe("heuristic");
  });

  it("should classify Facebook profile as productive", () => {
    const result = classifyIntent("https://www.facebook.com/someuser");
    expect(result.intent).toBe("productive");
    expect(result.method).toBe("heuristic");
  });

  it("should classify Facebook home feed as distracting", () => {
    const result = classifyIntent("https://www.facebook.com");
    expect(result.intent).toBe("distracting");
    expect(result.method).toBe("heuristic");
  });

  it("should return ambiguous for unknown patterns", () => {
    const result = classifyIntent("https://www.youtube.com/some/new/path");
    expect(result.intent).toBe("ambiguous");
    expect(result.method).toBe("heuristic");
  });

  it("should return ambiguous for unsupported domains", () => {
    const result = classifyIntent("https://www.twitter.com/home");
    expect(result.intent).toBe("ambiguous");
    expect(result.method).toBe("heuristic");
  });

  it("should handle URLs with query parameters", () => {
    const result = classifyIntent("https://www.youtube.com/watch?v=abc&t=120");
    expect(result.intent).toBe("productive");
  });

  it("should handle m.youtube.com subdomain", () => {
    const result = classifyIntent("https://m.youtube.com/watch?v=abc");
    expect(result.intent).toBe("productive");
  });
});
