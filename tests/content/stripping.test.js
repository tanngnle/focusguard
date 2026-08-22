/**
 * stripping.test.js — gating tests for content/stripping.js.
 *
 * Pins the QA-review findings:
 *   - the master toggle (`enabled`), the site's `active` flag, and the
 *     "site must be explicitly listed" gate all control stripping — an
 *     unlisted YouTube page is never stripped by default;
 *   - a PARTIAL stripping profile (`{ comments: false }`) keeps every
 *     other element active instead of zeroing out all rules;
 *   - storage changes to `enabled` OR `sites` both trigger re-evaluation;
 *   - the MutationObserver only re-injects when the style element was
 *     lost, and stays quiet while stripping is inactive.
 *
 * The content script reads `window.location.hostname`, so the jsdom URL is
 * pinned to a YouTube page via environment options. Each test imports the
 * real module fresh (vi.resetModules) against a freshly reset chrome mock.
 *
 * @vitest-environment-options {"url": "https://www.youtube.com/"}
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { flushMicrotasks } from "../helpers/dom-fixture.js";

const STYLE_ID = "focusguard-stripping-styles";

const stripSite = (overrides = {}) => ({
  domain: "youtube.com",
  active: true,
  interventionMode: "strip",
  ...overrides,
});

async function loadStrippingScript(initialStorage = {}) {
  await chrome.storage.sync.set(initialStorage);
  vi.resetModules();
  await import("../../content/stripping.js");
  await flushMicrotasks();
}

function getStyles() {
  return document.getElementById(STYLE_ID);
}

describe("content/stripping.js — config gating", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  afterEach(() => {
    getStyles()?.remove();
  });

  it("injects stripping styles for a listed, active, strip-mode site", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite()] });

    const style = getStyles();
    expect(style).toBeTruthy();
    expect(style.textContent).toContain("ytd-rich-grid-renderer");
    expect(style.textContent).toContain("display: none !important");
  });

  it("injects nothing when the master toggle is off", async () => {
    await loadStrippingScript({ enabled: false, sites: [stripSite()] });

    expect(getStyles()).toBeNull();
  });

  it("injects nothing when the site is not in the list (no default-profile fallback)", async () => {
    // YouTube is a supported platform, but the user never listed it —
    // stripping must stay off.
    await loadStrippingScript({ enabled: true, sites: [] });
    expect(getStyles()).toBeNull();

    // Same when only an unrelated site is listed.
    getStyles()?.remove();
    await loadStrippingScript({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true, interventionMode: "strip" }],
    });
    expect(getStyles()).toBeNull();
  });

  it("injects nothing when the site entry is inactive", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite({ active: false })] });

    expect(getStyles()).toBeNull();
  });

  it("injects nothing when the site is in block mode", async () => {
    await loadStrippingScript({
      enabled: true,
      sites: [stripSite({ interventionMode: "block" })],
    });

    expect(getStyles()).toBeNull();
  });

  it("removes previously injected styles when the master toggle flips off", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite()] });
    expect(getStyles()).toBeTruthy();

    await chrome.storage.sync.set({ enabled: false });
    await flushMicrotasks();

    expect(getStyles()).toBeNull();
  });

  it("re-injects styles when a listed site is reactivated via sites change", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite({ active: false })] });
    expect(getStyles()).toBeNull();

    await chrome.storage.sync.set({ enabled: true, sites: [stripSite()] });
    await flushMicrotasks();

    expect(getStyles()).toBeTruthy();
  });

  it("strips styles when the site is removed from the list", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite()] });
    expect(getStyles()).toBeTruthy();

    await chrome.storage.sync.set({ enabled: true, sites: [] });
    await flushMicrotasks();

    expect(getStyles()).toBeNull();
  });

  it("ignores storage changes from the local area", async () => {
    await loadStrippingScript({ enabled: true, sites: [] });
    expect(getStyles()).toBeNull();

    // Same-shaped data written to local storage must not enable stripping.
    await chrome.storage.local.set({ enabled: true, sites: [stripSite()] });
    await flushMicrotasks();

    expect(getStyles()).toBeNull();
  });
});

describe("content/stripping.js — partial stripping profiles", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  afterEach(() => {
    getStyles()?.remove();
  });

  it("a partial profile keeps every untoggled element active", async () => {
    // The popup persists only the toggled key; `{ comments: false }` must
    // still strip everything else.
    await loadStrippingScript({
      enabled: true,
      sites: [stripSite({ strippingProfile: { comments: false } })],
    });

    const style = getStyles();
    expect(style).toBeTruthy();
    expect(style.textContent).not.toContain("ytd-comments");
    expect(style.textContent).toContain("ytd-rich-grid-renderer"); // homeFeed
    expect(style.textContent).toContain("ytd-watch-next-secondary-results-renderer"); // sidebar
  });

  it("a site with no stored profile gets the full default profile", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite()] });

    const style = getStyles();
    expect(style).toBeTruthy();
    expect(style.textContent).toContain("ytd-comments");
    expect(style.textContent).toContain("ytd-rich-grid-renderer");
  });
});

describe("content/stripping.js — mutation observer", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  afterEach(() => {
    getStyles()?.remove();
  });

  it("re-injects styles if the style element is removed by the page", async () => {
    await loadStrippingScript({ enabled: true, sites: [stripSite()] });
    expect(getStyles()).toBeTruthy();

    // Simulate an SPA wiping our style node; the next DOM mutation should
    // trigger a re-injection.
    getStyles().remove();
    document.body.appendChild(document.createElement("div"));
    await flushMicrotasks();

    expect(getStyles()).toBeTruthy();
  });

  it("does not re-inject after DOM churn when stripping is gated off", async () => {
    await loadStrippingScript({ enabled: false, sites: [stripSite()] });
    expect(getStyles()).toBeNull();

    document.body.appendChild(document.createElement("div"));
    await flushMicrotasks();

    // Inactive state: observer is disconnected, nothing reappears.
    expect(getStyles()).toBeNull();
  });
});
