/**
 * flip-clock.test.js — unit tests for lib/flip-clock.js.
 *
 * The core contract is DIGIT DIFFING: setTime("MM:SS") must animate ONLY
 * the cards whose digit changed (seconds-ones flips every tick; the minute
 * digits flip once per 60 ticks). "Animating" is observable as the card's
 * `.is-flipping` class + transient `.flip-leaf` elements; unchanged cards
 * must carry neither.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFlipClock } from "../../lib/flip-clock.js";

/** Readout helper: the currently visible digit of each card, in order. */
function readDigits(container) {
  return [...container.querySelectorAll(".flip-digit")].map(
    (card) => card.querySelector(".flip-top .flip-glyph").textContent
  );
}

function cardsOf(container) {
  return [...container.querySelectorAll(".flip-digit")];
}

describe("flip clock — structure", () => {
  let container;
  let clock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    clock = createFlipClock(container);
  });

  afterEach(() => {
    clock.destroy();
    document.body.innerHTML = "";
  });

  it("builds four digit cards and one colon separator", () => {
    expect(cardsOf(container)).toHaveLength(4);
    expect(container.querySelectorAll(".flip-colon")).toHaveLength(1);
    // Every card has a top and a bottom static half.
    cardsOf(container).forEach((card) => {
      expect(card.querySelector(".flip-top")).toBeTruthy();
      expect(card.querySelector(".flip-bottom")).toBeTruthy();
    });
  });

  it("marks the container aria-hidden and adds the flip-clock class", () => {
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(container.classList.contains("flip-clock")).toBe(true);
  });
});

describe("flip clock — setTime", () => {
  let container;
  let clock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    clock = createFlipClock(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    clock.destroy();
    document.body.innerHTML = "";
  });

  it("first paint shows the initial time without flipping anything", () => {
    clock.setTime("25:00");
    expect(readDigits(container).join("")).toBe("2500");
    expect(clock.getTime()).toBe("25:00");
    cardsOf(container).forEach((card) => {
      expect(card.classList.contains("is-flipping")).toBe(false);
      expect(card.querySelectorAll(".flip-leaf")).toHaveLength(0);
    });
  });

  it("flips ONLY the digits that changed", () => {
    clock.setTime("25:00");
    clock.setTime("24:59");

    const cards = cardsOf(container);
    // "2" unchanged → no flip. "5→4", "0→5", "0→9" → flip.
    expect(cards[0].classList.contains("is-flipping")).toBe(false);
    expect(cards[0].querySelectorAll(".flip-leaf")).toHaveLength(0);
    for (let i = 1; i < 4; i++) {
      expect(cards[i].classList.contains("is-flipping")).toBe(true);
      // One folding top leaf + one unfolding bottom leaf per changed card.
      expect(cards[i].querySelectorAll(".flip-leaf")).toHaveLength(2);
    }

    // The new digits are already readable on the static top halves.
    expect(readDigits(container).join("")).toBe("2459");
  });

  it("does not re-flip when the same time is set again", () => {
    clock.setTime("25:00");
    clock.setTime("24:59");
    clock.setTime("24:59"); // no-op

    const cards = cardsOf(container);
    // State is identical to the previous test's first flip — but a second
    // setTime with the same value must not add leaves or restart flips.
    cards.forEach((card) => {
      expect(card.querySelectorAll(".flip-leaf").length).toBeLessThanOrEqual(2);
    });
    expect(readDigits(container).join("")).toBe("2459");
  });

  it("minute digits stay untouched on a plain seconds tick", () => {
    clock.setTime("24:59");
    clock.setTime("24:58"); // only the seconds-ones digit changes

    const cards = cardsOf(container);
    expect(cards[0].classList.contains("is-flipping")).toBe(false);
    expect(cards[1].classList.contains("is-flipping")).toBe(false);
    expect(cards[2].classList.contains("is-flipping")).toBe(false);
    expect(cards[3].classList.contains("is-flipping")).toBe(true);
  });

  it("finalizes flips after the animation window (leaves removed, bottoms synced)", async () => {
    vi.useFakeTimers();
    clock.setTime("25:00");
    clock.setTime("24:59");

    // Full flip = 2 x 300ms. After that, leaves are gone and the static
    // bottom halves match the top halves.
    await vi.advanceTimersByTimeAsync(700);

    cardsOf(container).forEach((card, i) => {
      expect(card.classList.contains("is-flipping")).toBe(false);
      expect(card.querySelectorAll(".flip-leaf")).toHaveLength(0);
      const top = card.querySelector(".flip-top .flip-glyph").textContent;
      const bottom = card.querySelector(".flip-bottom .flip-glyph").textContent;
      expect(bottom).toBe(top);
      expect(top).toBe("2459"[i]);
    });
  });

  it("clamps malformed input to 00:00", () => {
    clock.setTime("garbage");
    expect(readDigits(container).join("")).toBe("0000");
    expect(clock.getTime()).toBe("00:00");
  });

  it("destroy() clears pending timers and empties the container", async () => {
    vi.useFakeTimers();
    clock.setTime("25:00");
    clock.setTime("24:59");
    clock.destroy();

    expect(container.innerHTML).toBe("");
    expect(container.classList.contains("flip-clock")).toBe(false);
    // No dangling timeouts fire after destroy (would throw if they touched
    // the removed cards' DOM refs in a way that assumes mount state).
    await vi.advanceTimersByTimeAsync(1000);
    expect(container.innerHTML).toBe("");
    // setTime after destroy is a no-op.
    clock.setTime("12:34");
    expect(container.innerHTML).toBe("");
  });
});

describe("flip clock — reduced motion", () => {
  it("updates digits instantly with no leaves or flipping classes when prefers-reduced-motion matches", () => {
    // jsdom ships no matchMedia; stub it to match the reduce query.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }));

    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const clock = createFlipClock(container);

      clock.setTime("25:00");
      clock.setTime("24:59"); // three digits change

      // The new readout is visible IMMEDIATELY...
      expect(readDigits(container).join("")).toBe("2459");
      expect(clock.getTime()).toBe("24:59");

      // ...with no animation artifacts on any card.
      cardsOf(container).forEach((card, i) => {
        expect(card.classList.contains("is-flipping")).toBe(false);
        expect(card.querySelectorAll(".flip-leaf")).toHaveLength(0);
        // Bottom halves catch up instantly too.
        const top = card.querySelector(".flip-top .flip-glyph").textContent;
        const bottom = card.querySelector(".flip-bottom .flip-glyph").textContent;
        expect(bottom).toBe(top);
        expect(top).toBe("2459"[i]);
      });

      // And nothing appears even after the would-be animation window.
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      cardsOf(container).forEach((card) => {
        expect(card.classList.contains("is-flipping")).toBe(false);
        expect(card.querySelectorAll(".flip-leaf")).toHaveLength(0);
      });
      vi.useRealTimers();

      clock.destroy();
    } finally {
      if (originalMatchMedia === undefined) {
        delete window.matchMedia;
      } else {
        window.matchMedia = originalMatchMedia;
      }
      document.body.innerHTML = "";
    }
  });
});
