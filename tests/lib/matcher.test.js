import { describe, it, expect } from "vitest";
import { matchSite, SKIPPED_PROTOCOLS } from "../../lib/matcher.js";

function site(domain, active = true) {
  return { domain, active };
}

describe("matchSite", () => {
  it("matches an exact domain", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://reddit.com/r/all", sites);
    expect(result).toEqual(site("reddit.com"));
  });

  it("matches a subdomain of a blocked domain", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://m.reddit.com/r/all", sites);
    expect(result).toEqual(site("reddit.com"));
  });

  it("treats a www.-prefixed navigated URL as equivalent to the bare domain", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://www.reddit.com/", sites);
    expect(result).toEqual(site("reddit.com"));
  });

  it("treats a www.-prefixed stored site domain as equivalent to the bare hostname", () => {
    const sites = [site("www.reddit.com")];
    const result = matchSite("https://reddit.com/", sites);
    expect(result).not.toBeNull();
  });

  it("does NOT match a domain that merely starts with the same string (notreddit.com)", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://notreddit.com/", sites);
    expect(result).toBeNull();
  });

  it("does NOT match a domain that has the blocked domain as a prefix of a longer host (security case)", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://reddit.com.evil.com/", sites);
    expect(result).toBeNull();
  });

  it("skips inactive sites", () => {
    const sites = [site("reddit.com", false)];
    const result = matchSite("https://reddit.com/", sites);
    expect(result).toBeNull();
  });

  it("returns the first matching active site when multiple sites are present", () => {
    const sites = [site("example.com", false), site("reddit.com"), site("reddit.com")];
    const result = matchSite("https://reddit.com/", sites);
    expect(result).toEqual(site("reddit.com"));
  });

  it("is case-insensitive on the hostname", () => {
    const sites = [site("reddit.com")];
    const result = matchSite("https://REDDIT.COM/", sites);
    expect(result).not.toBeNull();
  });

  it.each([...SKIPPED_PROTOCOLS])("returns null for skipped protocol %s", (protocol) => {
    const sites = [site("reddit.com")];
    // Use a URL that a browser could plausibly construct for each protocol.
    const url = `${protocol}//reddit.com/`;
    let parsedOk = true;
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      parsedOk = false;
    }
    if (!parsedOk) return; // skip protocols that don't form a valid URL this way
    expect(matchSite(url, sites)).toBeNull();
  });

  it("returns null for chrome:// URLs specifically", () => {
    expect(matchSite("chrome://extensions", [site("reddit.com")])).toBeNull();
  });

  it("returns null for chrome-extension:// URLs specifically", () => {
    expect(
      matchSite("chrome-extension://abcdefg/blocked.html", [site("reddit.com")])
    ).toBeNull();
  });

  it("returns null for about: URLs", () => {
    expect(matchSite("about:blank", [site("reddit.com")])).toBeNull();
  });

  it("returns null for a malformed URL without throwing", () => {
    expect(() => matchSite("not a url", [site("reddit.com")])).not.toThrow();
    expect(matchSite("not a url", [site("reddit.com")])).toBeNull();
  });

  it("returns null for a relative URL without throwing", () => {
    expect(() => matchSite("/some/path", [site("reddit.com")])).not.toThrow();
    expect(matchSite("/some/path", [site("reddit.com")])).toBeNull();
  });

  it("returns null for an empty URL string without throwing", () => {
    expect(() => matchSite("", [site("reddit.com")])).not.toThrow();
    expect(matchSite("", [site("reddit.com")])).toBeNull();
  });

  it("returns null for an empty site list", () => {
    expect(matchSite("https://reddit.com/", [])).toBeNull();
  });

  it("returns null when sites is not an array", () => {
    expect(matchSite("https://reddit.com/", null)).toBeNull();
    expect(matchSite("https://reddit.com/", undefined)).toBeNull();
  });

  it("skips a site entry with a missing/empty domain rather than matching everything", () => {
    const sites = [{ domain: "", active: true }, site("reddit.com")];
    const result = matchSite("https://reddit.com/", sites);
    expect(result).toEqual(site("reddit.com"));
    expect(matchSite("https://anything-else.com/", sites)).toBeNull();
  });

  it("does not match unrelated domains", () => {
    const sites = [site("reddit.com")];
    expect(matchSite("https://example.com/", sites)).toBeNull();
  });
});
