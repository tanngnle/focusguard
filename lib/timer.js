/*  ═══════════════════════════════════════════════════════
    FocusGuard — Pure Pomodoro Timer Model
    No chrome.*, no DOM, no internal Date.now() — every call
    that needs the current time takes `now` as a parameter.
    ═══════════════════════════════════════════════════════ */

// ── Phase durations ─────────────────────────────────────
// settings = { workDuration, shortBreak, longBreak, roundsBeforeLong } (minutes/count)
export function phaseDuration(phase, settings) {
  switch (phase) {
    case "shortBreak":
      return (settings.shortBreak ?? 5) * 60;
    case "longBreak":
      return (settings.longBreak ?? 15) * 60;
    case "work":
    default:
      return (settings.workDuration ?? 25) * 60;
  }
}

// ── Fresh state ─────────────────────────────────────────
// State shape:
//   {
//     phase,         // "work" | "shortBreak" | "longBreak"
//     currentRound,  // 1-based index of the current work round
//     totalRounds,   // rounds before a long break
//     totalTime,     // seconds — full duration of the CURRENT phase
//     isRunning,     // boolean
//     endsAt,        // epoch ms deadline — meaningful only while isRunning; null otherwise
//     remaining,     // seconds left — meaningful only while paused/idle; null while running
//   }
export function initialState(settings) {
  const totalTime = phaseDuration("work", settings);
  return {
    phase: "work",
    currentRound: 1,
    totalRounds: settings.roundsBeforeLong ?? 4,
    totalTime,
    isRunning: false,
    endsAt: null,
    remaining: totalTime,
  };
}

// ── Derived remaining time ──────────────────────────────
// Never negative. While running, derives from the wall-clock deadline
// (`endsAt`) so background-tab timer throttling never costs accuracy —
// only smoothness of the repaint. While paused, uses the frozen `remaining`.
export function remainingSeconds(state, now) {
  if (state.isRunning) {
    if (state.endsAt == null) return 0;
    return Math.max(0, Math.ceil((state.endsAt - now) / 1000));
  }
  return Math.max(0, Math.round(state.remaining ?? 0));
}

// ── Phase transitions ────────────────────────────────────
// work → longBreak once totalRounds are complete, else → shortBreak.
// Any break → work; currentRound resets to 1 after a longBreak, else increments.
//
// `isRunning` carries straight through from the input state:
//   - Callers that want the classic "stop and wait for the next Start
//     click" behavior (natural on-screen completion, manual skip) pass
//     a state with isRunning already false.
//   - Callers resuming a session whose deadline passed while the tab was
//     closed pass the still-running state through unchanged, and the
//     returned state keeps running with a fresh `endsAt` anchored to `now`.
export function advancePhase(state, settings, now) {
  let phase = state.phase;
  let currentRound = state.currentRound;

  if (state.phase === "work") {
    phase = state.currentRound >= state.totalRounds ? "longBreak" : "shortBreak";
  } else {
    phase = "work";
    currentRound = state.phase === "longBreak" ? 1 : state.currentRound + 1;
  }

  const totalTime = phaseDuration(phase, settings);
  const isRunning = state.isRunning;

  return {
    phase,
    currentRound,
    totalRounds: state.totalRounds,
    totalTime,
    isRunning,
    endsAt: isRunning ? now + totalTime * 1000 : null,
    remaining: isRunning ? null : totalTime,
  };
}

// ── Display formatting ──────────────────────────────────
// "MM:SS", clamps negatives (and non-finite input) to "00:00".
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
