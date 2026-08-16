import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { mountPopupDom, fireDomContentLoaded, flushMicrotasks } from "../helpers/dom-fixture.js";

async function mountPopup(initialStorage = {}) {
  resetChromeMock();
  await chrome.storage.sync.set(initialStorage);
  mountPopupDom();
  vi.resetModules();
  await import("../../popup/popup.js");
  fireDomContentLoaded();
  await flushMicrotasks();
}

describe("popup.js — initial render", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an empty state with zero sites when storage is empty", async () => {
    await mountPopup({ enabled: true, sites: [] });
    expect(document.getElementById("site-count").textContent).toBe("0");
    expect(document.getElementById("empty-state").style.display).toBe("flex");
  });

  it("renders a site card for each stored site, with the active state reflected", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "reddit.com", active: true },
        { domain: "twitter.com", active: false },
      ],
    });
    const cards = document.querySelectorAll(".site-card");
    expect(cards.length).toBe(2);
    expect(document.getElementById("site-count").textContent).toBe("2");
    expect(document.getElementById("empty-state").style.display).toBe("none");

    const twitterCard = document.querySelector('.site-card[data-domain="twitter.com"]');
    expect(twitterCard.classList.contains("inactive")).toBe(true);
    const redditCard = document.querySelector('.site-card[data-domain="reddit.com"]');
    expect(redditCard.classList.contains("inactive")).toBe(false);
  });

  it("reflects the master toggle from storage", async () => {
    await mountPopup({ enabled: false, sites: [] });
    expect(document.getElementById("master-toggle-input").checked).toBe(false);
  });

  it("populates the pomodoro sliders from stored settings", async () => {
    await mountPopup({
      enabled: true,
      sites: [],
      pomodoroSettings: { workDuration: 30, shortBreak: 10, longBreak: 20, roundsBeforeLong: 3 },
    });
    expect(document.getElementById("work-slider").value).toBe("30");
    expect(document.getElementById("short-break-slider").value).toBe("10");
    expect(document.getElementById("long-break-slider").value).toBe("20");
    expect(document.getElementById("rounds-slider").value).toBe("3");
  });
});

describe("popup.js — add site", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a valid domain to storage and re-renders", async () => {
    await mountPopup({ enabled: true, sites: [] });

    document.getElementById("site-input").value = "https://www.twitter.com/home";
    document.getElementById("add-site-btn").click();
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["sites"]);
    expect(data.sites).toEqual([{ domain: "twitter.com", active: true }]);
    expect(document.querySelectorAll(".site-card").length).toBe(1);
  });

  it("rejects an invalid domain and does not write to storage", async () => {
    await mountPopup({ enabled: true, sites: [] });

    document.getElementById("site-input").value = "localhost";
    document.getElementById("add-site-btn").click();
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["sites"]);
    expect(data.sites).toEqual([]);
    expect(document.getElementById("input-hint").textContent).toMatch(/invalid/i);
  });

  it("rejects a duplicate domain", async () => {
    await mountPopup({ enabled: true, sites: [{ domain: "reddit.com", active: true }] });

    document.getElementById("site-input").value = "reddit.com";
    document.getElementById("add-site-btn").click();
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["sites"]);
    expect(data.sites).toEqual([{ domain: "reddit.com", active: true }]);
    expect(document.getElementById("input-hint").textContent).toMatch(/already blocked/i);
  });
});

describe("popup.js — C1: slider debounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("firing many input events on a slider in quick succession produces at most a couple of storage.sync.set calls, not one per event", async () => {
    await mountPopup({
      enabled: true,
      sites: [],
      pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 },
    });

    const setCallsBefore = chrome.storage.sync.set.mock.calls.length;

    vi.useFakeTimers();
    const workSlider = document.getElementById("work-slider");

    // Simulate dragging the slider: many rapid "input" events, each well
    // inside the 400ms debounce window of the previous one.
    for (let v = 1; v <= 30; v++) {
      workSlider.value = String(v);
      workSlider.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10); // 10ms between ticks, << 400ms debounce
    }

    // Let the debounce timer (400ms after the last input) fire.
    await vi.advanceTimersByTimeAsync(500);

    const setCallsAfter = chrome.storage.sync.set.mock.calls.length - setCallsBefore;
    expect(setCallsAfter).toBeLessThanOrEqual(2);
    expect(setCallsAfter).toBeGreaterThanOrEqual(1);

    // And the persisted value should reflect the last input, not an early one.
    const data = await chrome.storage.sync.get(["pomodoroSettings"]);
    expect(data.pomodoroSettings.workDuration).toBe(30);
  });

  it("a 'change' event (drag release) flushes immediately without waiting for the debounce", async () => {
    await mountPopup({
      enabled: true,
      sites: [],
      pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 },
    });

    vi.useFakeTimers();
    const workSlider = document.getElementById("work-slider");
    workSlider.value = "42";
    workSlider.dispatchEvent(new Event("input", { bubbles: true }));
    workSlider.dispatchEvent(new Event("change", { bubbles: true }));
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["pomodoroSettings"]);
    expect(data.pomodoroSettings.workDuration).toBe(42);
  });
});

describe("popup.js — C3: rapid-succession delete keyed by domain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deleting two sites in rapid succession removes exactly those two and no others", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "reddit.com", active: true },
        { domain: "twitter.com", active: true },
        { domain: "youtube.com", active: true },
      ],
    });

    vi.useFakeTimers();

    const redditDelete = document.querySelector(
      '.site-card[data-domain="reddit.com"] .btn-delete'
    );
    const twitterDelete = document.querySelector(
      '.site-card[data-domain="twitter.com"] .btn-delete'
    );

    // Click both delete buttons in rapid succession (small real gap between
    // them, as a user's two clicks would have — not the exact same tick).
    redditDelete.click();
    await vi.advanceTimersByTimeAsync(20);
    twitterDelete.click();

    // Each click schedules removeSite() 250ms later (the removal animation).
    await vi.advanceTimersByTimeAsync(400);
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["sites"]);
    const domains = data.sites.map((s) => s.domain).sort();
    expect(domains).toEqual(["youtube.com"]);
  });

  it("toggling two sites in rapid succession updates exactly those two and no others", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "reddit.com", active: true },
        { domain: "twitter.com", active: true },
        { domain: "youtube.com", active: true },
      ],
    });

    const redditToggle = document.querySelector(
      '.site-card[data-domain="reddit.com"] input[type="checkbox"]'
    );
    const twitterToggle = document.querySelector(
      '.site-card[data-domain="twitter.com"] input[type="checkbox"]'
    );

    redditToggle.checked = false;
    redditToggle.dispatchEvent(new Event("change", { bubbles: true }));
    twitterToggle.checked = false;
    twitterToggle.dispatchEvent(new Event("change", { bubbles: true }));

    await flushMicrotasks();

    console.log("DEBUG all set calls:", JSON.stringify(chrome.storage.sync.set.mock.calls, null, 2));

    const data = await chrome.storage.sync.get(["sites"]);
    const byDomain = Object.fromEntries(data.sites.map((s) => [s.domain, s.active]));
    expect(byDomain).toEqual({
      "reddit.com": false,
      "twitter.com": false,
      "youtube.com": true,
    });
  });
});
