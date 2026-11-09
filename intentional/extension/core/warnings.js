import { RequestError } from "./messages.js";

export const WARNING_MS = 30000;

export function warningKeys(rule, day) {
  return {
    daily: `daily:${rule.id}:${day}:${rule.dailyMinutes}:30s`,
    session: rule.sessionDeadline
      ? `session:${rule.id}:${rule.sessionDeadline}:30s`
      : null,
  };
}

export function dismissedKeys(runtime, now = Date.now()) {
  runtime.dismissedWarnings ||= {};
  for (const [key, deadline] of Object.entries(runtime.dismissedWarnings))
    if (deadline <= now) delete runtime.dismissedWarnings[key];
  return Object.keys(runtime.dismissedWarnings);
}

export function dismissWarning(runtime, rule, clock, now, resetAt) {
  const remaining =
    clock === "session"
      ? rule.sessionRemainingMs
      : clock === "daily" && !rule.dailyReached
        ? rule.remainingMs
        : null;
  const key = rule.warningKeys?.[clock];
  if (!key || remaining === null || remaining <= 0 || remaining > WARNING_MS)
    throw new RequestError(
      "WARNING_EXPIRED",
      "This reminder is no longer active.",
    );
  dismissedKeys(runtime, now);
  runtime.dismissedWarnings[key] =
    clock === "session" ? rule.sessionDeadline : resetAt;
}
