/*  ══════════════════════════════════════════════════════
    FocusGuard — Re-intervention Overlay (Content Script)
    Level 2 friction: periodic modal during browsing
    ═══════════════════════════════════════════════════════ */

// ─ Configuration ───────────────────────────────────────
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── State ──────────────────────────────────────────────
let overlayVisible = false;
let timerHandle = null;
let startTime = Date.now();

// ── Overlay HTML ────────────────────────────────────────
function createOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "focusguard-reintervention-overlay";
  overlay.innerHTML = `
    <div class="focusguard-overlay-backdrop"></div>
    <div class="focusguard-overlay-modal">
      <div class="focusguard-overlay-emoji"></div>
      <h2 class="focusguard-overlay-title">Still being productive?</h2>
      <p class="focusguard-overlay-text">
        You've been browsing for a while. Take a moment to check in with yourself.
      </p>
      <div class="focusguard-overlay-buttons">
        <button class="focusguard-btn focusguard-btn-continue" id="focusguard-continue">
          Yes, continue
        </button>
        <button class="focusguard-btn focusguard-btn-close" id="focusguard-close">
          Close tab
        </button>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement("style");
  style.id = "focusguard-overlay-styles";
  style.textContent = `
    #focusguard-reintervention-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .focusguard-overlay-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
    }
    .focusguard-overlay-modal {
      position: relative;
      background: #1a1a2e;
      border: 2px solid #a78bfa;
      border-radius: 1rem;
      padding: 2rem;
      max-width: 400px;
      text-align: center;
      font-family: 'Inter', system-ui, sans-serif;
      color: #e4e4e7;
    }
    .focusguard-overlay-emoji {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    .focusguard-overlay-title {
      font-family: 'Orbitron', monospace;
      font-size: 1.25rem;
      color: #a78bfa;
      margin-bottom: 1rem;
    }
    .focusguard-overlay-text {
      font-size: 0.95rem;
      color: #a1a1aa;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .focusguard-overlay-buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
    }
    .focusguard-btn {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .focusguard-btn-continue {
      background: #a78bfa;
      color: #1a1a2e;
    }
    .focusguard-btn-continue:hover {
      background: #c4b5fd;
    }
    .focusguard-btn-close {
      background: #3f3f46;
      color: #e4e4e7;
    }
    .focusguard-btn-close:hover {
      background: #52525b;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  // Wire up buttons
  document.getElementById("focusguard-continue").addEventListener("click", hideOverlay);
  document.getElementById("focusguard-close").addEventListener("click", () => {
    window.close();
  });

  overlayVisible = true;
}

function hideOverlay() {
  const overlay = document.getElementById("focusguard-reintervention-overlay");
  const styles = document.getElementById("focusguard-overlay-styles");
  if (overlay) overlay.remove();
  if (styles) styles.remove();
  overlayVisible = false;
  startTime = Date.now(); // Reset timer
}

// ── Timer Logic ─────────────────────────────────────────
function startReInterventionTimer(intervalMs) {
  if (timerHandle) clearInterval(timerHandle);

  timerHandle = setInterval(() => {
    if (!overlayVisible) {
      createOverlay();
    }
  }, intervalMs);
}

// ── Initialization ──────────────────────────────────────
async function init() {
  const hostname = window.location.hostname;

  try {
    const data = await chrome.storage.sync.get(["sites"]);
    const sites = data.sites || [];

    const site = sites.find((s) => {
      const siteDomain = s.domain.replace(/^www\./, "").toLowerCase();
      const currentDomain = hostname.replace(/^www\./, "").toLowerCase();
      return siteDomain === currentDomain || currentDomain.endsWith("." + siteDomain);
    });

    if (!site) return;
    if (site.interventionMode !== "strip") return;

    const frictionLevel = site.frictionLevel || 3;
    if (frictionLevel !== 2) return; // Only Level 2 uses overlay

    const intervalMs = DEFAULT_INTERVAL_MS;
    startReInterventionTimer(intervalMs);
  } catch (err) {
    console.error("FocusGuard re-intervention init failed:", err);
  }
}

init();

// Listen for storage changes (friction level updates)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.sites) {
    // Restart timer with new config
    init();
  }
});
