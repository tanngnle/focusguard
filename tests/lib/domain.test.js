import { describe, it, expect } from "vitest";
import { normalizeDomain, isValidDomain } from "../../lib/domain.js";

describe("normalizeDomain", () => {
  it("strips http:// protocol", () => {
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips https:// protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("strips protocol and www. together", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
  });

  it("strips a path", () => {
    expect(normalizeDomain("example.com/some/path")).toBe("example.com");
  });

  it("strips a query string", () => {
    expect(normalizeDomain("example.com?foo=bar")).toBe("example.com");
  });

  it("strips a hash fragment", () => {
    expect(normalizeDomain("example.com#section")).toBe("example.com");
  });

  it("strips path, query, and hash all together", () => {
    expect(normalizeDomain("https://www.example.com/path?q=1#frag")).toBe("example.com");
  });

  it("strips internal and surrounding whitespace", () => {
    expect(normalizeDomain("  ex ample.com  ")).toBe("example.com");
  });

  it("lowercases uppercase input", () => {
    expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
  });

  it("lowercases mixed-case input with protocol", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.COM")).toBe("example.com");
  });

  it("returns '' for junk input that normalizes to nothing", () => {
    expect(normalizeDomain("https://www.")).toBe("");
  });

  it("returns '' for empty string", () => {
    expect(normalizeDomain("")).toBe("");
  });

  it("returns '' for null", () => {
    expect(normalizeDomain(null)).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(normalizeDomain(undefined)).toBe("");
  });

  it("returns '' for whitespace-only input", () => {
    expect(normalizeDomain("   ")).toBe("");
  });

  it("coerces non-string input via String()", () => {
    expect(normalizeDomain(123)).toBe("123");
  });
});

describe("isValidDomain", () => {
  it("accepts a simple two-label domain", () => {
    expect(isValidDomain("example.com")).toBe(true);
  });

  it("accepts a subdomain (three labels)", () => {
    expect(isValidDomain("m.reddit.com")).toBe(true);
  });

  it("accepts a domain with a hyphenated label", () => {
    expect(isValidDomain("my-site.co")).toBe(true);
  });

  it("accepts a domain with digits in a label", () => {
    expect(isValidDomain("site123.com")).toBe(true);
  });

  it("rejects a single-label host like 'localhost'", () => {
    expect(isValidDomain("localhost")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidDomain("")).toBe(false);
  });

  it("rejects a domain with a 1-letter TLD", () => {
    expect(isValidDomain("example.c")).toBe(false);
  });

  it("rejects a domain with no TLD (trailing dot label missing)", () => {
    expect(isValidDomain("example.")).toBe(false);
  });

  it("rejects a domain starting with a hyphen", () => {
    expect(isValidDomain("-example.com")).toBe(false);
  });

  it("rejects a domain ending a label with a hyphen", () => {
    expect(isValidDomain("example-.com")).toBe(false);
  });

  it("rejects a non-ASCII IDN host (documented rejection)", () => {
    // Non-ASCII characters fail the ASCII-only regex outright.
    expect(isValidDomain("bücher.de")).toBe(false);
  });

  it("accepts an already-punycode-encoded ('xn--') host, since it is plain ASCII", () => {
    // The regex is ASCII-only and doesn't special-case "xn--" labels either
    // way: a punycode string like "xn--fsq" is itself valid a-z0-9- text, so
    // it passes like any other label would. Only literal non-ASCII input
    // (the previous test) is actually rejected.
    expect(isValidDomain("xn--fsq.com")).toBe(true);
  });

  it("rejects a domain containing whitespace", () => {
    expect(isValidDomain("exa mple.com")).toBe(false);
  });

  it("rejects a domain containing uppercase letters", () => {
    // isValidDomain operates on already-normalized (lowercased) input; uppercase fails.
    expect(isValidDomain("Example.com")).toBe(false);
  });

  it("rejects a domain with a protocol still attached", () => {
    expect(isValidDomain("https://example.com")).toBe(false);
  });
});
