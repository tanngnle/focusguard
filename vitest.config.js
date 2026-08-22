import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default "forks" pool spawns child processes, which hangs
    // ("Timeout waiting for worker to respond") in some sandboxed/restricted
    // shells (observed in this environment). The "threads" pool runs
    // workers as worker_threads in-process instead and is unaffected —
    // switching avoids the whole class of problem.
    pool: "threads",
    // Cap worker parallelism for determinism on modest machines: running
    // every jsdom suite fully in parallel caused CPU-bound load spikes
    // (the very flakes the timeout below absorbs). Two workers keep
    // runtime reasonable while leaving headroom. (Vitest 4: the old
    // poolOptions.threads.maxThreads moved to top-level maxWorkers.)
    maxWorkers: 2,
    environment: "jsdom",
    // jsdom-based suites are CPU-bound and this machine runs all files in
    // parallel, so the 5s default occasionally times out healthy tests under
    // peak load (observed flakes in popup/blocked suites). 15s keeps a real
    // hang fast-failing while absorbing load spikes.
    testTimeout: 15000,
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
