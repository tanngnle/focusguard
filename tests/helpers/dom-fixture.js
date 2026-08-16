/**
 * dom-fixture.js — test-only helper (NOT the chrome mock) for mounting the
 * real popup.html / blocked.html markup into jsdom's document.body before
 * dynamically importing popup.js / blocked.js, which both wire themselves
 * up against real element IDs at import/DOMContentLoaded time.
 *
 * We deliberately mount the actual on-disk HTML (minus <script>, <link>,
 * <!doctype>, <html>, <head>, <body> wrapper tags) rather than a hand-rolled
 * approximation, so the fixture can't drift from the real markup silently.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function extractBodyInner(html) {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!match) throw new Error("dom-fixture: could not find <body> in HTML source");
  // Strip any <script>...</script> tags — the module under test is imported
  // separately via dynamic import(), not by letting jsdom execute a
  // <script type="module"> tag (jsdom doesn't run module scripts).
  return match[1].replace(/<script[\s\S]*?<\/script>/gi, "");
}

/** Mounts popup/popup.html's body content into document.body. */
export function mountPopupDom() {
  const html = readFileSync(path.join(ROOT, "popup", "popup.html"), "utf8");
  document.body.innerHTML = extractBodyInner(html);
}

/** Mounts blocked/blocked.html's body content into document.body. */
export function mountBlockedDom() {
  const html = readFileSync(path.join(ROOT, "blocked", "blocked.html"), "utf8");
  document.body.innerHTML = extractBodyInner(html);
}

/**
 * Dispatches a synthetic DOMContentLoaded on `document`. jsdom's own
 * DOMContentLoaded already fired before test code runs (the document was
 * "loaded" the moment the test environment was set up), so modules that do
 * `document.addEventListener("DOMContentLoaded", init)` need a manually
 * dispatched event to invoke `init`.
 */
export function fireDomContentLoaded() {
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
}

/** Flushes the microtask queue N times (default enough for a few chained awaits). */
export async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}
