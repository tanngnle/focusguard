/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Domain Utilities
    Normalization and validation for user-supplied domains.
    Shared by popup/ (input) and background.js (matching).
    ═══════════════════════════════════════════════════════ */

// ── Validation ──────────────────────────────────────────
// Requires at least two labels (e.g. "x.com") with a 2+ letter
// TLD. Deliberately rejects IDN/punycode hosts (non-ASCII or
// "xn--" labels are not special-cased — they simply won't match
// this ASCII-only pattern) and single-label hosts like
// "localhost". Callers wanting those must extend this regex.
const DOMAIN_REGEX =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

// ── normalizeDomain ─────────────────────────────────────
/**
 * Normalize raw user input into a bare domain suitable for storage
 * and matching: strips protocol, leading "www.", any path/query/
 * hash, and whitespace, then lowercases the result.
 * Returns "" for input that normalizes to nothing.
 * @param {string} input
 * @returns {string}
 */
export function normalizeDomain(input) {
  let domain = String(input ?? "").trim().toLowerCase();

  domain = domain
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/[/?#].*$/, "")
    .replace(/\s/g, "");

  return domain;
}

// ── isValidDomain ───────────────────────────────────────
/**
 * Validate an already-normalized domain string.
 * @param {string} domain
 * @returns {boolean}
 */
export function isValidDomain(domain) {
  return DOMAIN_REGEX.test(domain);
}

// ── Built-in Sites ──────────────────────────────────────
// Pre-configured platforms that ship with MindfulBrowse. Users
// can toggle them on/off but cannot delete or rename them.
// They are auto-seeded into storage on first install.

export const BUILTIN_SITES = [
  {
    domain: "youtube.com",
    label: "YouTube",
    color: "#ff0000",
    icon: "▶",
    active: true,
    interventionMode: "strip",
  },
  {
    domain: "facebook.com",
    label: "Facebook",
    color: "#1877f2",
    icon: "f",
    active: true,
    interventionMode: "strip",
  },
];

// Check if a domain is a built-in platform
export function isBuiltinSite(domain) {
  return BUILTIN_SITES.some((s) => s.domain === domain);
}

// Get the built-in site definition for a domain, or null
export function getBuiltinSite(domain) {
  return BUILTIN_SITES.find((s) => s.domain === domain) || null;
}
