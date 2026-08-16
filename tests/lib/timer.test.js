import { describe, it, expect } from "vitest";
import {
  initialState,
  phaseDuration,
  remainingSeconds,
  advancePhase,
  formatTime,
} from "../../lib/timer.js";

const settings = { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 };

describe("phaseDuration", () => {
  it("returns work duration in seconds", () => {
    expect(phaseDuration("work", settings)).toBe(25 * 60);
  });

  it("returns short break duration in seconds", () => {
    expect(phaseDuration("shortBreak", settings)).toBe(5 * 60);
  });

  it("returns long break duration in seconds", () => {
    expect(phaseDuration("longBreak", settings)).toBe(15 * 60);
  });

  it("defaults an unknown phase to the work duration", () => {
    expect(phaseDuration("bogus", settings)).toBe(25 * 60);
  });

  it("falls back to hardcoded defaults for missing settings fields", () => {
    expect(phaseDuration("work", {})).toBe(25 * 60);
    expect(phaseDuration("shortBreak", {})).toBe(5 * 60);
    expect(phaseDuration("longBreak", {})).toBe(15 * 60);
  });
});

describe("initialState", () => {
  it("starts in the work phase, round 1, not running", () => {
    const state = initialState(settings);
    expect(state.phase).toBe("work");
    expect(state.currentRound).toBe(1);
    expect(state.isRunning).toBe(false);
  });

  it("sets totalTime to the work duration and remaining to the same value", () => {
    const state = initialState(settings);
    expect(state.totalTime).toBe(25 * 60);
    expect(state.remaining).toBe(25 * 60);
  });

  it("sets endsAt to null since it is not running", () => {
    const state = initialState(settings);
    expect(state.endsAt).toBeNull();
  });

  it("reads totalRounds from settings.roundsBeforeLong", () => {
    const state = initialState(settings);
    expect(state.totalRounds).toBe(4);
  });

  it("defaults totalRounds to 4 when roundsBeforeLong is missing", () => {
    const state = initialState({});
    expect(state.totalRounds).toBe(4);
  });
});

describe("remainingSeconds", () => {
  it("while running, derives remaining time from endsAt and now", () => {
    const now = 1_000_000;
    const state = { isRunning: true, endsAt: now + 10_000, remaining: null };
    expect(remainingSeconds(state, now)).toBe(10);
  });

  it("while running, rounds up partial seconds (ceil)", () => {
    const now = 1_000_000;
    const state = { isRunning: true, endsAt: now + 1500, remaining: null };
    expect(remainingSeconds(state, now)).toBe(2);
  });

  it("while running, clamps to 0 when the deadline is already in the past", () => {
    const now = 1_000_000;
    const state = { isRunning: true, endsAt: now - 60_000, remaining: null };
    expect(remainingSeconds(state, now)).toBe(0);
  });

  it("while running with a null endsAt, returns 0", () => {
    const now = 1_000_000;
    const state = { isRunning: true, endsAt: null, remaining: null };
    expect(remainingSeconds(state, now)).toBe(0);
  });

  it("while paused, uses the frozen `remaining` field, ignoring endsAt entirely", () => {
    const now = 1_000_000;
    // endsAt is stale/in the past, but since isRunning is false it must be ignored.
    const state = { isRunning: false, endsAt: now - 999_999, remaining: 42 };
    expect(remainingSeconds(state, now)).toBe(42);
  });

  it("while paused, never returns negative even if remaining is negative", () => {
    const state = { isRunning: false, endsAt: null, remaining: -5 };
    expect(remainingSeconds(state, 0)).toBe(0);
  });

  it("while paused with a null remaining, treats it as 0", () => {
    const state = { isRunning: false, endsAt: null, remaining: null };
    expect(remainingSeconds(state, 0)).toBe(0);
  });
});

describe("advancePhase — isRunning pass-through semantic", () => {
  it("when input isRunning is false, output stays not running with endsAt null and remaining = new phase duration", () => {
    const state = { ...initialState(settings), isRunning: false };
    const now = 5_000_000;
    const next = advancePhase(state, settings, now);
    expect(next.isRunning).toBe(false);
    expect(next.endsAt).toBeNull();
    expect(next.remaining).toBe(phaseDuration("shortBreak", settings));
  });

  it("when input isRunning is true, output stays running with a fresh endsAt anchored to now and remaining null", () => {
    const state = { ...initialState(settings), isRunning: true, endsAt: 123 };
    const now = 5_000_000;
    const next = advancePhase(state, settings, now);
    expect(next.isRunning).toBe(true);
    expect(next.remaining).toBeNull();
    expect(next.endsAt).toBe(now + phaseDuration("shortBreak", settings) * 1000);
  });
});

describe("advancePhase — full cycle", () => {
  it("cycles work -> shortBreak -> work -> shortBreak -> work -> longBreak -> work, incrementing/resetting currentRound correctly", () => {
    // roundsBeforeLong = 4: rounds 1,2,3 -> shortBreak; round 4 -> longBreak.
    let state = initialState(settings); // phase=work, round=1
    let now = 0;

    // Round 1 work -> shortBreak
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("shortBreak");
    expect(state.currentRound).toBe(1);

    // shortBreak -> work (round 2)
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("work");
    expect(state.currentRound).toBe(2);

    // Round 2 work -> shortBreak
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("shortBreak");
    expect(state.currentRound).toBe(2);

    // shortBreak -> work (round 3)
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("work");
    expect(state.currentRound).toBe(3);

    // Round 3 work -> shortBreak
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("shortBreak");
    expect(state.currentRound).toBe(3);

    // shortBreak -> work (round 4)
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("work");
    expect(state.currentRound).toBe(4);

    // Round 4 work -> longBreak (currentRound >= totalRounds)
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("longBreak");
    expect(state.currentRound).toBe(4);

    // longBreak -> work, currentRound resets to 1
    state = advancePhase({ ...state, isRunning: false }, settings, now++);
    expect(state.phase).toBe("work");
    expect(state.currentRound).toBe(1);
  });

  it("totalTime on the returned state matches the new phase's duration", () => {
    let state = initialState(settings);
    const next = advancePhase({ ...state, isRunning: false }, settings, 0);
    expect(next.totalTime).toBe(phaseDuration("shortBreak", settings));
  });

  it("totalRounds is preserved across transitions", () => {
    let state = initialState(settings);
    const next = advancePhase({ ...state, isRunning: false }, settings, 0);
    expect(next.totalRounds).toBe(settings.roundsBeforeLong);
  });
});

describe("formatTime", () => {
  it("zero-pads minutes and seconds under 10", () => {
    expect(formatTime(65)).toBe("01:05");
  });

  it("formats exactly zero as 00:00", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  it("clamps negative values to 00:00", () => {
    expect(formatTime(-30)).toBe("00:00");
  });

  it("clamps non-finite input (NaN) to 00:00", () => {
    expect(formatTime(NaN)).toBe("00:00");
  });

  it("clamps non-finite input (Infinity) to 00:00", () => {
    expect(formatTime(Infinity)).toBe("00:00");
  });

  it("formats values over an hour with minutes rolling past 59", () => {
    expect(formatTime(3661)).toBe("61:01"); // 1h 1m 1s -> no hour field, minutes just grow
  });

  it("floors fractional seconds", () => {
    expect(formatTime(65.9)).toBe("01:05");
  });

  it("formats double-digit minutes and seconds without extra padding", () => {
    expect(formatTime(25 * 60)).toBe("25:00");
  });
});
