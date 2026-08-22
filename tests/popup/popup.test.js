import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { mountPopupDom, fireDomContentLoaded, flushMicrotasks, ensureLocalStorage } from "../helpers/dom-fixture.js";

async function mountPopup(initialStorage = {}, initialLocalStorage = {}) {
  resetChromeMock();
  await chrome.storage.sync.set(initialStorage);
  // Seeded BEFORE the module imports, so no listener exists yet — the
  // writes land silently and initTimerTab's restore path observes them.
  if (Object.keys(initialLocalStorage).length > 0) {
    await chrome.storage.local.set(initialLocalStorage);
  }
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
    expect(document.getElementById("input-hint").textContent).toMatch(/already in your list/i);
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

    const data = await chrome.storage.sync.get(["sites"]);
    const byDomain = Object.fromEntries(data.sites.map((s) => [s.domain, s.active]));
    expect(byDomain).toEqual({
      "reddit.com": false,
      "twitter.com": false,
      "youtube.com": true,
    });
  });
});

describe("popup.js — intervention mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders strip/block toggle for each site card", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "youtube.com", active: true, interventionMode: "strip" },
        { domain: "twitter.com", active: true, interventionMode: "block" },
      ],
    });

    const youtubeCard = document.querySelector('.site-card[data-domain="youtube.com"]');
    const twitterCard = document.querySelector('.site-card[data-domain="twitter.com"]');

    // Each card should have an intervention mode toggle
    const youtubeModeToggle = youtubeCard.querySelector('.intervention-mode-toggle');
    const twitterModeToggle = twitterCard.querySelector('.intervention-mode-toggle');

    expect(youtubeModeToggle).toBeTruthy();
    expect(twitterModeToggle).toBeTruthy();

    // YouTube should show "strip" as selected
    const youtubeModeValue = youtubeModeToggle.querySelector('.mode-value');
    expect(youtubeModeValue.textContent).toBe("strip");

    // Twitter should show "block" as selected
    const twitterModeValue = twitterModeToggle.querySelector('.mode-value');
    expect(twitterModeValue.textContent).toBe("block");
  });

  it("toggling intervention mode updates storage", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "youtube.com", active: true, interventionMode: "strip" },
      ],
    });

    const youtubeCard = document.querySelector('.site-card[data-domain="youtube.com"]');
    const modeToggle = youtubeCard.querySelector('.intervention-mode-toggle');
    const modeButton = modeToggle.querySelector('.mode-button');

    // Click to toggle from strip to block
    modeButton.click();
    await flushMicrotasks();

    const data = await chrome.storage.sync.get(["sites"]);
    const youtubeSite = data.sites.find((s) => s.domain === "youtube.com");
    expect(youtubeSite.interventionMode).toBe("block");
  });

  it("shows element-level toggles for YouTube in strip mode", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "youtube.com", active: true, interventionMode: "strip" },
      ],
    });

    const youtubeCard = document.querySelector('.site-card[data-domain="youtube.com"]');
    const elementToggles = youtubeCard.querySelector('.element-toggles');

    // YouTube should show element-level toggles
    expect(elementToggles).toBeTruthy();

    // Should have toggles for key elements
    const homeFeedToggle = elementToggles.querySelector('[data-element="homeFeed"]');
    const sidebarToggle = elementToggles.querySelector('[data-element="sidebar"]');
    const shortsToggle = elementToggles.querySelector('[data-element="shorts"]');
    const commentsToggle = elementToggles.querySelector('[data-element="comments"]');

    expect(homeFeedToggle).toBeTruthy();
    expect(sidebarToggle).toBeTruthy();
    expect(shortsToggle).toBeTruthy();
    expect(commentsToggle).toBeTruthy();
  });

  it("hides element-level toggles for unsupported platforms", async () => {
    await mountPopup({
      enabled: true,
      sites: [
        { domain: "twitter.com", active: true, interventionMode: "strip" },
      ],
    });

    const twitterCard = document.querySelector('.site-card[data-domain="twitter.com"]');
    const elementToggles = twitterCard.querySelector('.element-toggles');

    // Twitter doesn't have a stripping template yet, so no element toggles
    expect(elementToggles).toBeNull();
  });
});

/** Reads the popup flip clock's visible readout as "MM:SS" (top halves). */
function readPopupFlipDigits() {
  const mount = document.getElementById("popup-flip-clock");
  const digits = [...mount.querySelectorAll(".flip-digit")].map(
    (card) => card.querySelector(".flip-top .flip-glyph").textContent
  );
  return `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}`;
}

describe("popup.js — tabs", () => {
  beforeEach(() => {
    ensureLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("defaults to the Blocklist tab: sites panel visible, timer panel hidden", async () => {
    await mountPopup({ enabled: true, sites: [] });

    expect(document.getElementById("tab-btn-sites").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-btn-timer").getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("tab-panel-sites").hidden).toBe(false);
    expect(document.getElementById("tab-panel-timer").hidden).toBe(true);
  });

  it("clicking the Timer tab shows the timer panel, hides the sites panel, and updates aria-selected", async () => {
    await mountPopup({ enabled: true, sites: [] });

    document.getElementById("tab-btn-timer").click();

    expect(document.getElementById("tab-btn-timer").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-btn-sites").getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("tab-panel-timer").hidden).toBe(false);
    expect(document.getElementById("tab-panel-sites").hidden).toBe(true);

    // Switching back restores the original state.
    document.getElementById("tab-btn-sites").click();
    expect(document.getElementById("tab-btn-sites").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-panel-sites").hidden).toBe(false);
    expect(document.getElementById("tab-panel-timer").hidden).toBe(true);
  });

  it("ArrowRight/ArrowLeft move between tabs and activate them", async () => {
    await mountPopup({ enabled: true, sites: [] });

    const sitesTab = document.getElementById("tab-btn-sites");
    const timerTab = document.getElementById("tab-btn-timer");

    sitesTab.focus();
    sitesTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(timerTab.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-panel-timer").hidden).toBe(false);
    expect(document.activeElement).toBe(timerTab);

    timerTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(sitesTab.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-panel-sites").hidden).toBe(false);
    expect(document.activeElement).toBe(sitesTab);
  });

  it("persists the last active tab in localStorage and restores it on next open", async () => {
    await mountPopup({ enabled: true, sites: [] });
    document.getElementById("tab-btn-timer").click();
    expect(window.localStorage.getItem("focusguard_active_tab")).toBe("tab-btn-timer");

    // Re-open the popup (fresh module instance, same localStorage).
    await mountPopup({ enabled: true, sites: [] });
    expect(document.getElementById("tab-btn-timer").getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("tab-panel-timer").hidden).toBe(false);
    expect(document.getElementById("tab-panel-sites").hidden).toBe(true);
  });
});

describe("popup.js — Timer tab", () => {
  beforeEach(() => {
    ensureLocalStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("renders idle defaults from the settings sliders when no timer state is stored", async () => {
    await mountPopup({
      enabled: true,
      sites: [],
      pomodoroSettings: { workDuration: 30, shortBreak: 10, longBreak: 20, roundsBeforeLong: 3 },
    });

    expect(document.getElementById("popup-timer-digits").textContent).toBe("30:00");
    expect(readPopupFlipDigits()).toBe("30:00");
    expect(document.getElementById("popup-phase-label").textContent).toBe("WORK");
    expect(document.getElementById("popup-session-label").textContent).toBe("Session 1 of 3");
    expect(document.querySelectorAll("#popup-session-dots .popup-dot")).toHaveLength(3);
  });

  it("Start writes focusguard_timer_state to storage.local with isRunning true", async () => {
    await mountPopup({
      enabled: true,
      sites: [],
      pomodoroSettings: { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 },
    });

    document.getElementById("timer-start-btn").click();
    await flushMicrotasks();

    const data = await chrome.storage.local.get(["focusguard_timer_state"]);
    const state = data.focusguard_timer_state;
    expect(state).toBeTruthy();
    expect(state.isRunning).toBe(true);
    expect(state.phase).toBe("work");
    expect(state.totalTime).toBe(25 * 60);
    expect(state.totalRounds).toBe(4);
    expect(typeof state.endsAt).toBe("number");
    expect(state.remaining).toBeNull();
    expect(typeof state.savedAt).toBe("number");

    // The popup readout reflects the running state immediately.
    expect(document.getElementById("popup-timer-digits").textContent).toBe("25:00");
  });

  it("Pause/Skip/Reset write the corresponding transitions to the same storage key", async () => {
    await mountPopup({ enabled: true, sites: [] });

    // Start, then pause ~2s into the phase.
    vi.useFakeTimers();
    document.getElementById("timer-start-btn").click();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    document.getElementById("timer-pause-btn").click();
    await flushMicrotasks();

    let data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.isRunning).toBe(false);
    expect(data.focusguard_timer_state.endsAt).toBeNull();
    expect(data.focusguard_timer_state.remaining).toBe(25 * 60 - 2);
    vi.useRealTimers();

    // Skip moves to the short break, paused, full duration.
    document.getElementById("timer-skip-btn").click();
    await flushMicrotasks();
    data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.phase).toBe("shortBreak");
    expect(data.focusguard_timer_state.isRunning).toBe(false);
    expect(data.focusguard_timer_state.remaining).toBe(5 * 60);

    // Reset returns to round 1 work at the slider duration.
    document.getElementById("timer-reset-btn").click();
    await flushMicrotasks();
    data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.phase).toBe("work");
    expect(data.focusguard_timer_state.currentRound).toBe(1);
    expect(data.focusguard_timer_state.totalTime).toBe(25 * 60);
  });

  it("a storage.onChanged write from the blocked-page side updates the popup readout live", async () => {
    await mountPopup({ enabled: true, sites: [] });
    expect(document.getElementById("popup-timer-digits").textContent).toBe("25:00");

    // Simulate the blocked page persisting a paused short-break state.
    await chrome.storage.local.set({
      focusguard_timer_state: {
        phase: "shortBreak",
        currentRound: 2,
        totalRounds: 4,
        totalTime: 300,
        isRunning: false,
        endsAt: null,
        remaining: 120,
        savedAt: Date.now(),
      },
    });
    await flushMicrotasks();

    expect(document.getElementById("popup-timer-digits").textContent).toBe("02:00");
    expect(readPopupFlipDigits()).toBe("02:00");
    expect(document.getElementById("popup-phase-label").textContent).toBe("BREAK");
    expect(document.getElementById("popup-session-label").textContent).toBe("Session 2 of 4");
    const dots = document.querySelectorAll("#popup-session-dots .popup-dot");
    expect(dots).toHaveLength(4);
    expect(dots[0].classList.contains("completed")).toBe(true);
    expect(dots[1].classList.contains("active")).toBe(true);
  });

  it("while running, a 1s ticker repaints the readout from the endsAt deadline", async () => {
    await mountPopup({ enabled: true, sites: [] });

    vi.useFakeTimers();
    const now = Date.now();
    await chrome.storage.local.set({
      focusguard_timer_state: {
        phase: "work",
        currentRound: 1,
        totalRounds: 4,
        totalTime: 1500,
        isRunning: true,
        endsAt: now + 65_000,
        remaining: null,
        savedAt: now,
      },
    });
    await flushMicrotasks();
    expect(document.getElementById("popup-timer-digits").textContent).toBe("01:05");

    await vi.advanceTimersByTimeAsync(1000);
    expect(document.getElementById("popup-timer-digits").textContent).toBe("01:04");
    expect(readPopupFlipDigits()).toBe("01:04");

    await vi.advanceTimersByTimeAsync(2000);
    expect(document.getElementById("popup-timer-digits").textContent).toBe("01:02");
  });

  it("the 1s ticker advances the phase when the deadline passes while the popup is open", async () => {
    await mountPopup({ enabled: true, sites: [] });

    vi.useFakeTimers();
    const now = Date.now();
    await chrome.storage.local.set({
      focusguard_timer_state: {
        phase: "work",
        currentRound: 1,
        totalRounds: 4,
        totalTime: 1500,
        isRunning: true,
        endsAt: now + 2000,
        remaining: null,
        savedAt: now,
      },
    });
    await flushMicrotasks();
    expect(document.getElementById("popup-timer-digits").textContent).toBe("00:02");

    // Past the deadline the ticker must run the same completion
    // transition the blocked page uses (skip → next phase, paused)
    // instead of freezing at 00:00 "running" forever.
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    expect(document.getElementById("popup-phase-label").textContent).toBe("BREAK");
    expect(document.getElementById("popup-timer-digits").textContent).toBe("05:00");

    const data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.phase).toBe("shortBreak");
    expect(data.focusguard_timer_state.isRunning).toBe(false);
  });

  it("restore advances one phase when a fresh running state's deadline already passed", async () => {
    const now = Date.now();
    await mountPopup(
      { enabled: true, sites: [] },
      {
        focusguard_timer_state: {
          phase: "work",
          currentRound: 1,
          totalRounds: 4,
          totalTime: 1500,
          isRunning: true,
          endsAt: now - 5000,
          remaining: null,
          savedAt: now,
        },
      }
    );

    // Mirrors blocked.js's reviveState(): exactly one phase advance, and
    // since the session was running it keeps running into the new phase.
    expect(document.getElementById("popup-phase-label").textContent).toBe("BREAK");
    expect(document.getElementById("popup-timer-digits").textContent).toBe("05:00");
  });

  it("discards a stored state older than 2h to idle defaults and never re-persists it", async () => {
    const staleSavedAt = Date.now() - (2 * 60 * 60 * 1000 + 60_000);
    await mountPopup(
      { enabled: true, sites: [] },
      {
        focusguard_timer_state: {
          phase: "shortBreak",
          currentRound: 2,
          totalRounds: 4,
          totalTime: 300,
          isRunning: false,
          endsAt: null,
          remaining: 42,
          savedAt: staleSavedAt,
        },
      }
    );

    // Stale session is not surfaced — idle defaults from the sliders.
    expect(document.getElementById("popup-timer-digits").textContent).toBe("25:00");
    expect(document.getElementById("popup-phase-label").textContent).toBe("WORK");
    expect(document.getElementById("popup-session-label").textContent).toBe("Session 1 of 4");

    // And not laundered back into storage with a fresh savedAt.
    const data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.savedAt).toBe(staleSavedAt);
    expect(data.focusguard_timer_state.phase).toBe("shortBreak");
  });

  it("Open full-screen timer creates a tab at blocked/blocked.html", async () => {
    await mountPopup({ enabled: true, sites: [] });

    document.getElementById("open-full-timer-btn").click();
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining("blocked/blocked.html") })
    );
  });
});
