import {
  formatDuration,
  formatUsedDuration,
  totalUsedMs,
  MINUTE_MS,
} from "../core/timing.js";

export function readableTime(ms, used = false) {
  return (used ? formatUsedDuration(ms) : formatDuration(ms))
    .replace(/(\d+)h/g, "$1 hr")
    .replace(/(\d+)m/g, "$1 min")
    .replace(/(\d+)s/g, "$1 sec");
}

export function dailySummary(rule) {
  return `${readableTime(totalUsedMs(rule), true)} used · ${readableTime(rule.dailyMinutes * MINUTE_MS)} limit`;
}

// One countdown reflects the earliest boundary that can stop this page.
export function popupClock(rules) {
  const enabled = rules.filter((rule) => rule.enabled !== false);
  if (!enabled.length) return { label: "Status", value: "Paused" };
  const active = enabled.filter((rule) => rule.hasAccess !== false);
  if (!active.length) return { label: "Status", value: "Access needed" };
  if (active.some((rule) => rule.locked))
    return { label: "Status", value: "Daily limit reached" };
  if (
    active.some(
      (rule) =>
        rule.needsIntention || (rule.sessionExpired && !rule.overrideActive),
    )
  )
    return {
      label: "This visit",
      value: active.some((rule) => rule.sessionExpired)
        ? "Time to check in"
        : "Waiting to start",
    };
  const remaining = Math.min(
    ...active.flatMap((rule) => [
      ...(!rule.overrideActive ? [rule.remainingMs] : []),
      ...(rule.sessionRemainingMs != null ? [rule.sessionRemainingMs] : []),
    ]),
  );
  const label = active.every((rule) => rule.overrideActive)
    ? "Extra time"
    : active.some((rule) => rule.sessionRemainingMs != null)
      ? "This visit"
      : "Daily allowance";
  return { label, value: `${readableTime(remaining)} left` };
}
