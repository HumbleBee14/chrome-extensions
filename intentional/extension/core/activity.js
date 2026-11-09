import { dayKey } from "./engine.js";

export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

export function periodDays(day, mode) {
  if (mode === "day") return [day];
  const weekday = new Date(`${day}T12:00:00`).getDay();
  const monday = shiftDay(day, -(weekday + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

export function activitySummary(state, days) {
  const retained = days.filter(
    (day) => day >= shiftDay(state.today, -29) && day <= state.today,
  );
  const selected = new Set(retained);
  const logs = state.logs.filter((log) => selected.has(dayKey(log.at)));
  const first = state.activitySince ? dayKey(state.activitySince) : null;
  const available = retained.filter(
    (day) => first && day >= first && day <= state.today,
  );
  return {
    logs,
    sessions: logs.filter((log) => log.type !== "override").length,
    overrides: retained.reduce(
      (total, day) =>
        total +
        Object.values(state.overrideCounts?.[day] || {}).reduce(
          (sum, count) => sum + count,
          0,
        ),
      0,
    ),
    overtimeMs: available.length
      ? available.reduce(
          (total, day) => total + (state.activeOvertimeDays?.[day] || 0),
          0,
        )
      : null,
    activeMs: available.length
      ? available.reduce(
          (total, day) => total + (state.activeDays?.[day] || 0),
          0,
        )
      : null,
    partial:
      available.length > 0 &&
      (available.length < days.filter((day) => day <= state.today).length ||
        (days.includes(first) &&
          state.activitySince > new Date(`${first}T00:00:00`).getTime())),
  };
}

export function activityTime(ms) {
  if (ms === null) return "—";
  if (ms === 0) return "0m";
  if (ms < 60000) return "<1m";
  const minutes = Math.floor(ms / 60000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
}
