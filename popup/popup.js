/*  ═══════════════════════════════════════════════════════
    FocusGuard — Popup Logic
    Manages blocked sites list, toggles, and settings
    ═══════════════════════════════════════════════════════ */

import { normalizeDomain, isValidDomain } from "../lib/domain.js";

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
      savePomodoroSettingsDebounced();
    });
    slider.addEventListener("change", () => {
      updateSliderLabels();
      savePomodoroSettingsDebounced.cancel();
      savePomodoroSettings();
    });
  });

  // ── Storage Sync ──────────────────────────────────────
  // Keep the popup in sync with changes made elsewhere (blocked page,
  // another popup instance). Our own writes are flagged so we don't
  // immediately re-render on top of our own optimistic UI update.
  chrome.storage.onChanged.addListener((changes, areaName) => {
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
      }
    }
  });
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

  // Check for duplicates
  if (sites.some((s) => s.domain === domain)) {
    showHint("This site is already blocked", false);
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

function buildAvatar(domain) {
  const avatar = document.createElement("div");
  avatar.className = "site-favicon";
  avatar.setAttribute("aria-hidden", "true");

  const hue = hashString(domain) % 360;
  avatar.style.background = `hsl(${hue}, 55%, 32%)`;
  avatar.style.color = `hsl(${hue}, 85%, 88%)`;
  avatar.textContent = (domain[0] || "?").toUpperCase();

  return avatar;
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

// ── Build Site Card ─────────────────────────────────────
function buildSiteCard(site) {
  const card = document.createElement("div");
  card.className = `site-card ${site.active ? "" : "inactive"}`;
  card.dataset.domain = site.domain;

  const favicon = buildAvatar(site.domain);

  const domainLabel = document.createElement("span");
  domainLabel.className = "site-domain";
  domainLabel.textContent = site.domain;

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "site-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !!site.active;
  toggle.setAttribute("aria-label", `Enable blocking for ${site.domain}`);
  const toggleSlider = document.createElement("span");
  toggleSlider.className = "toggle-slider";
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

  card.appendChild(favicon);
  card.appendChild(domainLabel);
  card.appendChild(toggleLabel);
  card.appendChild(deleteBtn);

  // Toggle handler — keyed by domain, not index (see toggleSite), and
  // queued (see queueSiteMutation) so two rapid toggles can't race.
  toggle.addEventListener("change", () =>
    queueSiteMutation(() => toggleSite(site.domain, toggle.checked))
  );

  // Delete handler — keyed by domain, not index (see removeSite), and
  // queued (see queueSiteMutation) so two rapid deletes can't race.
  deleteBtn.addEventListener("click", () => {
    card.classList.add("removing");
    setTimeout(() => queueSiteMutation(() => removeSite(site.domain)), 250);
  });

  return card;
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

// ── CSS Escape (for attribute selectors) ────────────────
function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/["\\]/g, "\\$&");
}
