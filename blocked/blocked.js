/*  ═══════════════════════════════════════════════════════
    FocusGuard — Pomodoro Timer (Blocked Page)
    Full timer logic with persistence, audio, and phases
    ═══════════════════════════════════════════════════════ */

import {
  initialState,
  phaseDuration,
  remainingSeconds,
  advancePhase,
  formatTime,
} from "../lib/timer.js";

// ── Constants ───────────────────────────────────────────
const STORAGE_KEY = "focusguard_timer_state";
const STALE_MS = 2 * 60 * 60 * 1000; // discard saved state older than this
const HEARTBEAT_MS = 10 * 1000; // persistence heartbeat while running

const MOTIVATIONAL_QUOTES = [
  "Great things are done by a series of small things brought together.",
  "Focus on being productive instead of busy.",
  "The secret of getting ahead is getting started.",
  "It's not that I'm so smart, it's just that I stay with problems longer.",
  "Do the hard jobs first. The easy jobs will take care of themselves.",
  "Concentrate all your thoughts upon the work at hand.",
  "The way to get started is to quit talking and begin doing.",
  "You don't have to be great to start, but you have to start to be great.",
  "Starve your distractions, feed your focus.",
  "Small disciplines repeated with consistency lead to great achievements.",
  "Action is the foundational key to all success.",
  "Your future is created by what you do today, not tomorrow.",
];

// ── State ───────────────────────────────────────────────
let settings = { workDuration: 25, shortBreak: 5, longBreak: 15, roundsBeforeLong: 4 };
let timerState = initialState(settings);

let tickHandle = null;
let heartbeatHandle = null;
let lastAnnouncedMinute = null;

// ── DOM References ──────────────────────────────────────
const timerDigits = document.getElementById("timer-digits");
const timerPhaseLabel = document.getElementById("timer-phase-label");
const timerSrStatus = document.getElementById("timer-sr-status");
const ringProgress = document.getElementById("ring-progress");
const phaseBadge = document.getElementById("phase-badge");
const phaseText = document.getElementById("phase-text");
const sessionLabel = document.getElementById("session-label");
const sessionDots = document.getElementById("session-dots");
const blockedDomain = document.getElementById("blocked-domain");
const motivation = document.getElementById("motivation");
const btnStart = document.getElementById("btn-start");
const btnReset = document.getElementById("btn-reset");
const btnSkip = document.getElementById("btn-skip");
const iconPlay = btnStart.querySelector(".icon-play");
const iconPause = btnStart.querySelector(".icon-pause");

// Ring geometry — read `r` off the SVG circle instead of hardcoding it, so the
// two never desync. `strokeDasharray` is set once here rather than every tick.
const RING_R = parseFloat(ringProgress.getAttribute("r"));
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);

// ── Init ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Parse URL params
  const params = new URLSearchParams(window.location.search);
  const domain = params.get("domain");
  if (domain) {
    blockedDomain.textContent = domain;
  }

  // Load Pomodoro settings from sync storage
  try {
    const data = await chrome.storage.sync.get(["pomodoroSettings"]);
    settings = normalizeSettings(data.pomodoroSettings || {});
  } catch (e) {
    // Running outside extension context — use defaults
  }

  timerState = initialState(settings);

  // Try to restore saved timer state
  try {
    const saved = await chrome.storage.local.get([STORAGE_KEY]);
    const restored = saved[STORAGE_KEY];
    if (restored && Date.now() - (restored.savedAt || 0) < STALE_MS) {
      timerState = reviveState(restored, settings, Date.now());
    }
  } catch (e) {
    // Not in extension context
  }

  // Init display
  applyPhaseUI();
  setRandomQuote();
  // B8 — the CSS `prefers-reduced-motion` query disables particle/pulse
  // animations outright; skip the (pointless) DOM work of creating them too.
  if (!prefersReducedMotion()) {
    createParticles();
  }

  // If timer was running (including a session revived past its deadline
  // above), resume the wall-clock ticker.
  if (timerState.isRunning) {
    armTicker();
    armHeartbeat();
  }

  // Events
  btnStart.addEventListener("click", toggleTimer);
  btnReset.addEventListener("click", resetTimer);
  btnSkip.addEventListener("click", skipPhase);
  // Any of these is a user gesture — use it to unlock the AudioContext so an
  // auto-resumed (no-gesture) completion later on is still able to chime.
  [btnStart, btnReset, btnSkip].forEach((btn) => btn.addEventListener("click", unlockAudio));

  // B4 — react to settings changes made elsewhere (e.g. the popup) while
  // this page is open.
  chrome.storage.onChanged?.addListener(handleSettingsChanged);

  // B3 — persist on the ways a tab can disappear without warning.
  document.addEventListener("pagehide", saveState);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveState();
  });
});

// ── Resume / Restore ─────────────────────────────────────
function reviveState(restored, settings, now) {
  let state = {
    phase: restored.phase || "work",
    currentRound: restored.currentRound || 1,
    totalRounds: restored.totalRounds || settings.roundsBeforeLong,
    totalTime: restored.totalTime || phaseDuration(restored.phase || "work", settings),
    isRunning: !!restored.isRunning,
    endsAt: restored.endsAt ?? null,
    remaining: restored.remaining ?? null,
  };

  if (state.isRunning && state.endsAt != null && remainingSeconds(state, now) <= 0) {
    // The deadline passed while the tab was closed/backgrounded-and-killed.
    // Advance exactly one phase rather than showing a frozen 00:00 — and
    // since it was running, advancePhase() keeps it running with a fresh
    // deadline for the new phase. Cascading through more than one elapsed
    // phase is intentionally not attempted.
    state = advancePhase(state, settings, now);
  } else if (!state.isRunning && state.remaining == null) {
    state.remaining = state.totalTime;
  }

  return state;
}

// ── Timer Controls ──────────────────────────────────────
function toggleTimer() {
  if (timerState.isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  if (timerState.isRunning) return;

  const now = Date.now();
  const remaining = timerState.remaining != null ? timerState.remaining : timerState.totalTime;

  timerState = {
    ...timerState,
    isRunning: true,
    endsAt: now + remaining * 1000,
    remaining: null,
  };

  updatePlayPauseIcon();
  armTicker();
  armHeartbeat();
  tick(); // paint immediately instead of waiting a full second
  saveState();
}

function pauseTimer() {
  const now = Date.now();
  const remaining = remainingSeconds(timerState, now);

  timerState = { ...timerState, isRunning: false, endsAt: null, remaining };

  disarmTicker();
  disarmHeartbeat();
  updatePlayPauseIcon();
  renderTime(remaining);
  saveState();
}

function resetTimer() {
  disarmTicker();
  disarmHeartbeat();
  timerState = initialState(settings); // B5 — re-reads durations/totalRounds from settings
  applyPhaseUI();
  saveState();
}

function skipPhase() {
  const now = Date.now();
  disarmTicker();
  disarmHeartbeat();
  timerState = advancePhase({ ...timerState, isRunning: false }, settings, now);
  applyPhaseUI();
  saveState();
}

// ── Ticking (wall-clock, repaint-only) ──────────────────
function armTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(tick, 1000);
}

function disarmTicker() {
  clearInterval(tickHandle);
  tickHandle = null;
}

function armHeartbeat() {
  clearInterval(heartbeatHandle);
  heartbeatHandle = setInterval(saveState, HEARTBEAT_MS);
}

function disarmHeartbeat() {
  clearInterval(heartbeatHandle);
  heartbeatHandle = null;
}

// B1 — the interval is only a repaint trigger; the deadline (`endsAt`) is the
// source of truth, so a throttled/backgrounded tab never runs slow. If the
// deadline has already passed by the time a (possibly delayed) tick fires,
// completion still fires exactly once — advancePhase() is called a single
// time, never looped.
function tick() {
  if (!timerState.isRunning) return;

  const now = Date.now();
  const remaining = remainingSeconds(timerState, now);
  renderTime(remaining);

  if (remaining <= 0) {
    playNotificationSound();
    pulseRing();
    timerState = advancePhase({ ...timerState, isRunning: false }, settings, now);
    disarmTicker();
    disarmHeartbeat();
    applyPhaseUI();
    saveState();
  }
}

// ── Settings sync (B4) ───────────────────────────────────
function normalizeSettings(raw) {
  return {
    workDuration: raw.workDuration || 25,
    shortBreak: raw.shortBreak || 5,
    longBreak: raw.longBreak || 15,
    roundsBeforeLong: raw.roundsBeforeLong || 4,
  };
}

function handleSettingsChanged(changes, area) {
  if (area !== "sync" || !changes.pomodoroSettings) return;

  settings = normalizeSettings(changes.pomodoroSettings.newValue || {});

  if (timerState.isRunning) {
    // A session is in progress — don't yank time out from under it. The new
    // durations take effect starting with the next phase (phaseDuration()
    // and initialState()/advancePhase() already read from `settings`, which
    // is now updated).
    return;
  }

  // Idle — apply immediately: recompute the current phase's length/display.
  const totalTime = phaseDuration(timerState.phase, settings);
  timerState = {
    ...timerState,
    totalRounds: settings.roundsBeforeLong,
    totalTime,
    remaining: totalTime,
  };
  applyPhaseUI();
  saveState();
}

// ── Display Updates ─────────────────────────────────────
function applyPhaseUI() {
  const now = Date.now();
  const remaining = remainingSeconds(timerState, now);
  setPhaseDisplay(timerState.phase);
  renderTime(remaining);
  updatePlayPauseIcon();
  renderSessionDots();
}

function renderTime(remainingSecs) {
  timerDigits.textContent = formatTime(remainingSecs);
  updateRing(remainingSecs);
  announceMinuteSummary(remainingSecs);
}

function updateRing(remainingSecs) {
  const progress = timerState.totalTime > 0 ? remainingSecs / timerState.totalTime : 1;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  ringProgress.style.strokeDashoffset = String(offset);
}

function setPhaseDisplay(phase) {
  // Remove all phase classes
  document.body.classList.remove("phase-work", "phase-short-break", "phase-long-break");

  switch (phase) {
    case "work":
      document.body.classList.add("phase-work");
      phaseText.textContent = "Focus Time";
      timerPhaseLabel.textContent = "WORK";
      break;
    case "shortBreak":
      document.body.classList.add("phase-short-break");
      phaseText.textContent = "Short Break";
      timerPhaseLabel.textContent = "BREAK";
      break;
    case "longBreak":
      document.body.classList.add("phase-long-break");
      phaseText.textContent = "Long Break";
      timerPhaseLabel.textContent = "LONG BREAK";
      break;
  }
  // phaseText carries aria-live="polite" (see blocked.html), so this text
  // change is what announces phase transitions to assistive tech.
  lastAnnouncedMinute = null; // force a fresh minute announcement for the new phase
}

// B8 — the digits update every second and are aria-hidden; announce a
// periodic accessible summary instead, once per minute boundary rather than
// once per second.
function announceMinuteSummary(remainingSecs) {
  if (!timerSrStatus) return;
  const mins = Math.floor(remainingSecs / 60);
  if (mins === lastAnnouncedMinute) return;
  lastAnnouncedMinute = mins;
  const unit = mins === 1 ? "minute" : "minutes";
  timerSrStatus.textContent = `${mins} ${unit} remaining`;
}

function updatePlayPauseIcon() {
  if (timerState.isRunning) {
    iconPlay.style.display = "none";
    iconPause.style.display = "block";
  } else {
    iconPlay.style.display = "block";
    iconPause.style.display = "none";
  }
}

function renderSessionDots() {
  sessionLabel.textContent = `Session ${timerState.currentRound} of ${timerState.totalRounds}`;

  sessionDots.innerHTML = "";
  for (let i = 1; i <= timerState.totalRounds; i++) {
    const dot = document.createElement("span");
    dot.className = "dot";
    if (i < timerState.currentRound) {
      dot.classList.add("completed");
    } else if (i === timerState.currentRound) {
      dot.classList.add("active");
    }
    sessionDots.appendChild(dot);
  }
}

function pulseRing() {
  const ring = document.querySelector(".timer-ring");
  ring.classList.add("pulse");
  setTimeout(() => ring.classList.remove("pulse"), 2000);
}

// ── Persistence ─────────────────────────────────────────
async function saveState() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...timerState,
        savedAt: Date.now(),
      },
    });
  } catch (e) {
    // Not in extension context
  }
}

// ── Audio Notification ──────────────────────────────────
// B6 — a single lazily-created AudioContext, reused for every chime instead
// of leaking a new one per completion.
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

// An auto-resumed session (phase advanced on page load, no user gesture yet)
// starts its AudioContext suspended, so the very next chime would otherwise
// be silently dropped. Hook the start/reset/skip buttons — the natural next
// user gesture — to unlock it.
function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    // Play a pleasant chime sequence
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.value = freq;

      const startTime = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);

      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
  } catch (e) {
    // Audio not available
  }
}

// ── Motivational Quotes ─────────────────────────────────
function setRandomQuote() {
  const idx = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
  motivation.textContent = MOTIVATIONAL_QUOTES[idx];
}

// ── Particles ───────────────────────────────────────────
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function createParticles() {
  const container = document.getElementById("particles");
  const count = 20;

  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `${60 + Math.random() * 40}%`;
    particle.style.width = `${2 + Math.random() * 3}px`;
    particle.style.height = particle.style.width;
    particle.style.animationDuration = `${8 + Math.random() * 12}s`;
    particle.style.animationDelay = `${Math.random() * 10}s`;
    container.appendChild(particle);
  }
}
