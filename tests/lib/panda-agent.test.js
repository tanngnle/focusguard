import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PANDA_SYSTEM_PROMPT,
  checkAvailability,
  createPandaSession,
  createSessionWithProgress,
} from "../../lib/panda-agent.js";

// ── Mock LanguageModel global ────────────────────────────
function installLanguageModelMock(availability = "available") {
  const mockSession = {
    prompt: vi.fn().mockResolvedValue("mock response"),
    promptStreaming: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    clone: vi.fn().mockResolvedValue({}),
    addEventListener: vi.fn(),
    contextUsage: 100,
    contextWindow: 1000,
  };

  globalThis.LanguageModel = {
    availability: vi.fn().mockResolvedValue(availability),
    create: vi.fn().mockResolvedValue(mockSession),
    params: vi.fn().mockResolvedValue({
      defaultTopK: 3,
      maxTopK: 128,
      defaultTemperature: 1,
      maxTemperature: 2,
    }),
  };

  return mockSession;
}

describe("panda-agent", () => {
  beforeEach(() => {
    delete globalThis.LanguageModel;
  });

  // ── PANDA_SYSTEM_PROMPT ──────────────────────────────
  describe("PANDA_SYSTEM_PROMPT", () => {
    it("contains the {domain} placeholder for context injection", () => {
      expect(PANDA_SYSTEM_PROMPT).toContain("{domain}");
    });

    it("defines Bao's identity and personality traits", () => {
      expect(PANDA_SYSTEM_PROMPT).toContain("Bao");
      expect(PANDA_SYSTEM_PROMPT).toContain("passive-aggressive");
      expect(PANDA_SYSTEM_PROMPT).toContain("sarcastic");
    });

    it("instructs the model to keep responses short", () => {
      expect(PANDA_SYSTEM_PROMPT).toContain("1-3 sentences");
    });
  });

  // ── checkAvailability ────────────────────────────────
  describe("checkAvailability", () => {
    it("returns 'unavailable' when LanguageModel is not defined", async () => {
      expect(await checkAvailability()).toBe("unavailable");
    });

    it("returns 'available' when model is ready", async () => {
      installLanguageModelMock("available");
      expect(await checkAvailability()).toBe("available");
    });

    it("returns 'downloading' when model is downloading", async () => {
      installLanguageModelMock("downloading");
      expect(await checkAvailability()).toBe("downloading");
    });

    it("returns 'downloading' when model is downloadable", async () => {
      installLanguageModelMock("downloadable");
      expect(await checkAvailability()).toBe("downloading");
    });

    it("returns 'unavailable' for unknown availability states", async () => {
      installLanguageModelMock("unavailable");
      expect(await checkAvailability()).toBe("unavailable");
    });

    it("returns 'unavailable' when availability() throws", async () => {
      globalThis.LanguageModel = {
        availability: vi.fn().mockRejectedValue(new Error("fail")),
      };
      expect(await checkAvailability()).toBe("unavailable");
    });
  });

  // ── createPandaSession ───────────────────────────────
  describe("createPandaSession", () => {
    it("creates a session with the system prompt containing the domain", async () => {
      const mockSession = installLanguageModelMock();

      const session = await createPandaSession("twitter.com");

      expect(LanguageModel.create).toHaveBeenCalledOnce();
      const opts = LanguageModel.create.mock.calls[0][0];
      expect(opts.initialPrompts).toHaveLength(1);
      expect(opts.initialPrompts[0].role).toBe("system");
      expect(opts.initialPrompts[0].content).toContain("twitter.com");
      expect(opts.initialPrompts[0].content).not.toContain("{domain}");
      expect(session).toBe(mockSession);
    });

    it("uses fallback text when domain is empty", async () => {
      installLanguageModelMock();

      await createPandaSession("");

      const opts = LanguageModel.create.mock.calls[0][0];
      expect(opts.initialPrompts[0].content).toContain("a distracting site");
    });

    it("sets expected input/output modalities", async () => {
      installLanguageModelMock();

      await createPandaSession("reddit.com");

      const opts = LanguageModel.create.mock.calls[0][0];
      expect(opts.expectedInputs).toEqual([{ type: "text", languages: ["en"] }]);
      expect(opts.expectedOutputs).toEqual([{ type: "text", languages: ["en"] }]);
    });
  });

  // ── createSessionWithProgress ────────────────────────
  describe("createSessionWithProgress", () => {
    it("passes a monitor callback to LanguageModel.create", async () => {
      installLanguageModelMock();
      const onProgress = vi.fn();

      await createSessionWithProgress(onProgress);

      const opts = LanguageModel.create.mock.calls[0][0];
      expect(opts.monitor).toBeTypeOf("function");
    });

    it("calls onProgress with percentage from download events", async () => {
      // Capture the monitor function so we can fire events on it
      let capturedMonitor;
      globalThis.LanguageModel = {
        availability: vi.fn().mockResolvedValue("available"),
        create: vi.fn((opts) => {
          capturedMonitor = opts.monitor;
          return Promise.resolve({});
        }),
      };

      const onProgress = vi.fn();
      await createSessionWithProgress(onProgress);

      // Simulate the monitor callback
      expect(capturedMonitor).toBeTypeOf("function");
      const mockMonitor = new EventTarget();
      capturedMonitor(mockMonitor);

      // Fire a downloadprogress event
      const event = new Event("downloadprogress");
      event.loaded = 0.42;
      mockMonitor.dispatchEvent(event);

      expect(onProgress).toHaveBeenCalledWith(42);
    });
  });
});
