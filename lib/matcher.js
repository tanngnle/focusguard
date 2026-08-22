/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Site Matcher
    Decides whether a navigated URL matches a blocked site.
    ═══════════════════════════════════════════════════════ */

// ── Skipped Protocols ───────────────────────────────────
// Never intercept these — includes internal browser UI and our
// own extension pages, plus schemes that would be nonsensical or
// dangerous to redirect away from.
export const SKIPPED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "about:",
  "edge:",
  "devtools:",
  "view-source:",
]);

// ── matchSite ───────────────────────────────────────────
/**
 * Find the first active site entry whose domain matches the given
 * URL's hostname. Matching is case-insensitive, "www."-stripped on
 * both sides, and matches either exactly or as a subdomain (the
 * "." prefix on the suffix check guarantees "notreddit.com" does
 * NOT match a "reddit.com" entry).
 * Never throws — malformed URLs and skipped protocols yield null.
 * @param {string} url
 * @param {Array<{domain: string, active: boolean}>} sites
 * @returns {object|null}
 */
export function matchSite(url, sites) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (SKIPPED_PROTOCOLS.has(parsed.protocol)) return null;
  if (!Array.isArray(sites)) return null;

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  return (
    sites.find((site) => {
      if (!site || site.active !== true) return false;
      const blockedDomain = String(site.domain ?? "")
        .replace(/^www\./, "")
        .toLowerCase();
      if (!blockedDomain) return false;
      return (
        hostname === blockedDomain || hostname.endsWith("." + blockedDomain)
      );
    }) ?? null
  );
}
