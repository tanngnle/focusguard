import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetChromeMock,
  triggerNavigation,
  triggerOnInstalled,
  FAKE_EXTENSION_ID,
} from "./helpers/chrome-mock.js";

// background.js hydrates its cache from chrome.storage at module top level
// (an IIFE), so the mock must be installed and the module (re)imported fresh
// for every test. vi.resetModules() + dynamic import gives each test its own
// module instance with its own top-level `ready` promise/cache.
async function loadBackground() {
  vi.resetModules();
  const mod = await import("../background.js");
  // Let the top-level hydration IIFE's microtasks settle so `hydrated` flips
  // true before the test starts firing navigations.
  await Promise.resolve();
  await Promise.resolve();
  return mod;
}

describe("background.js — navigation blocking", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("redirects a blocked-domain navigation to blocked.html with the matched domain", async () => {
    await chrome.storage.sync.set({
      enabled: true,
      sites: [{ domain: "reddit.com", active: true }],
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
      sites: [{ domain: "reddit.com", active: true }],
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
    await chrome.storage.sync.set({ sites: [{ domain: "reddit.com", active: true }] });

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

describe("background.js — onInstalled seeding (A2 regression)", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("seeds all DEFAULTS keys into empty storage on fresh install", async () => {
    await loadBackground();
    await triggerOnInstalled({ reason: "install" });

    const data = await chrome.storage.sync.get(null);
    expect(data.enabled).toBe(true);
    expect(data.sites).toEqual([]);
    expect(data.pomodoroSettings).toEqual({
      workDuration: 25,
      shortBreak: 5,
      longBreak: 15,
      roundsBeforeLong: 4,
    });
  });

  it("does NOT clobber an existing non-empty `sites` array on update", async () => {
    const existingSites = [
      { domain: "reddit.com", active: true },
      { domain: "twitter.com", active: false },
    ];
    await chrome.storage.sync.set({ sites: existingSites, enabled: false });
    await loadBackground();

    await triggerOnInstalled({ reason: "update" });

    const data = await chrome.storage.sync.get(null);
    expect(data.sites).toEqual(existingSites);
    expect(data.enabled).toBe(false); // also not clobbered
  });

  it("backfills only genuinely missing default keys, leaving present ones untouched", async () => {
    // Only `sites` is present; `enabled` and `pomodoroSettings` are missing.
    await chrome.storage.sync.set({ sites: [{ domain: "example.com", active: true }] });
    await loadBackground();

    await triggerOnInstalled({ reason: "install" });

    const data = await chrome.storage.sync.get(null);
    expect(data.sites).toEqual([{ domain: "example.com", active: true }]);
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
      sites: [],
      pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 },
    });
    await loadBackground();

    const setCallsBefore = chrome.storage.sync.set.mock.calls.length;
    await triggerOnInstalled({ reason: "install" });
    expect(chrome.storage.sync.set.mock.calls.length).toBe(setCallsBefore);
  });
});
