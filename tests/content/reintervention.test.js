/**
 * reintervention.test.js — gating and lifecycle tests for
 * content/reintervention.js.
 *
 * Pins the QA-review findings:
 *   - the overlay timer only arms when the master toggle is on, the site
 *     is listed, active, in strip mode, AND friction level 2;
 *   - any config change (friction level, active flag, master toggle)
 *     clears a previously armed interval instead of leaving it running;
 *   - storage changes to `enabled` trigger re-evaluation, not just
 *     `sites`;
 *   - the overlay's "Close tab" button sends a `close-tab` message to
 *     the background (window.close() is ignored on user tabs).
 *
 * @vitest-environment-options {"url": "https://www.youtube.com/"}
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { flushMicrotasks } from "../helpers/dom-fixture.js";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

const level2Site = (overrides = {}) => ({
  domain: "youtube.com",
  active: true,
  interventionMode: "strip",
  frictionLevel: 2,
  ...overrides,
});

async function loadReintervention(initialStorage = {}) {
  await chrome.storage.sync.set(initialStorage);
  vi.resetModules();
  await import("../../content/reintervention.js");
  await flushMicrotasks();
}

describe("content/reintervention.js — timer arming gates", () => {
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    resetChromeMock();
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.getElementById("focusguard-reintervention-overlay")?.remove();
    document.getElementById("focusguard-overlay-styles")?.remove();
  });

  it("arms the timer for a listed, active, strip-mode, level-2 site", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site()] });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(DEFAULT_INTERVAL_MS);
  });

  it("does not arm when the master toggle is off", async () => {
    await loadReintervention({ enabled: false, sites: [level2Site()] });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("does not arm when the site is not listed", async () => {
    await loadReintervention({ enabled: true, sites: [] });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("does not arm when the site entry is inactive", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site({ active: false })] });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("does not arm when the site is in block mode", async () => {
    await loadReintervention({
      enabled: true,
      sites: [level2Site({ interventionMode: "block" })],
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("does not arm for friction levels other than 2", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site({ frictionLevel: 3 })] });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    vi.resetModules();
    await chrome.storage.sync.set({ enabled: true, sites: [level2Site({ frictionLevel: 1 })] });
    await import("../../content/reintervention.js");
    await flushMicrotasks();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("clears a previously armed timer when the friction level changes away from 2", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site()] });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    await chrome.storage.sync.set({
      enabled: true,
      sites: [level2Site({ frictionLevel: 3 })],
    });
    await flushMicrotasks();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    // Not re-armed: level 3 does not use the overlay.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("clears a previously armed timer when the site is deactivated", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site()] });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await chrome.storage.sync.set({
      enabled: true,
      sites: [level2Site({ active: false })],
    });
    await flushMicrotasks();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("clears a previously armed timer when the master toggle flips off (changes.enabled re-evaluation)", async () => {
    await loadReintervention({ enabled: true, sites: [level2Site()] });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Only `enabled` changes here — the listener must re-evaluate on it.
    await chrome.storage.sync.set({ enabled: false });
    await flushMicrotasks();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores storage changes from the local area", async () => {
    await loadReintervention({ enabled: true, sites: [] });
    expect(setIntervalSpy).not.toHaveBeenCalled();

    await chrome.storage.local.set({ enabled: true, sites: [level2Site()] });
    await flushMicrotasks();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

describe("content/reintervention.js — overlay behavior", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("focusguard-reintervention-overlay")?.remove();
    document.getElementById("focusguard-overlay-styles")?.remove();
  });

  it("shows the overlay after the interval elapses and the continue button hides it", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    await loadReintervention({ enabled: true, sites: [level2Site()] });

    expect(document.getElementById("focusguard-reintervention-overlay")).toBeNull();

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    const overlay = document.getElementById("focusguard-reintervention-overlay");
    expect(overlay).toBeTruthy();

    document.getElementById("focusguard-continue").click();
    expect(document.getElementById("focusguard-reintervention-overlay")).toBeNull();
  });

  it("the close button sends a close-tab message to the background instead of window.close()", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    await loadReintervention({ enabled: true, sites: [level2Site()] });

    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS);
    expect(document.getElementById("focusguard-reintervention-overlay")).toBeTruthy();

    document.getElementById("focusguard-close").click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "close-tab" });
  });
});
