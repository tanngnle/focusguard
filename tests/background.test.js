import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resetChromeMock,
  triggerNavigation,
  triggerOnInstalled,
  FAKE_EXTENSION_ID,
} from "./helpers/chrome-mock.js";
import { BUILTIN_SITES } from "../lib/domain.js";
import { CURRENT_SCHEMA_VERSION } from "../lib/storage-migration.js";

// background.js hydrates its cache from chrome.storage at module top level
// (an IIFE), so the mock must be installed and the module (re)imported fresh
// for every test. vi.resetModules() + dynamic import gives each test its own
// module instance with its own top-level `ready` promise/cache.
async function loadBackground() {
  vi.resetModules();
  const mod = await import("../background.js");
  // Let the top-level hydration IIFE's microtasks settle so `hydrated` flips
  // true before the test starts firing navigations. Sized generously: the
  // session-expiry path (#25) awaits an extra storage.local.set after the
  // two storage.get reads, and over-flushing settled promises is harmless.
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
  return mod;
}

describe("background.js — navigation blocking", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("redirects a blocked-domain navigation to blocked.html with the matched domain", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true, restrictionLevel: "block" }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/r/all", tabId: 7 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [tabId, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(tabId).toBe(7);
    expect(updateProps.url).toContain(
      `chrome-extension://${FAKE_EXTENSION_ID}/blocked/blocked.html`
    );
    expect(updateProps.url).toContain("domain=reddit.com");
  });

  it("the redirect URL contains no dead url= parameter", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true, restrictionLevel: "block" }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/r/all?x=1", tabId: 1 });

    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    const parsed = new URL(updateProps.url);
    expect(parsed.searchParams.has("url")).toBe(false);
    expect([...parsed.searchParams.keys()]).toEqual(["domain"]);
  });

  it("does nothing for a subframe navigation (frameId !== 0)", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1, frameId: 3 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("does nothing when the master toggle is disabled", async () => {
    await chrome.storage.sync.set({
      enabled: false,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("does nothing for an inactive site", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: false }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("does nothing for a chrome:// URL", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();

    await triggerNavigation({ url: "chrome://extensions", tabId: 1 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("does nothing for a non-matching domain", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://example.com/", tabId: 1 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe("background.js — cache coherence via storage.onChanged", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("picks up a new `sites` value written after hydration on the very next navigation, without any further storage.get call", async () => {
    await chrome.storage.sync.set({ enabled: true, sites: [] });
    await loadBackground();

    // Hydration already happened; record how many times get() has been
    // called so far (should be exactly once, from the top-level hydration).
    const getCallsAfterHydration = chrome.storage.sync.get.mock.calls.length;
    expect(getCallsAfterHydration).toBeGreaterThan(0);

    // First navigation: not blocked yet, since sites is empty.
    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();

    // Write new sites via storage.set — the onChanged listener should update
    // the in-memory cache synchronously, no further get() needed.
    await chrome.storage.sync.set({ sites: [{ domain: "reddit.com", active: true, restrictionLevel: "block" }] });

    // No additional storage.get calls should have happened as a result of
    // that write or the cache update.
    expect(chrome.storage.sync.get.mock.calls.length).toBe(getCallsAfterHydration);

    // Next navigation should now be blocked, purely from the cache.
    await triggerNavigation({ url: "https://reddit.com/", tabId: 2 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);

    // Still no extra storage.get calls — the whole hot path did zero I/O.
    expect(chrome.storage.sync.get.mock.calls.length).toBe(getCallsAfterHydration);
  });

  it("reacts to the master toggle being flipped off via onChanged without a fresh get()", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();
    const getCallsAfterHydration = chrome.storage.sync.get.mock.calls.length;

    await chrome.storage.sync.set({ enabled: false });
    expect(chrome.storage.sync.get.mock.calls.length).toBe(getCallsAfterHydration);

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("ignores onChanged events from the local storage area (sites/enabled live in sync only)", async () => {
    await chrome.storage.sync.set({ enabled: true, sites: [] });
    await loadBackground();

    // Writing to local storage under keys named "enabled"/"sites" must not
    // leak into the sync-backed cache.
    await chrome.storage.local.set({ enabled: false, sites: [{ domain: "reddit.com", active: true }] });

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });
    expect(chrome.tabs.update).not.toHaveBeenCalled(); // cache.enabled still true, cache.sites still []
  });
});

describe("background.js — restrictionLevel routing (#24)", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("strip level does NOT redirect — the content script overlay handles it", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 3 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("friction level does NOT redirect — the content script overlay handles it (no breathing.html redirect)", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "friction", frictionDelay: 20 }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/watch?v=x", tabId: 3 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("block level redirects to blocked.html with the matched domain", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "block" }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 5 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [tabId, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(tabId).toBe(5);
    expect(updateProps.url).toContain(
      `chrome-extension://${FAKE_EXTENSION_ID}/blocked/blocked.html`
    );
    expect(updateProps.url).toContain("domain=youtube.com");
  });
});

describe("background.js — Lock Down override (#25 pre-wiring)", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("focusSessionActive=true redirects a strip site to blocked.html", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + 10 * 60000,
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain(
      `chrome-extension://${FAKE_EXTENSION_ID}/blocked/blocked.html`
    );
    expect(updateProps.url).toContain("domain=youtube.com");
  });

  it("focusSessionActive=true redirects a friction site to blocked.html", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "friction", frictionDelay: 10 }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + 10 * 60000,
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");
    expect(updateProps.url).toContain("domain=youtube.com");
  });

  it("picks up focusSessionActive flips in the local area via onChanged", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await loadBackground();

    // Session not active yet: strip falls through, no redirect.
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    // Lock Down starts — written to chrome.storage.local with a valid
    // (future) deadline; an expired/missing deadline would be cleared by
    // the onChanged expiry gate instead of arming the override.
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + 10 * 60000,
    });

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");

    // Session ends — strip sites fall through again.
    await chrome.storage.local.set({ focusSessionActive: false });

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1); // unchanged
  });
});

describe("background.js — Lock Down session expiry (#25)", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("hydration clears an active session whose deadline already passed", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() - 60000, // expired while the worker slept
    });
    await loadBackground();

    // Both keys are rewritten to storage.local (which also drives the
    // cache via onChanged).
    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);

    // Cache is off: the strip site falls through instead of redirecting.
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("hydration clears an active session with a missing/invalid deadline", async () => {
    // Active flag but no deadline at all.
    await chrome.storage.local.set({ focusSessionActive: true });
    await loadBackground();

    let local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);
  });

  it("hydration clears an active session with a non-numeric deadline", async () => {
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: "soon",
    });
    await loadBackground();

    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);
  });

  it("hydration preserves a non-expired session and keeps the override armed", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    const endsAt = Date.now() + 20 * 60000;
    await chrome.storage.local.set({ focusSessionActive: true, focusSessionEndsAt: endsAt });
    await loadBackground();

    // Session untouched.
    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(true);
    expect(local.focusSessionEndsAt).toBe(endsAt);

    // Override still redirects.
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");
  });

  it("onChanged expires a session whose write lands with a past deadline", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await loadBackground();

    // A write that arms the flag with an already-past deadline (corrupt
    // writer, clock skew) — the listener must neutralize it immediately.
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() - 1000,
    });
    for (let i = 0; i < 12; i++) await Promise.resolve();

    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("onChanged expires a session when the deadline is written alone in the past", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    // Flag armed first with a valid deadline...
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + 10 * 60000,
    });
    await loadBackground();

    // ...then the deadline gets rewritten into the past by itself.
    await chrome.storage.local.set({ focusSessionEndsAt: Date.now() - 1000 });
    for (let i = 0; i < 12; i++) await Promise.resolve();

    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("hydration leaves an inactive session's stored keys alone", async () => {
    await chrome.storage.local.set({ focusSessionActive: false, focusSessionEndsAt: null });
    const setCallsBefore = chrome.storage.local.set.mock.calls.length;
    await loadBackground();

    // No expiry rewrite happened during hydration.
    expect(chrome.storage.local.set.mock.calls.length).toBe(setCallsBefore);
  });
});

describe("background.js — ultra-review findings (B1/B2/B3/M2)", () => {
  beforeEach(() => {
    resetChromeMock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // B1 — webNavigation events keep the service worker awake, so the Lock
  // Down deadline can pass while hydration/onChanged never re-run. The
  // enforcement path must re-validate the deadline, expire the session, and
  // fall through to per-site handling instead of redirecting forever.
  it("B1: an active session whose deadline passes while the worker stays awake does NOT redirect and gets cleared", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: t0 + 60000, // valid right now
    });
    await loadBackground();

    // While the deadline is still valid, the override redirects.
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);

    // Time passes the deadline while the worker stays awake.
    vi.setSystemTime(t0 + 120000);

    // Next navigation re-validates, expires, clears, and falls through to
    // per-site handling (strip → no redirect).
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1); // no new redirect

    const local = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    expect(local.focusSessionActive).toBe(false);
    expect(local.focusSessionEndsAt).toBe(null);
  });

  it("B1: an active non-expired session still redirects at enforcement time", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "strip" }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: t0 + 60 * 60000,
    });
    await loadBackground();

    vi.setSystemTime(t0 + 30000); // still well before the deadline
    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 4 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");
    expect(updateProps.url).toContain("domain=youtube.com");
  });

  // B2 — a site entry missing restrictionLevel entirely must default to
  // strip (no redirect), matching the popup's displayed default, instead of
  // slipping past the early-returns into the hard block.
  it("B2: a site with no restrictionLevel falls through as strip (no redirect)", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/", tabId: 1 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  // B3 — friction is delivered by the content-script overlay, which only
  // injects on youtube.com / facebook.com. On any other domain a friction
  // site would be completely unenforced, so background falls back to Block.
  it("B3: friction on an out-of-scope domain (reddit.com) redirects to blocked.html", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true, restrictionLevel: "friction", frictionDelay: 10 }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/r/all", tabId: 2 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");
    expect(updateProps.url).toContain("domain=reddit.com");
  });

  it("B3: friction on an in-scope domain (youtube.com) falls through to the content script", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "youtube.com", active: true, restrictionLevel: "friction", frictionDelay: 10 }],
    });
    await loadBackground();

    await triggerNavigation({ url: "https://www.youtube.com/", tabId: 3 });

    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  // M2 — Lock Down is absolute: it matches listed sites regardless of their
  // per-site `active` flag.
  it("M2: focusSessionActive=true redirects even for a site toggled active:false", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: false, restrictionLevel: "strip" }],
    });
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + 10 * 60000,
    });
    await loadBackground();

    await triggerNavigation({ url: "https://reddit.com/", tabId: 6 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    const [, updateProps] = chrome.tabs.update.mock.calls[0];
    expect(updateProps.url).toContain("blocked/blocked.html");
    expect(updateProps.url).toContain("domain=reddit.com");
  });
});

describe("background.js — onInstalled seeding (A2 regression)", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("seeds all DEFAULTS keys into empty storage on fresh install", async () => {
    await loadBackground();
    await triggerOnInstalled({ reason: "install" });

    const data = await chrome.storage.sync.get(null);
    expect(data.enabled).toBe(true);
    // Built-in sites are seeded on fresh install
    expect(data.sites).toEqual(BUILTIN_SITES);
    expect(data.pomodoroSettings).toEqual({
      workDuration: 25,
      shortBreak: 5,
      longBreak: 15,
      roundsBeforeLong: 4,
    });
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Session keys live only in chrome.storage.local — never seeded into
    // sync (M5).
    expect(data.focusSessionActive).toBeUndefined();
    expect(data.focusSessionEndsAt).toBeUndefined();
    expect(data.proLicense).toBe(null);
  });

  it("does NOT clobber an existing non-empty `sites` array on update", async () => {
    const existingSites = [
      { domain: "reddit.com", active: true, restrictionLevel: "strip" },
      { domain: "twitter.com", active: false, restrictionLevel: "strip" },
    ];
    await chrome.storage.sync.set({ sites: existingSites, enabled: false, schemaVersion: CURRENT_SCHEMA_VERSION });
    await loadBackground();

    await triggerOnInstalled({ reason: "update" });

    const data = await chrome.storage.sync.get(null);
    // Built-in sites are appended since they weren't present
    expect(data.sites).toEqual([...existingSites, ...BUILTIN_SITES]);
    expect(data.enabled).toBe(false); // also not clobbered
  });

  it("backfills only genuinely missing default keys, leaving present ones untouched", async () => {
    // Only `sites` is present; `enabled` and `pomodoroSettings` are missing.
    await chrome.storage.sync.set({ sites: [{ domain: "example.com", active: true, restrictionLevel: "strip" }] });
    await loadBackground();

    await triggerOnInstalled({ reason: "install" });

    const data = await chrome.storage.sync.get(null);
    // Built-in sites are appended since they weren't present
    expect(data.sites).toEqual([{ domain: "example.com", active: true, restrictionLevel: "strip" }, ...BUILTIN_SITES]);
    expect(data.enabled).toBe(true); // backfilled
    expect(data.pomodoroSettings).toEqual({
      workDuration: 25,
      shortBreak: 5,
      longBreak: 15,
      roundsBeforeLong: 4,
    });
  });

  it("does not write to storage at all if every DEFAULTS key is already present", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [...BUILTIN_SITES],
      pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      proLicense: null,
    });
    await loadBackground();

    const setCallsBefore = chrome.storage.sync.set.mock.calls.length;
    await triggerOnInstalled({ reason: "install" });
    expect(chrome.storage.sync.set.mock.calls.length).toBe(setCallsBefore);
  });
});
