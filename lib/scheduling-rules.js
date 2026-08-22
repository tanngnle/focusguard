/*  ══════════════════════════════════════════════════════
    MindfulBrowse — Scheduling Rules (Pure Module)
    Time-based blocking and recurring focus sessions.
    No DOM, no chrome.*.
    ═══════════════════════════════════════════════════════ */

// ── Schedule Presets ────────────────────────────────────
export const SCHEDULE_PRESETS = {
  workHours: {
    name: "Work Hours",
    days: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: "09:00",
    endTime: "17:00",
  },
  studyTime: {
    name: "Study Time",
    days: [1, 2, 3, 4, 5, 6, 0], // All days
    startTime: "18:00",
    endTime: "22:00",
  },
  eveningWindDown: {
    name: "Evening Wind-Down",
    days: [0, 1, 2, 3, 4, 5, 6], // All days
    startTime: "21:00",
    endTime: "23:00",
  },
};

// ── Time Parsing ────────────────────────────────────────
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

// ── isScheduleActive ────────────────────────────────────
/**
 * Check if a schedule is active at a given time.
 *
 * @param {object|null} schedule - Schedule configuration
 * @param {number} now - Current time as epoch ms
 * @returns {boolean} True if schedule is active
 */
export function isScheduleActive(schedule, now) {
  if (!schedule || !schedule.enabled) return false;

  const date = new Date(now);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  // Check if current day is in the schedule
  if (!schedule.days.includes(dayOfWeek)) return false;

  // Check if current time is within the window
  const startMinutes = parseTime(schedule.startTime);
  const endMinutes = parseTime(schedule.endTime);

  if (startMinutes <= endMinutes) {
    // Normal case: start < end (e.g., 09:00-17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight case: start > end (e.g., 22:00-06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// ── getNextScheduleChange ───────────────────────────────
/**
 * Get the next time a schedule will change state (activate/deactivate).
 *
 * @param {object} schedule - Schedule configuration
 * @param {number} now - Current time as epoch ms
 * @returns {number} Epoch ms of next change
 */
export function getNextScheduleChange(schedule, now) {
  if (!schedule) return now + 60 * 60 * 1000; // Default: 1 hour

  const date = new Date(now);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = parseTime(schedule.startTime);
  const endMinutes = parseTime(schedule.endTime);

  let nextChangeMinutes;

  if (isScheduleActive(schedule, now)) {
    // Currently active — next change is end time
    nextChangeMinutes = endMinutes;
  } else {
    // Currently inactive — next change is start time
    nextChangeMinutes = startMinutes;
  }

  // Calculate ms until next change
  let minutesUntil = nextChangeMinutes - currentMinutes;
  if (minutesUntil <= 0) minutesUntil += 24 * 60; // Next day

  return now + minutesUntil * 60 * 1000;
}
