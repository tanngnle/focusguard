/*  ═══════════════════════════════════════════════════════
    MindfulBrowse — Scheduling Rules Tests
    Tests for time-based blocking and recurring sessions
    ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { isScheduleActive, SCHEDULE_PRESETS } from "../../lib/scheduling-rules.js";

describe("SCHEDULE_PRESETS", () => {
  it("should have work hours preset", () => {
    expect(SCHEDULE_PRESETS.workHours).toBeDefined();
    expect(SCHEDULE_PRESETS.workHours.name).toBe("Work Hours");
  });

  it("should have study time preset", () => {
    expect(SCHEDULE_PRESETS.studyTime).toBeDefined();
    expect(SCHEDULE_PRESETS.studyTime.name).toBe("Study Time");
  });

  it("should have evening wind-down preset", () => {
    expect(SCHEDULE_PRESETS.eveningWindDown).toBeDefined();
    expect(SCHEDULE_PRESETS.eveningWindDown.name).toBe("Evening Wind-Down");
  });
});

describe("isScheduleActive", () => {
  it("should return false for null schedule", () => {
    expect(isScheduleActive(null, Date.now())).toBe(false);
  });

  it("should return false for disabled schedule", () => {
    const schedule = { enabled: false, days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" };
    expect(isScheduleActive(schedule, Date.now())).toBe(false);
  });

  it("should return true when current time is within schedule window", () => {
    // Create a date that's Wednesday 10:00 AM
    const testDate = new Date("2026-08-21T10:00:00").getTime(); // Thursday
    const schedule = {
      enabled: true,
      days: [1, 2, 3, 4, 5], // Mon-Fri
      startTime: "09:00",
      endTime: "17:00",
    };
    expect(isScheduleActive(schedule, testDate)).toBe(true);
  });

  it("should return false when current time is outside schedule window", () => {
    // Create a date that's Wednesday 8:00 AM (before schedule starts)
    const testDate = new Date("2026-08-21T08:00:00").getTime();
    const schedule = {
      enabled: true,
      days: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "17:00",
    };
    expect(isScheduleActive(schedule, testDate)).toBe(false);
  });

  it("should return false on weekend for weekday-only schedule", () => {
    // Saturday
    const testDate = new Date("2026-08-22T10:00:00").getTime();
    const schedule = {
      enabled: true,
      days: [1, 2, 3, 4, 5], // Mon-Fri
      startTime: "09:00",
      endTime: "17:00",
    };
    expect(isScheduleActive(schedule, testDate)).toBe(false);
  });
});
