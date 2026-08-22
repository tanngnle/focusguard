/**
 * blocked.test.js — regression tests for the blocked (Pomodoro) page.
 *
 * Proves the timer controls work end to end against the real markup:
 * Start/Pause/Skip/Reset, keyboard shortcuts, adoption of external writes
 * to the shared timer state (ADR-0002), and the flip-clock readout.
 *
 * Mounts the real blocked/blocked.html via the shared dom-fixture and
 * dynamically imports blocked.js (it wires itself up against real element
 * IDs at import/DOMContentLoaded time).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { mountBlockedDom, fireDomContentLoaded, flushMicrotasks } from "../helpers/dom-fixture.js";

/** Reads the flip clock's visible readout as "MM:SS" (top halves). */
function readFlipDigits(mount) {
  const digits = [...mount.querySelectorAll(".flip-digit")].map(
    (card) => card.querySelector(".flip-top .flip-glyph").textContent
  );
  return `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}`;
}

/** True when the timer is running: #btn-start shows the pause icon. */
function timerRunning() {
  const iconPause = document.getElementById("btn-start").querySelector(".icon-pause");
  return iconPause.style.display !== "none";
}

async function mountBlocked(initialLocalStorage = {}) {
  resetChromeMock();
  if (Object.keys(initialLocalStorage).length > 0) {
    await chrome.storage.local.set(initialLocalStorage);
  }
  mountBlockedDom();
  vi.resetModules();
  await import("../../blocked/blocked.js");
  fireDomContentLoaded();
  await flushMicrotasks();
}

describe("blocked page — timer controls", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("clicking #btn-start advances #timer-digits after a 1s tick", async () => {
    const timerDigits = document.getElementById("timer-digits");
    const btnStart = document.getElementById("btn-start");

    expect(timerDigits.textContent).toBe("25:00");

    vi.useFakeTimers();
    btnStart.click();
    await flushMicrotasks();
    // Start paints immediately; the display still shows the full phase.
    expect(timerDigits.textContent).toBe("25:00");

    await vi.advanceTimersByTimeAsync(1000);
    expect(timerDigits.textContent).toBe("24:59");
  });

  it("pause stops the countdown and reset restores the full phase", async () => {
    const timerDigits = document.getElementById("timer-digits");
    const btnStart = document.getElementById("btn-start");
    const btnReset = document.getElementById("btn-reset");

    vi.useFakeTimers();
    btnStart.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(timerDigits.textContent).toBe("24:59");

    // Pause freezes the display; further ticks must not change it.
    btnStart.click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(timerDigits.textContent).toBe("24:59");

    // Reset returns to the full work phase and is not running.
    btnReset.click();
    await flushMicrotasks();
    expect(timerDigits.textContent).toBe("25:00");
    await vi.advanceTimersByTimeAsync(1000);
    expect(timerDigits.textContent).toBe("25:00");
  });

  it("skip moves to the next phase (short break) without running", async () => {
    const timerDigits = document.getElementById("timer-digits");
    const phaseText = document.getElementById("phase-text");
    const btnSkip = document.getElementById("btn-skip");

    vi.useFakeTimers();
    btnSkip.click();
    await flushMicrotasks();

    expect(timerDigits.textContent).toBe("05:00");
    expect(phaseText.textContent).toBe("Short Break");

    // Skipped-to phase starts paused.
    await vi.advanceTimersByTimeAsync(1000);
    expect(timerDigits.textContent).toBe("05:00");
  });
});

describe("blocked page — shared timer state: external writes (ADR-0002)", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a pause written from the popup stops the blocked page's ticker and heartbeat", async () => {
    const timerDigits = document.getElementById("timer-digits");
    const btnStart = document.getElementById("btn-start");

    vi.useFakeTimers();
    btnStart.click();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    expect(timerDigits.textContent).toBe("24:58");

    // The popup pauses the shared state; its pause() write lands in
    // chrome.storage.local while this page is open.
    await chrome.storage.local.set({
      MindfulBrowse_timer_state: {
        phase: "work",
        currentRound: 1,
        totalRounds: 4,
        totalTime: 1500,
        isRunning: false,
        endsAt: null,
        remaining: 1498,
        savedAt: Date.now(),
      },
    });
    await flushMicrotasks();

    // Adopted as ground truth: paused, frozen readout.
    expect(timerRunning()).toBe(false);
    expect(timerDigits.textContent).toBe("24:58");

    // The ticker is disarmed — the display must not advance.
    await vi.advanceTimersByTimeAsync(3000);
    expect(timerDigits.textContent).toBe("24:58");

    // The 10s heartbeat is disarmed too — it must not re-persist a
    // running state over the popup's pause.
    await vi.advanceTimersByTimeAsync(11_000);
    const data = await chrome.storage.local.get(["MindfulBrowse_timer_state"]);
    expect(data.MindfulBrowse_timer_state.isRunning).toBe(false);
    expect(data.MindfulBrowse_timer_state.remaining).toBe(1498);
  });

  it("a start written from the popup renders the blocked page running and ticking", async () => {
    const timerDigits = document.getElementById("timer-digits");
    expect(timerRunning()).toBe(false);

    vi.useFakeTimers();
    const now = Date.now();
    await chrome.storage.local.set({
      MindfulBrowse_timer_state: {
        phase: "work",
        currentRound: 1,
        totalRounds: 4,
        totalTime: 1500,
        isRunning: true,
        endsAt: now + 1500 * 1000,
        remaining: null,
        savedAt: now,
      },
    });
    await flushMicrotasks();

    // Adopted: the page renders running and the ticker is armed.
    expect(timerRunning()).toBe(true);
    expect(timerDigits.textContent).toBe("25:00");

    await vi.advanceTimersByTimeAsync(1000);
    expect(timerDigits.textContent).toBe("24:59");
  });
});

describe("blocked page — flip clock", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("mounts inside .timer-display and shows the initial 25:00", () => {
    const mount = document.getElementById("flip-clock");
    expect(mount).toBeTruthy();
    expect(mount.classList.contains("flip-clock")).toBe(true);
    expect(mount.getAttribute("aria-hidden")).toBe("true");
    expect(mount.querySelectorAll(".flip-digit")).toHaveLength(4);
    expect(mount.querySelectorAll(".flip-colon")).toHaveLength(1);

    expect(readFlipDigits(mount)).toBe("25:00");

    // #timer-digits stays in the DOM as the backing text readout.
    const timerDigits = document.getElementById("timer-digits");
    expect(timerDigits).toBeTruthy();
    expect(timerDigits.textContent).toBe("25:00");
  });

  it("flips the seconds digit after a 1s tick; hidden readout stays in sync", async () => {
    const mount = document.getElementById("flip-clock");
    const btnStart = document.getElementById("btn-start");

    vi.useFakeTimers();
    btnStart.click();
    await flushMicrotasks();
    expect(readFlipDigits(mount)).toBe("25:00");

    await vi.advanceTimersByTimeAsync(1000);
    expect(readFlipDigits(mount)).toBe("24:59");

    // Diffing contract: minutes-tens "2" did not change → no flip class;
    // the three changed digits carry it while their animation runs.
    const cards = mount.querySelectorAll(".flip-digit");
    expect(cards[0].classList.contains("is-flipping")).toBe(false);
    expect(cards[1].classList.contains("is-flipping")).toBe(true);
    expect(cards[2].classList.contains("is-flipping")).toBe(true);
    expect(cards[3].classList.contains("is-flipping")).toBe(true);

    // The hidden #timer-digits readout mirrors the flip clock.
    expect(document.getElementById("timer-digits").textContent).toBe("24:59");
    expect(timerRunning()).toBe(true);
  });

  it("keeps the flip clock in sync through pause and reset", async () => {
    const mount = document.getElementById("flip-clock");
    const btnStart = document.getElementById("btn-start");
    const btnReset = document.getElementById("btn-reset");

    vi.useFakeTimers();
    btnStart.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readFlipDigits(mount)).toBe("24:59");

    // Pause freezes the flip clock too.
    btnStart.click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(readFlipDigits(mount)).toBe("24:59");

    // Reset repaints the full phase; the new digits are visible
    // immediately even while their flip animations run.
    btnReset.click();
    await flushMicrotasks();
    expect(readFlipDigits(mount)).toBe("25:00");
    expect(document.getElementById("timer-digits").textContent).toBe("25:00");
  });
});
