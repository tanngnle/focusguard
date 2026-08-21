/*  ═══════════════════════════════════════════════════════
    FocusGuard — Flip Clock (shared view component)
    Pure DOM module, no chrome.*, no internal timers other
    than the flip-animation cleanup — matches the lib/
    module pattern. Builds an MM:SS readout from four
    per-digit flip cards plus a colon separator, and
    setTime() diffs against the previously displayed value
    so ONLY cards whose digit actually changed animate
    (seconds-ones flips every tick; minute digits once per
    60 ticks). All styling lives in lib/flip-clock.css.
    ═══════════════════════════════════════════════════════ */

// Duration of ONE half of the flip (top leaf folding down, or bottom leaf
// unfolding). A full digit flip takes 2 x FLIP_MS. Keep in sync with
// --flip-ms in lib/flip-clock.css — the CSS animates the leaves, this
// timeout only removes them afterwards.
const FLIP_MS = 300;

function prefersReducedMotion() {
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Creates a flip clock inside `container`. The container gains the
 * `flip-clock` class (sized via the `--flip-size` custom property) and is
 * marked aria-hidden — callers own the accessible announcement channel.
 *
 * @param {HTMLElement} container element to mount into (emptied first)
 * @returns {{ setTime(time: string): void, getTime(): string|null, destroy(): void }}
 */
export function createFlipClock(container) {
  let current = null; // last displayed "MM:SS"
  let destroyed = false;

  // cards[i] = { root, top, bottom, timeout } where top/bottom are the
  // static half glyphs; leaves are transient children of `root`.
  const cards = [];

  function makeGlyph(digit) {
    const glyph = document.createElement("span");
    glyph.className = "flip-glyph";
    glyph.textContent = digit;
    return glyph;
  }

  function makeHalf(className, digit) {
    const half = document.createElement("div");
    half.className = `flip-half ${className}`;
    half.appendChild(makeGlyph(digit));
    return half;
  }

  function buildDigitCard() {
    const root = document.createElement("div");
    root.className = "flip-digit";
    root.appendChild(makeHalf("flip-top", "0"));
    root.appendChild(makeHalf("flip-bottom", "0"));
    container.appendChild(root);
    return {
      root,
      top: root.querySelector(".flip-top .flip-glyph"),
      bottom: root.querySelector(".flip-bottom .flip-glyph"),
      timeout: null,
    };
  }

  function buildColon() {
    const colon = document.createElement("span");
    colon.className = "flip-colon";
    colon.textContent = ":";
    container.appendChild(colon);
  }

  // ── Build: MM : SS ────────────────────────────────────
  // Match the documented contract: the container is emptied FIRST, so a
  // mount into a used element can't duplicate the cards.
  container.innerHTML = "";
  container.classList.add("flip-clock");
  container.setAttribute("aria-hidden", "true");
  cards.push(buildDigitCard(), buildDigitCard());
  buildColon();
  cards.push(buildDigitCard(), buildDigitCard());

  // ── Helpers ───────────────────────────────────────────
  // Accepts "MM:SS"; anything else clamps to "00:00" rather than throwing —
  // a display component must never take the timer page down.
  function normalize(value) {
    return typeof value === "string" && /^\d{2}:\d{2}$/.test(value)
      ? value
      : "00:00";
  }

  function digitArrayOf(time) {
    return [time[0], time[1], time[3], time[4]];
  }

  function setDigitInstant(card, digit) {
    card.top.textContent = digit;
    card.bottom.textContent = digit;
  }

  function clearLeaves(card) {
    card.root.querySelectorAll(".flip-leaf").forEach((leaf) => leaf.remove());
  }

  function finalize(card) {
    if (card.timeout != null) {
      clearTimeout(card.timeout);
      card.timeout = null;
    }
    clearLeaves(card);
    card.root.classList.remove("is-flipping");
  }

  function appendLeaf(card, className, digit) {
    const leaf = document.createElement("div");
    leaf.className = `flip-half flip-leaf ${className}`;
    leaf.appendChild(makeGlyph(digit));
    card.root.appendChild(leaf);
  }

  // Classic two-leaf flip, CSS-only (rotateX on .flip-leaf-*):
  //   1. static top half already shows NEW; a leaf with the OLD digit
  //      folds down over it (0 → -90deg, origin bottom).
  //   2. static bottom half still shows OLD; a leaf with the NEW digit
  //      unfolds over it (90deg → 0, origin top), delayed by FLIP_MS.
  //   3. after 2 x FLIP_MS the leaves are removed and the static bottom
  //      half catches up to NEW.
  function flipDigit(card, newDigit) {
    finalize(card); // collapse any in-flight flip first
    const oldDigit = card.top.textContent;

    if (prefersReducedMotion()) {
      // Instant text swap, no animation.
      setDigitInstant(card, newDigit);
      return;
    }

    card.root.classList.add("is-flipping");
    card.top.textContent = newDigit; // revealed as the top leaf folds away
    appendLeaf(card, "flip-leaf-top", oldDigit);
    appendLeaf(card, "flip-leaf-bottom", newDigit);

    card.timeout = setTimeout(() => {
      card.timeout = null;
      clearLeaves(card);
      card.bottom.textContent = newDigit;
      card.root.classList.remove("is-flipping");
    }, FLIP_MS * 2);
  }

  // ── Public API ────────────────────────────────────────
  function setTime(value) {
    if (destroyed) return;
    const next = normalize(value);
    const digits = digitArrayOf(next);

    // First paint — set every card, no animation.
    if (current === null) {
      digits.forEach((digit, i) => setDigitInstant(cards[i], digit));
      current = next;
      return;
    }

    if (next === current) return;

    // Diff against the previous readout: only changed digits flip.
    const prev = digitArrayOf(current);
    digits.forEach((digit, i) => {
      if (digit !== prev[i]) flipDigit(cards[i], digit);
    });
    current = next;
  }

  function getTime() {
    return current;
  }

  function destroy() {
    cards.forEach(finalize);
    destroyed = true;
    container.innerHTML = "";
    container.classList.remove("flip-clock");
  }

  return { setTime, getTime, destroy };
}
