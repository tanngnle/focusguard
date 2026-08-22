/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Popup Logic
    Manages blocked sites list, toggles, and settings
    ═══════════════════════════════════════════════════════ */

import { normalizeDomain, isValidDomain, isBuiltinSite, getBuiltinSite } from "../lib/domain.js";
import { getAvailableElements } from "../lib/stripping-rules.js";
import {
  start,
  pause,
  reset,
  skip,
  remainingSeconds,
  formatTime,
  isStateFresh,
  reviveState,
} from "../lib/timer.js";
import { createFlipClock } from "../lib/flip-clock.js";

document.addEventListener("DOMContentLoaded", init);

// ── DOM References ──────────────────────────────────────
const masterToggleInput = document.getElementById("master-toggle-input");
const siteInput = document.getElementById("site-input");
const addSiteBtn = document.getElementById("add-site-btn");
const inputHint = document.getElementById("input-hint");
const sitesList = document.getElementById("sites-list");
const siteCount = document.getElementById("site-count");
const emptyState = document.getElementById("empty-state");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");

const workSlider = document.getElementById("work-slider");
const shortBreakSlider = document.getElementById("short-break-slider");
const longBreakSlider = document.getElementById("long-break-slider");
const roundsSlider = document.getElementById("rounds-slider");
const workValue = document.getElementById("work-value");
const shortBreakValue = document.getElementById("short-break-value");
const longBreakValue = document.getElementById("long-break-value");
const roundsValue = document.getElementById("rounds-value");

// ── Tabs (Blocklist / Timer) ────────────────────────────
const tabBtnSites = document.getElementById("tab-btn-sites");
const tabBtnTimer = document.getElementById("tab-btn-timer");
const tabPanelSites = document.getElementById("tab-panel-sites");
const tabPanelTimer = document.getElementById("tab-panel-timer");

// ── Lock Down Panel DOM (#25) ─────────────────────
const lockdownToggle = document.getElementById("lockdown-toggle");
const lockdownPanel = document.getElementById("lockdown-panel");
const lockdownIdle = document.getElementById("lockdown-idle");
const lockdownActive = document.getElementById("lockdown-active");
const lockdownDurationSelect = document.getElementById("lockdown-duration");
const lockdownStartBtn = document.getElementById("lockdown-start-btn");
const lockdownStopBtn = document.getElementById("lockdown-stop-btn");
const lockdownCountdown = document.getElementById("lockdown-countdown");
const lockdownHeaderStatus = document.getElementById("lockdown-header-status");

// Lock Down session state mirrors the focusSessionActive /
// focusSessionEndsAt pair in chrome.storage.local. The panel NEVER reads
// storage.sync copies of those keys (inert v1-migration leftovers) and
// re-renders from local-area onChanged events, so external writers —
// the background worker expiring a session, the blocked page clearing
// one on natural work-phase completion — are reflected live.
let lockdownSessionActive = false;
let lockdownSessionEndsAt = null;
let lockdownTickerHandle = null;

// ── Timer Tab DOM ───────────────────────────────────────
const popupFlipClockMount = document.getElementById("popup-flip-clock");
const popupTimerDigits = document.getElementById("popup-timer-digits");
const popupPhaseLabel = document.getElementById("popup-phase-label");
const popupSessionLabel = document.getElementById("popup-session-label");
const popupSessionDots = document.getElementById("popup-session-dots");
const timerStartBtn = document.getElementById("timer-start-btn");
const timerPauseBtn = document.getElementById("timer-pause-btn");
const timerSkipBtn = document.getElementById("timer-skip-btn");
const timerResetBtn = document.getElementById("timer-reset-btn");
const openFullTimerBtn = document.getElementById("open-full-timer-btn");

// Guard so our own writes don't trigger a redundant re-render via
// chrome.storage.onChanged (see "Storage Sync" section below).
let suppressNextSitesChange = false;

// ── Site Mutation Queue ─────────────────────────────────
// addSite/toggleSite/removeSite all follow a read-modify-write pattern
// against the single `sites` array in chrome.storage.sync: read the current
// array, mutate a copy, write it back. Two of these firing concurrently
// (e.g. two rapid toggle-switch clicks, or two rapid deletes) would both
// read the same pre-mutation array before either write lands, so the
// second write silently clobbers the first's change even though each
// operation is correctly keyed by domain rather than a stale index.
// Serializing them here — each call waits for the previous one to fully
// settle before it starts its own storage.get — closes that race without
// touching the (already-correct) domain-keyed lookup logic itself.
let siteMutationQueue = Promise.resolve();
function queueSiteMutation(fn) {
  const run = siteMutationQueue.then(fn, fn);
  // Chain continues even if `fn` rejected, so one failure doesn't wedge
  // every subsequent queued mutation; callers still observe `run`'s own
  // resolution/rejection.
  siteMutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ── Timer State Mutation Queue ──────────────────────────
// The popup and the blocked page share one timer state in
// chrome.storage.local["MindfulBrowse_timer_state"]. Every popup write goes
// through this queue (same read-modify-write race as the sites array:
// two rapid Start/Skip clicks must not clobber each other) and mirrors
// the queueSiteMutation pattern above.
const TIMER_STATE_KEY = "MindfulBrowse_timer_state";
let timerMutationQueue = Promise.resolve();
function queueTimerMutation(fn) {
  const run = timerMutationQueue.then(fn, fn);
  timerMutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Value-based self-write suppression for the local timer-state area:
// the `savedAt` of the last state THIS popup persisted. An onChanged event
// carrying that exact value is our own write echoing back — skip re-render
// only for it, so an external write (e.g. a blocked-page heartbeat)
// landing between flag-set and our own write is never swallowed.
let lastWrittenTimerSavedAt = null;

// In-memory view of the shared timer state + flip clock instance.
let popupTimerState = null;
let popupFlipClock = null;
let popupTickerHandle = null;
// False until ANY state has been persisted (by the popup or the blocked
// page). While false, the Timer tab renders idle defaults derived from
// the settings sliders (reset(settings)), and slider changes keep
// updating that display.
let hasStoredTimerState = false;

const PHASE_LABELS = { work: "WORK", shortBreak: "BREAK", longBreak: "LONG BREAK" };
const TAB_STORAGE_KEY = "MindfulBrowse_active_tab";

// Friction mode has a single fixed delay (ticket #23) — no user-facing
// delay picker anymore. Persisted alongside restrictionLevel: 'friction'.
const FRICTION_DELAY_SECONDS = 15;

// The three restriction levels, in dropdown order: [value, label].
const RESTRICTION_LEVELS = [
  ["strip", "Strip"],
  ["friction", "Friction"],
  ["block", "Block"],
];

// ── Init ────────────────────────────────────────────────
async function init() {
  const data = await chrome.storage.sync.get(null);

  // Master toggle
  masterToggleInput.checked = data.enabled !== false;
  masterToggleInput.addEventListener("change", async () => {
    await setStorage({ enabled: masterToggleInput.checked });
  });

  // Pomodoro settings
  const ps = data.pomodoroSettings || {
    workDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    roundsBeforeLong: 4,
  };

  workSlider.value = ps.workDuration;
  shortBreakSlider.value = ps.shortBreak;
  longBreakSlider.value = ps.longBreak;
  roundsSlider.value = ps.roundsBeforeLong;
  updateSliderLabels();

  // Render sites
  renderSites(data.sites || []);

  // Tabs + Timer tab (both guarded on element existence so partial
  // fixtures can't crash).
  initTabs();
  initTimerTab();
  initLockDownPanel();

  // Event listeners
  addSiteBtn.addEventListener("click", () => queueSiteMutation(addSite));
  siteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") queueSiteMutation(addSite);
  });

  settingsToggle.addEventListener("click", () => {
    const isOpen = settingsToggle.classList.toggle("open");
    settingsPanel.classList.toggle("open", isOpen);
    settingsToggle.setAttribute("aria-expanded", String(isOpen));
  });

  // Slider events — update labels immediately, persist debounced,
  // and always persist on "change" (drag-release / arrow-key commit)
  // to avoid blowing the chrome.storage.sync write quota (120/min).
  const savePomodoroSettingsDebounced = debounce(savePomodoroSettings, 400);
  [workSlider, shortBreakSlider, longBreakSlider, roundsSlider].forEach((slider) => {
    slider.addEventListener("input", () => {
      updateSliderLabels();
      refreshIdleTimerDefaults();
      savePomodoroSettingsDebounced();
    });
    slider.addEventListener("change", () => {
      updateSliderLabels();
      refreshIdleTimerDefaults();
      savePomodoroSettingsDebounced.cancel();
      savePomodoroSettings();
    });
  });

  // ── Storage Sync ──────────────────────────────────────
  // Keep the popup in sync with changes made elsewhere (blocked page,
  // another popup instance). Our own writes are flagged so we don't
  // immediately re-render on top of our own optimistic UI update.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    // Local area carries the shared timer state (written by the blocked
    // page and by this popup's Timer tab) and the Lock Down session keys.
    if (areaName === "local") {
      handleTimerStateChange(changes);
      handleLockDownChange(changes);
      return;
    }
    if (areaName !== "sync") return;

    if (changes.sites) {
      if (suppressNextSitesChange) {
        suppressNextSitesChange = false;
      } else {
        renderSites(changes.sites.newValue || []);
      }
    }

    if (changes.enabled) {
      masterToggleInput.checked = changes.enabled.newValue !== false;
    }

    if (changes.pomodoroSettings && document.activeElement?.type !== "range") {
      const next = changes.pomodoroSettings.newValue;
      if (next) {
        workSlider.value = next.workDuration;
        shortBreakSlider.value = next.shortBreak;
        longBreakSlider.value = next.longBreak;
        roundsSlider.value = next.roundsBeforeLong;
        updateSliderLabels();
        refreshIdleTimerDefaults();
      }
    }
  });
}

// ── Tabs ──────────────────────────────────────────────
// Two tabs: Blocklist (sites) and Timer. Header + master toggle stay
// outside the tabs. The last active tab is persisted in localStorage.
function initTabs() {
  if (!tabBtnSites || !tabBtnTimer || !tabPanelSites || !tabPanelTimer) return;

  const tabs = [tabBtnSites, tabBtnTimer];
  const panelOf = { [tabBtnSites.id]: tabPanelSites, [tabBtnTimer.id]: tabPanelTimer };

  function activateTab(tab, persist = true) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = panelOf[t.id];
      if (panel) panel.hidden = !selected;
    });
    if (persist) {
      try {
        window.localStorage.setItem(TAB_STORAGE_KEY, tab.id);
      } catch {
        // Storage unavailable (private mode etc.) — tabs still work.
      }
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (e) => {
      let target = null;
      if (e.key === "ArrowRight") {
        target = tabs[(index + 1) % tabs.length];
      } else if (e.key === "ArrowLeft") {
        target = tabs[(index - 1 + tabs.length) % tabs.length];
      } else if (e.key === "Home") {
        target = tabs[0];
      } else if (e.key === "End") {
        target = tabs[tabs.length - 1];
      }
      if (!target) return;
      e.preventDefault();
      activateTab(target);
      target.focus();
    });
  });

  // Restore the last active tab; default is Blocklist.
  let savedTab = null;
  try {
    savedTab = window.localStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    // Ignore — fall through to the default.
  }
  const restored = tabs.find((t) => t.id === savedTab) || tabBtnSites;
  activateTab(restored, false);
}

// ── Timer Tab ─────────────────────────────────────────
// Reads/writes the SAME storage key/shape the blocked page uses
// (blocked.js saveState(): { ...timerState, savedAt }). All writes are
// serialized through queueTimerMutation; external changes arrive via the
// chrome.storage.onChanged listener registered in init().
async function initTimerTab() {
  if (!popupFlipClockMount || !timerStartBtn) return;

  popupFlipClock = createFlipClock(popupFlipClockMount);

  // Restore whatever the blocked page (or a previous popup) persisted.
  try {
    const data = await chrome.storage.local.get([TIMER_STATE_KEY]);
    const stored = data[TIMER_STATE_KEY];
    // 2h staleness gate (shared STALE_MS via isStateFresh, same as the
    // blocked page) — never surface, and never re-persist, a stale session.
    if (isStateFresh(stored, Date.now())) {
      // Adoption race: a concurrent onChanged event may already have
      // applied a FRESHER state while this storage.get was in flight —
      // only adopt if nothing newer is already in memory.
      if (!popupTimerState || (stored.savedAt ?? 0) >= (popupTimerState.savedAt ?? 0)) {
        // reviveState also advances one phase if the running deadline
        // already passed while the popup was closed (mirrors blocked.js).
        popupTimerState = reviveState(stored, currentSettingsFromSliders(), Date.now());
        hasStoredTimerState = true;
      }
    }
  } catch {
    // Not in extension context.
  }

  // Edge case — nothing persisted yet: idle defaults from the sliders.
  if (!popupTimerState) {
    popupTimerState = reset(currentSettingsFromSliders());
  }
  renderTimerState();

  timerStartBtn.addEventListener("click", () =>
    queueTimerMutation(() => applyTimerTransition((s) => start(s, Date.now())))
  );
  timerPauseBtn?.addEventListener("click", () =>
    queueTimerMutation(() => applyTimerTransition((s) => pause(s, Date.now())))
  );
  timerSkipBtn?.addEventListener("click", () =>
    queueTimerMutation(() =>
      applyTimerTransition((s) => skip(s, currentSettingsFromSliders(), Date.now()))
    )
  );
  timerResetBtn?.addEventListener("click", () =>
    queueTimerMutation(() => applyTimerTransition(() => reset(currentSettingsFromSliders())))
  );
  openFullTimerBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("blocked/blocked.html") });
  });

  // Popup closing — stop the local repaint ticker.
  window.addEventListener("pagehide", disarmPopupTicker);
}

// Settings as currently shown on the sliders (the popup's source of
// truth for durations — mirrors savePomodoroSettings).
function currentSettingsFromSliders() {
  return {
    workDuration: parseInt(workSlider?.value ?? 25, 10),
    shortBreak: parseInt(shortBreakSlider?.value ?? 5, 10),
    longBreak: parseInt(longBreakSlider?.value ?? 15, 10),
    roundsBeforeLong: parseInt(roundsSlider?.value ?? 4, 10),
  };
}

// Apply a pure lib/timer.js transition to the freshest known state and
// persist the result. Reads storage first so a blocked-page write that
// landed after the popup opened is never clobbered by a stale copy.
async function applyTimerTransition(transition) {
  let source = popupTimerState;
  try {
    const data = await chrome.storage.local.get([TIMER_STATE_KEY]);
    if (data[TIMER_STATE_KEY]) source = data[TIMER_STATE_KEY];
  } catch {
    // Fall back to the in-memory state.
  }
  if (!source) source = reset(currentSettingsFromSliders());

  const next = transition(source);

  const savedAt = Date.now();
  lastWrittenTimerSavedAt = savedAt; // suppress this write's onChanged echo
  try {
    await chrome.storage.local.set({
      [TIMER_STATE_KEY]: { ...next, savedAt },
    });
  } catch {
    return;
  }
  popupTimerState = next;
  hasStoredTimerState = true;
  renderTimerState();
}

// chrome.storage.onChanged (local area) handler — re-render when the
// blocked page (or another popup) changes the shared timer state.
function handleTimerStateChange(changes) {
  const change = changes[TIMER_STATE_KEY];
  if (!change || !change.newValue) return;
  const incoming = change.newValue;
  // Our own applyTimerTransition() write echoing back — identifiable by
  // the exact `savedAt` we wrote (see lastWrittenTimerSavedAt).
  if (incoming.savedAt != null && incoming.savedAt === lastWrittenTimerSavedAt) return;
  popupTimerState = incoming;
  hasStoredTimerState = true;
  renderTimerState();
}

// While nothing has been persisted yet, the Timer tab mirrors the
// sliders — recompute the idle display when settings move.
function refreshIdleTimerDefaults() {
  if (hasStoredTimerState || !popupTimerState || popupTimerState.isRunning) return;
  popupTimerState = reset(currentSettingsFromSliders());
  renderTimerState();
}

// ── Timer Tab Rendering ───────────────────────────────
function renderTimerState() {
  if (!popupTimerState) return;

  paintTimerReadout();

  if (popupPhaseLabel) {
    popupPhaseLabel.textContent = PHASE_LABELS[popupTimerState.phase] || PHASE_LABELS.work;
  }
  if (popupSessionLabel) {
    popupSessionLabel.textContent = `Session ${popupTimerState.currentRound} of ${popupTimerState.totalRounds}`;
  }
  renderPopupSessionDots();

  if (popupTimerState.isRunning) {
    armPopupTicker();
  } else {
    disarmPopupTicker();
  }
}

// Deadline-based repaint — recomputes remaining from endsAt every call,
// so the 1s ticker is only a repaint trigger, never the clock itself.
function paintTimerReadout() {
  const display = formatTime(remainingSeconds(popupTimerState, Date.now()));
  if (popupFlipClock) popupFlipClock.setTime(display);
  if (popupTimerDigits) popupTimerDigits.textContent = display;
}

function renderPopupSessionDots() {
  if (!popupSessionDots) return;
  popupSessionDots.innerHTML = "";
  for (let i = 1; i <= popupTimerState.totalRounds; i++) {
    const dot = document.createElement("span");
    dot.className = "popup-dot";
    if (i < popupTimerState.currentRound) {
      dot.classList.add("completed");
    } else if (i === popupTimerState.currentRound) {
      dot.classList.add("active");
    }
    popupSessionDots.appendChild(dot);
  }
}

// ── Popup Ticker (repaint only, while running) ──────────
function armPopupTicker() {
  disarmPopupTicker();
  popupTickerHandle = setInterval(() => {
    if (!popupTimerState || !popupTimerState.isRunning) {
      disarmPopupTicker();
      return;
    }
    const now = Date.now();
    if (remainingSeconds(popupTimerState, now) <= 0) {
      // Deadline passed while the popup is open (or a restored state's
      // endsAt was already past): run the same completion transition the
      // blocked page uses — skip into the next phase, paused — queued so
      // it can't race a concurrent control click. renderTimerState() from
      // the applied transition disarms/re-arms the ticker as appropriate.
      disarmPopupTicker();
      queueTimerMutation(() =>
        applyTimerTransition((s) => skip(s, currentSettingsFromSliders(), now))
      );
      return;
    }
    paintTimerReadout();
  }, 1000);
}

function disarmPopupTicker() {
  if (popupTickerHandle != null) {
    clearInterval(popupTickerHandle);
    popupTickerHandle = null;
  }
}

// ── Lock Down Panel (#25) ─────────────────────────
// Session lifecycle: START writes focusSessionActive/focusSessionEndsAt
// to chrome.storage.local; STOP removes both keys. All rendering flows
// through renderLockDown(), driven by the initial read, our own writes'
// onChanged echoes, and external writes (background expiry, blocked-page
// natural completion) alike — no suppression flag needed because every
// render is idempotent over the same two values.
async function initLockDownPanel() {
  if (!lockdownToggle) return;

  lockdownToggle.addEventListener("click", () => {
    const isOpen = lockdownToggle.classList.toggle("open");
    lockdownPanel.classList.toggle("open", isOpen);
    lockdownToggle.setAttribute("aria-expanded", String(isOpen));
  });

  lockdownStartBtn?.addEventListener("click", startLockDownSession);
  lockdownStopBtn?.addEventListener("click", stopLockDownSession);

  // Popup open — adopt whatever the session keys currently hold.
  try {
    const data = await chrome.storage.local.get(["focusSessionActive", "focusSessionEndsAt"]);
    lockdownSessionActive = data.focusSessionActive === true;
    lockdownSessionEndsAt =
      typeof data.focusSessionEndsAt === "number" ? data.focusSessionEndsAt : null;
  } catch {
    // Not in extension context.
  }
  renderLockDown();

  // Popup closing — stop the countdown ticker.
  window.addEventListener("pagehide", disarmLockDownTicker);
}

async function startLockDownSession() {
  const minutes = parseInt(lockdownDurationSelect?.value ?? "25", 10);
  try {
    await chrome.storage.local.set({
      focusSessionActive: true,
      focusSessionEndsAt: Date.now() + minutes * 60000,
    });
  } catch {
    // Storage unavailable — the panel stays idle.
  }
}

async function stopLockDownSession() {
  try {
    await chrome.storage.local.remove(["focusSessionActive", "focusSessionEndsAt"]);
  } catch {
    // Storage unavailable — nothing more to do.
  }
}

// chrome.storage.onChanged (local area) handler for the session keys.
// Removal events arrive with newValue undefined and flip the panel back
// to idle just like an explicit { false, null } write.
function handleLockDownChange(changes) {
  if (!lockdownToggle) return;
  if (!changes.focusSessionActive && !changes.focusSessionEndsAt) return;

  if (changes.focusSessionActive) {
    lockdownSessionActive = changes.focusSessionActive.newValue === true;
  }
  if (changes.focusSessionEndsAt) {
    const value = changes.focusSessionEndsAt.newValue;
    lockdownSessionEndsAt = typeof value === "number" ? value : null;
  }
  renderLockDown();
}

function renderLockDown() {
  if (!lockdownToggle) return;

  lockdownIdle.hidden = lockdownSessionActive;
  lockdownActive.hidden = !lockdownSessionActive;
  lockdownToggle.classList.toggle("session-active", lockdownSessionActive);

  if (lockdownSessionActive) {
    paintLockDownCountdown();
    armLockDownTicker();
  } else {
    disarmLockDownTicker();
    if (lockdownHeaderStatus) lockdownHeaderStatus.hidden = true;
  }
}

// Deadline-based countdown — recomputed from focusSessionEndsAt on every
// paint, so the 1s interval is only a repaint trigger, never the clock.
function lockdownRemainingSeconds() {
  if (typeof lockdownSessionEndsAt !== "number") return 0;
  return Math.max(0, Math.ceil((lockdownSessionEndsAt - Date.now()) / 1000));
}

function paintLockDownCountdown() {
  const display = formatTime(lockdownRemainingSeconds());
  if (lockdownCountdown) {
    lockdownCountdown.textContent = display;
    // aria-label (not aria-live) keeps screen readers informed without
    // announcing every second.
    lockdownCountdown.setAttribute("aria-label", `Lock Down time remaining: ${display}`);
  }
  if (lockdownHeaderStatus) {
    lockdownHeaderStatus.hidden = false;
    lockdownHeaderStatus.textContent = display;
  }
}

function armLockDownTicker() {
  disarmLockDownTicker();
  lockdownTickerHandle = setInterval(paintLockDownCountdown, 1000);
}

function disarmLockDownTicker() {
  if (lockdownTickerHandle != null) {
    clearInterval(lockdownTickerHandle);
    lockdownTickerHandle = null;
  }
}

// ── Debounce Helper ─────────────────────────────────────
function debounce(fn, wait) {
  let timeoutId;
  const debounced = (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timeoutId);
  return debounced;
}

// ── Set Storage (with error surfacing) ──────────────────
// Wraps chrome.storage.sync.set so quota/other rejections are
// surfaced to the user instead of failing silently.
async function setStorage(items) {
  try {
    await chrome.storage.sync.set(items);
    return true;
  } catch (err) {
    showHint(`Couldn't save: ${err.message || "storage error"}`, false);
    return false;
  }
}

// ── Update Slider Labels ────────────────────────────────
function updateSliderLabels() {
  workValue.textContent = `${workSlider.value} min`;
  shortBreakValue.textContent = `${shortBreakSlider.value} min`;
  longBreakValue.textContent = `${longBreakSlider.value} min`;
  roundsValue.textContent = roundsSlider.value;

  workSlider.setAttribute("aria-valuetext", `${workSlider.value} minutes`);
  shortBreakSlider.setAttribute("aria-valuetext", `${shortBreakSlider.value} minutes`);
  longBreakSlider.setAttribute("aria-valuetext", `${longBreakSlider.value} minutes`);
  roundsSlider.setAttribute("aria-valuetext", `${roundsSlider.value} rounds`);
}

// ── Save Pomodoro Settings ──────────────────────────────
async function savePomodoroSettings() {
  await setStorage({
    pomodoroSettings: {
      workDuration: parseInt(workSlider.value),
      shortBreak: parseInt(shortBreakSlider.value),
      longBreak: parseInt(longBreakSlider.value),
      roundsBeforeLong: parseInt(roundsSlider.value),
    },
  });
}

// ── Add Site ────────────────────────────────────────────
async function addSite() {
  const domain = normalizeDomain(siteInput.value);

  if (!domain) {
    showHint("Please enter a website domain", false);
    return;
  }

  if (!isValidDomain(domain)) {
    showHint("Invalid domain format (e.g. twitter.com)", false);
    return;
  }

  const data = await chrome.storage.sync.get(["sites"]);
  const sites = data.sites || [];

  // Check for duplicates (including built-in sites)
  if (sites.some((s) => s.domain === domain)) {
    showHint("This site is already in your list", false);
    return;
  }

  if (isBuiltinSite(domain)) {
    showHint(`${domain} is already available — just toggle it on`, false);
    return;
  }

  sites.push({ domain, active: true });
  suppressNextSitesChange = true;
  const ok = await setStorage({ sites });
  if (!ok) {
    suppressNextSitesChange = false;
    return;
  }

  siteInput.value = "";
  showHint(`✓ ${domain} added`, true);
  renderSites(sites);
}

// ── Show Hint ───────────────────────────────────────────
function showHint(message, success) {
  inputHint.textContent = message;
  inputHint.className = success ? "input-hint success" : "input-hint";
  clearTimeout(showHint._timeout);
  showHint._timeout = setTimeout(() => {
    inputHint.textContent = "";
  }, 3000);
}

// ── Letter Avatar ───────────────────────────────────────
// Deterministic local avatar: first letter of the domain over a
// hue derived from a hash of the domain string. Replaces the
// third-party favicon fetch (network request + blocklist leak).
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const AVATAR_HUES = [140, 213, 245];

function buildAvatar(domain) {
  const avatar = document.createElement("div");
  avatar.className = "site-favicon";
  avatar.setAttribute("aria-hidden", "true");

  // Phase C — minimalist scheme: only the three muted phase hues
  // (work green / short-break blue / long-break violet), still
  // deterministic per domain.
  const hue = AVATAR_HUES[hashString(domain) % AVATAR_HUES.length];
  avatar.style.background = `hsl(${hue}, 30%, 20%)`;
  avatar.style.color = `hsl(${hue}, 45%, 78%)`;
  avatar.textContent = (domain[0] || "?").toUpperCase();

  return avatar;
}

// ── Built-in Platform Icon ──────────────────────────────
// Renders a colored icon for built-in platforms (YouTube, Facebook).
// Uses the platform's brand color and a recognizable symbol.
function buildBuiltinIcon(builtin) {
  const icon = document.createElement("div");
  icon.className = "site-favicon builtin-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.style.background = builtin.color;
  icon.style.color = "#fff";
  icon.textContent = builtin.icon;
  return icon;
}

// ── Render Sites ────────────────────────────────────────
function renderSites(sites) {
  // Clear existing cards (keep empty state)
  sitesList.querySelectorAll(".site-card").forEach((el) => el.remove());

  siteCount.textContent = sites.length;

  if (sites.length === 0) {
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";

  sites.forEach((site) => {
    const card = buildSiteCard(site);
    sitesList.appendChild(card);
  });
}

// ── Build Site Card ────────────────────────────────────
function buildSiteCard(site) {
  const builtin = getBuiltinSite(site.domain);
  const card = document.createElement("div");
  card.className = `site-card ${site.active ? "" : "inactive"}${builtin ? " builtin" : ""}`;
  card.dataset.domain = site.domain;

  const favicon = builtin ? buildBuiltinIcon(builtin) : buildAvatar(site.domain);

  const domainLabel = document.createElement("span");
  domainLabel.className = "site-domain";
  domainLabel.textContent = builtin ? builtin.label : site.domain;

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "site-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !!site.active;
  toggle.setAttribute("aria-label", `Enable blocking for ${site.domain}`);
  const toggleSlider = document.createElement("span");
  toggleSlider.className = `toggle-slider${builtin ? " builtin-toggle" : ""}`;
  toggleLabel.appendChild(toggle);
  toggleLabel.appendChild(toggleSlider);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-delete";
  deleteBtn.title = `Remove ${site.domain}`;
  deleteBtn.setAttribute("aria-label", `Remove ${site.domain}`);
  deleteBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  // ── Restriction Level Dropdown ────────────────────────
  // Strip / Friction / Block in a native <select>. The .restriction-field
  // wrapper hosts a pure-CSS tooltip (popup.css) that describes the
  // currently selected level on hover — no JavaScript involved.
  const restrictionLevel = site.restrictionLevel || "strip";
  const restrictionField = document.createElement("div");
  restrictionField.className = "restriction-field";

  const restrictionSelect = document.createElement("select");
  restrictionSelect.className = "restriction-select";
  restrictionSelect.setAttribute("aria-label", `Restriction level for ${site.domain}`);
  RESTRICTION_LEVELS.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    restrictionSelect.appendChild(option);
  });
  restrictionSelect.value = restrictionLevel;

  // Empty span — its text is injected by CSS (::before content keyed off
  // :has(option:checked)), so it carries no accessible name of its own.
  const tooltip = document.createElement("span");
  tooltip.className = "restriction-tooltip";
  tooltip.setAttribute("aria-hidden", "true");

  restrictionField.appendChild(restrictionSelect);
  restrictionField.appendChild(tooltip);

  card.appendChild(favicon);
  card.appendChild(domainLabel);
  card.appendChild(toggleLabel);
  card.appendChild(restrictionField);
  // Built-in sites cannot be deleted — skip the delete button
  if (!builtin) {
    card.appendChild(deleteBtn);
  }

  // ─ Friction Delay Note ────────────────────────────────
  // Friction delay is fixed at 15s (ticket #23) — static text only,
  // no selector. Only shown while in friction mode.
  if (restrictionLevel === "friction") {
    const delayNote = document.createElement("p");
    delayNote.className = "friction-delay-note";
    delayNote.textContent = `Delay: ${FRICTION_DELAY_SECONDS} seconds`;
    card.appendChild(delayNote);
  }

  // ── Element-Level Toggles (Stripping Profile) ─────────
  // Only shown for supported platforms (YouTube, Facebook)
  // when in strip mode.
  const availableElements = getAvailableElements(site.domain);
  if (availableElements && restrictionLevel === "strip") {
    const elementToggles = document.createElement("div");
    elementToggles.className = "element-toggles";
    const profile = site.strippingProfile || {};

    availableElements.forEach((elementName) => {
      const label = document.createElement("label");
      label.className = "element-toggle";
      label.dataset.element = elementName;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = profile[elementName] !== false; // default: enabled
      checkbox.setAttribute("aria-label", `Toggle ${elementName} for ${site.domain}`);

      const elementLabel = document.createElement("span");
      elementLabel.className = "element-label";
      elementLabel.textContent = formatElementName(elementName);

      label.appendChild(checkbox);
      label.appendChild(elementLabel);
      elementToggles.appendChild(label);

      checkbox.addEventListener("change", () => {
        const enabled = checkbox.checked; // eager capture — see restrictionSelect below
        queueSiteMutation(() => toggleElement(site.domain, elementName, enabled));
      });
    });

    card.appendChild(elementToggles);
  }

  // Toggle handler — keyed by domain, not index (see toggleSite), and
  // queued (see queueSiteMutation) so two rapid toggles can't race. The
  // checkbox state is captured at event time, not when the queued mutation
  // eventually runs: reading `toggle.checked` lazily inside the queue means
  // a second, different toggle action landing before execution could flip
  // what the first queued mutation writes — each queued mutation must apply
  // exactly the user action that enqueued it.
  toggle.addEventListener("change", () => {
    const active = toggle.checked;
    queueSiteMutation(() => toggleSite(site.domain, active));
  });

  // Restriction level handler — the chosen level is captured eagerly at
  // event time (same rationale as the site toggle above) and persisted
  // through the mutation queue.
  restrictionSelect.addEventListener("change", () => {
    const level = restrictionSelect.value;
    queueSiteMutation(() => setRestrictionLevel(site.domain, level));
  });

  // Delete handler — keyed by domain, not index (see removeSite), and
  // queued (see queueSiteMutation) so two rapid deletes can't race.
  deleteBtn.addEventListener("click", () => {
    card.classList.add("removing");
    setTimeout(() => queueSiteMutation(() => removeSite(site.domain)), 250);
  });

  return card;
}

// ── Format Element Name ─────────────────────────────────
// Converts camelCase element names to readable labels.
function formatElementName(name) {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ── Toggle Site ─────────────────────────────────────────
// Mutations are keyed by domain (guaranteed unique by addSite's
// dedupe check) rather than array index, so rapid interactions with
// multiple cards can't race against a stale index captured at
// render time.
async function toggleSite(domain, active) {
  const data = await chrome.storage.sync.get(["sites"]);
  const sites = data.sites || [];
  const site = sites.find((s) => s.domain === domain);
  if (!site) return; // Already gone — no-op.

  site.active = active;
  suppressNextSitesChange = true;
  const ok = await setStorage({ sites });
  if (!ok) {
    suppressNextSitesChange = false;
    return;
  }

  // Update just the affected card in place instead of re-rendering
  // the whole list.
  const card = sitesList.querySelector(`.site-card[data-domain="${cssEscape(domain)}"]`);
  if (card) card.classList.toggle("inactive", !active);
}

// ── Remove Site ─────────────────────────────────────────
async function removeSite(domain) {
  const data = await chrome.storage.sync.get(["sites"]);
  const sites = data.sites || [];
  const index = sites.findIndex((s) => s.domain === domain);
  if (index === -1) return; // Already gone — no-op.

  sites.splice(index, 1);
  suppressNextSitesChange = true;
  const ok = await setStorage({ sites });
  if (!ok) {
    suppressNextSitesChange = false;
    return;
  }
  renderSites(sites);
}

// ── Set Restriction Level ───────────────────────────────
// Persists the dropdown's chosen level for a site. Friction carries the
// fixed 15s delay; every other level drops frictionDelay so no stale
// value lingers in storage.
async function setRestrictionLevel(domain, level) {
  const data = await chrome.storage.sync.get(["sites"]);
  const sites = data.sites || [];
  const site = sites.find((s) => s.domain === domain);
  if (!site) return;

  site.restrictionLevel = level;
  if (level === "friction") {
    site.frictionDelay = FRICTION_DELAY_SECONDS;
  } else {
    delete site.frictionDelay;
  }
  suppressNextSitesChange = true;
  const ok = await setStorage({ sites });
  if (!ok) {
    suppressNextSitesChange = false;
    return;
  }

  // Re-render to show updated mode and element toggles
  renderSites(sites);
}

// ── Toggle Element ──────────────────────────────────────
// Updates the stripping profile for a specific element on a site.
async function toggleElement(domain, elementName, enabled) {
  const data = await chrome.storage.sync.get(["sites"]);
  const sites = data.sites || [];
  const site = sites.find((s) => s.domain === domain);
  if (!site) return;

  if (!site.strippingProfile) {
    site.strippingProfile = {};
  }
  site.strippingProfile[elementName] = enabled;

  suppressNextSitesChange = true;
  const ok = await setStorage({ sites });
  if (!ok) {
    suppressNextSitesChange = false;
  }
}

// ── CSS Escape (for attribute selectors) ────────────────
function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/["\\]/g, "\\$&");
}
