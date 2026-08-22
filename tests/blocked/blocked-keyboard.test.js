/**
 * blocked-keyboard.test.js — keyboard shortcut tests for the blocked page.
 *
 * Lives in its own file on purpose: blocked.js registers document-level
 * keydown listeners at import time, and jsdom's document is shared across
 * every test in a file. Mounting the page multiple times in one file would
 * stack one stale listener per mount; a fresh document per file keeps the
 * assertions deterministic.
 *
 * Mounts the real blocked/blocked.html via the shared dom-fixture and
 * dynamically imports blocked.js (it wires itself up against real element
 * IDs at import/DOMContentLoaded time).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMock } from "../helpers/chrome-mock.js";
import { mountBlockedDom, fireDomContentLoaded, flushMicrotasks } from "../helpers/dom-fixture.js";

/** True when the timer is running: #btn-start shows the pause icon. */
function timerRunning() {
  const iconPause = document.getElementById("btn-start").querySelector(".icon-pause");
  return iconPause.style.display !== "none";
}

async function mountBlocked() {
  resetChromeMock();
  mountBlockedDom();
  vi.resetModules();
  await import("../../blocked/blocked.js");
  fireDomContentLoaded();
  await flushMicrotasks();
}

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

  it("Space toggles the timer start/pause", async () => {
    expect(timerRunning()).toBe(false);

    pressSpace();
    await flushMicrotasks();
    expect(timerRunning()).toBe(true);

    pressSpace();
    await flushMicrotasks();
    expect(timerRunning()).toBe(false);
  });

  it("Space is ignored while focus is in a typing context", async () => {
    // The blocked page ships no text inputs; inject one to stand in for
    // any focused editable element.
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    pressSpace();
    await flushMicrotasks();
    expect(timerRunning()).toBe(false);

    input.remove();
  });

  it("Space on a focused control button does not double-toggle", async () => {
    // Buttons are typing contexts for the Space shortcut: the button's own
    // click activation must be the only effect, not click + shortcut.
    const btnStart = document.getElementById("btn-start");
    btnStart.focus();
    expect(document.activeElement).toBe(btnStart);

    pressSpace();
    await flushMicrotasks();
    // The shortcut skipped (focused button); the synthetic event here did
    // not click the button either, so the timer stays paused.
    expect(timerRunning()).toBe(false);
  });
});
