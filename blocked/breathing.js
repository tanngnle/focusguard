/*  ══════════════════════════════════════════════════════
    FocusGuard — Breathing Interstitial Logic
    Level 1 friction: mindful delay with breathing exercise
    ═══════════════════════════════════════════════════════ */

// ── DOM References ──────────────────────────────────────
const breathingText = document.getElementById("breathing-text");
const timerDisplay = document.getElementById("timer-display");
const intentionInput = document.getElementById("intention");
const continueBtn = document.getElementById("continue-btn");
const domainDisplay = document.getElementById("domain-display");

// ── Parse URL params ────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const domain = params.get("domain") || "a distracting site";
const delaySeconds = parseInt(params.get("delay")) || 5;
domainDisplay.textContent = domain;

// ── Breathing cycle ─────────────────────────────────────
const BREATHING_PHRASES = [
  "Breathe in...",
  "Hold...",
  "Breathe out...",
  "Hold...",
];

let breathIndex = 0;
let timeRemaining = delaySeconds;

// Update breathing text every 1.25 seconds (5s cycle / 4 phases)
const breathingInterval = setInterval(() => {
  breathIndex = (breathIndex + 1) % BREATHING_PHRASES.length;
  breathingText.textContent = BREATHING_PHRASES[breathIndex];
}, 1250);

// Countdown timer
const countdownInterval = setInterval(() => {
  timeRemaining--;
  timerDisplay.textContent = timeRemaining;

  if (timeRemaining <= 0) {
    clearInterval(countdownInterval);
    clearInterval(breathingInterval);
    continueBtn.classList.add("active");
    breathingText.textContent = "Ready when you are";
  }
}, 1000);

// ── Continue button ─────────────────────────────────────
continueBtn.addEventListener("click", () => {
  if (timeRemaining > 0) return; // Button not active yet

  const intention = intentionInput.value.trim();

  // Log intention (optional, for user reflection)
  if (intention) {
    console.log(`FocusGuard intention for ${domain}: ${intention}`);
  }

  // Navigate to the original site
  // The domain was passed as a param, reconstruct the URL
  const targetUrl = `https://${domain}`;
  window.location.href = targetUrl;
});

// ── Keyboard shortcut ───────────────────────────────────
// Allow Enter key to continue once timer expires
intentionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && timeRemaining <= 0) {
    continueBtn.click();
  }
});
