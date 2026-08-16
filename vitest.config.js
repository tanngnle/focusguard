import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default "forks" pool spawns child processes, which hangs
    // ("Timeout waiting for worker to respond") in some sandboxed/restricted
    // shells (observed in this environment). The "threads" pool runs
    // workers as worker_threads in-process instead and is unaffected —
    // switching avoids the whole class of problem.
    pool: "threads",
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    // A later agent may add Playwright specs under tests/e2e/ — those are
    // driven by `playwright test`, not vitest, and must never be collected
    // here (jsdom can't run a real browser, and playwright's `test()` global
    // isn't vitest's).
    exclude: ["tests/e2e/**", "node_modules/**"],
    // The harness must exit 0 even before any *.test.js files exist yet
    // (other agents are still landing the source rewrite this harness will
    // be tested against).
    passWithNoTests: true,
  },
});
