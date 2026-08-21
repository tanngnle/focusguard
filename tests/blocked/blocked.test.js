/**
 * blocked.test.js — regression tests for the blocked (Pomodoro) page.
 *
 * These exist because of a specific bug: the Bao panda chat overlay was
 * rendered full-viewport on top of the timer with no close mechanism, so
 * #btn-start / #btn-reset / #btn-skip were unreachable (the overlay
 * swallowed every pointer event). The fix hides the overlay by default,
 * adds a #chat-launcher button to open it, and makes #timer-strip close
 * it. Test (1) below pins that contract; tests (2)-(4) prove the timer
 * controls actually work end to end, and (5) covers the open/close path.
 *
 * Mounts the real blocked/blocked.html via the shared dom-fixture and
 * dynamically imports blocked.js + blocked-chat.js (both wire themselves
 * up against real element IDs at import/DOMContentLoaded time).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { mountBlockedDom, fireDomContentLoaded, flushMicrotasks } from "../helpers/dom-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

/** Reads the flip clock's visible readout as "MM:SS" (top halves). */
function readFlipDigits(mount) {
  const digits = [...mount.querySelectorAll(".flip-digit")].map(
    (card) => card.querySelector(".flip-top .flip-glyph").textContent
  );
  return `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}`;
}

async function mountBlocked(initialLocalStorage = {}) {
  resetChromeMock();
  if (Object.keys(initialLocalStorage).length > 0) {
    await chrome.storage.local.set(initialLocalStorage);
  }
  mountBlockedDom();
  vi.resetModules();
  // blocked.js first: it exposes window.__focusguardTimer at module top
  // level, which blocked-chat.js's timer strip reads during init.
  await import("../../blocked/blocked.js");
  await import("../../blocked/blocked-chat.js");
  fireDomContentLoaded();
  await flushMicrotasks();
}

describe("blocked page — chat overlay does not cover the timer", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("overlay is hidden at load and #btn-start is reachable", () => {
    const overlay = document.getElementById("chat-overlay");
    const btnStart = document.getElementById("btn-start");
    const launcher = document.getElementById("chat-launcher");

    // The overlay must start closed (no `.open` class) — an open overlay
    // is the only state in which it covers the timer controls.
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains("open")).toBe(false);

    // The launcher that re-opens Bao must exist with an accessible name.
    expect(launcher).toBeTruthy();
    expect(launcher.getAttribute("aria-label")).toMatch(/bao/i);

    // jsdom applies no stylesheets, so also pin the visibility contract
    // directly against the shipped CSS: `.chat-overlay` defaults to
    // display:none and only `.chat-overlay.open` is display:flex.
    const css = readFileSync(path.join(ROOT, "blocked", "blocked-chat.css"), "utf8");
    expect(css).toMatch(/\.chat-overlay\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.chat-overlay\.open\s*\{[^}]*display:\s*flex/);

    // And the control itself must be present and enabled.
    expect(btnStart).toBeTruthy();
    expect(btnStart.disabled).toBe(false);
  });
});

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

describe("blocked page — overlay open/close", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("launcher click opens the overlay and focuses the chat input", () => {
    const overlay = document.getElementById("chat-overlay");
    const launcher = document.getElementById("chat-launcher");
    const chatInput = document.getElementById("chat-input");

    launcher.click();
    expect(overlay.classList.contains("open")).toBe(true);
    expect(document.activeElement).toBe(chatInput);
  });

  it("timer-strip click closes an open overlay", () => {
    const overlay = document.getElementById("chat-overlay");
    const launcher = document.getElementById("chat-launcher");
    const timerStrip = document.getElementById("timer-strip");

    launcher.click();
    expect(overlay.classList.contains("open")).toBe(true);

    timerStrip.click();
    expect(overlay.classList.contains("open")).toBe(false);
  });
});

describe("blocked page — keyboard shortcuts", () => {
  beforeEach(async () => {
    await mountBlocked();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function pressSpace() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true })
    );
  }

  function pressEscape() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
  }

  it("Space toggles the timer start/pause", async () => {
    expect(window.__focusguardTimer.isRunning()).toBe(false);

    pressSpace();
    await flushMicrotasks();
    expect(window.__focusguardTimer.isRunning()).toBe(true);

    pressSpace();
    await flushMicrotasks();
    expect(window.__focusguardTimer.isRunning()).toBe(false);
  });

  it("Space is ignored while the chat overlay is open", async () => {
    document.getElementById("chat-launcher").click();
    expect(document.getElementById("chat-overlay").classList.contains("open")).toBe(true);

    pressSpace();
    await flushMicrotasks();
    expect(window.__focusguardTimer.isRunning()).toBe(false);
  });

  it("Space is ignored while focus is in a typing context", async () => {
    const chatInput = document.getElementById("chat-input");
    chatInput.focus();
    expect(document.activeElement).toBe(chatInput);

    pressSpace();
    await flushMicrotasks();
    expect(window.__focusguardTimer.isRunning()).toBe(false);
  });

  it("Escape closes an open chat overlay", () => {
    const overlay = document.getElementById("chat-overlay");
    document.getElementById("chat-launcher").click();
    expect(overlay.classList.contains("open")).toBe(true);

    pressEscape();
    expect(overlay.classList.contains("open")).toBe(false);
  });

  it("Escape is a no-op when the overlay is closed and does not touch the timer", async () => {
    pressSpace();
    await flushMicrotasks();
    expect(window.__focusguardTimer.isRunning()).toBe(true);

    pressEscape();
    expect(document.getElementById("chat-overlay").classList.contains("open")).toBe(false);
    expect(window.__focusguardTimer.isRunning()).toBe(true);
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
      focusguard_timer_state: {
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
    expect(window.__focusguardTimer.isRunning()).toBe(false);
    expect(timerDigits.textContent).toBe("24:58");

    // The ticker is disarmed — the display must not advance.
    await vi.advanceTimersByTimeAsync(3000);
    expect(timerDigits.textContent).toBe("24:58");

    // The 10s heartbeat is disarmed too — it must not re-persist a
    // running state over the popup's pause.
    await vi.advanceTimersByTimeAsync(11_000);
    const data = await chrome.storage.local.get(["focusguard_timer_state"]);
    expect(data.focusguard_timer_state.isRunning).toBe(false);
    expect(data.focusguard_timer_state.remaining).toBe(1498);
  });

  it("a start written from the popup renders the blocked page running and ticking", async () => {
    const timerDigits = document.getElementById("timer-digits");
    expect(window.__focusguardTimer.isRunning()).toBe(false);

    vi.useFakeTimers();
    const now = Date.now();
    await chrome.storage.local.set({
      focusguard_timer_state: {
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
    expect(window.__focusguardTimer.isRunning()).toBe(true);
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

    // #timer-digits stays in the DOM and still backs getDisplay().
    const timerDigits = document.getElementById("timer-digits");
    expect(timerDigits).toBeTruthy();
    expect(timerDigits.textContent).toBe("25:00");
    expect(window.__focusguardTimer.getDisplay()).toBe("25:00");
  });

  it("flips the seconds digit after a 1s tick; getDisplay() contract intact", async () => {
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

    // The hidden #timer-digits and its API mirror stay the source of truth.
    expect(document.getElementById("timer-digits").textContent).toBe("24:59");
    expect(window.__focusguardTimer.getDisplay()).toBe("24:59");
    expect(window.__focusguardTimer.isRunning()).toBe(true);
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
    expect(window.__focusguardTimer.getDisplay()).toBe("25:00");
  });
});
