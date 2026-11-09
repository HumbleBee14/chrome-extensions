import { RequestError } from "./messages.js";

export const MINUTE_MS = 60_000;
export const TIME_LIMITS = Object.freeze({
  min: 1,
  max: 1440,
  defaultDaily: 30,
  defaultSession: 15,
});

export function wholeMinutes(value, max = TIME_LIMITS.max) {
  const validType =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value.trim()));
  const minutes = Number(value);
  if (
    !validType ||
    !Number.isInteger(minutes) ||
    minutes < TIME_LIMITS.min ||
    minutes > max
  )
    throw new RequestError(
      "INVALID_DURATION",
      `Choose a whole number from ${TIME_LIMITS.min} to ${max} minutes.`,
    );
  return minutes;
}

export function timeChoice(rules, now, resetAt, overriding = false) {
  const availableMs = Math.max(
    0,
    Math.min(
      resetAt - now,
      ...rules.map((rule) => {
        if (overriding && rule.locked) return rule.dailyMinutes * MINUTE_MS;
        if (rule.overrideActive) return rule.sessionRemainingMs;
        return rule.remainingMs;
      }),
    ),
  );
  const max = Math.floor(availableMs / MINUTE_MS);
  return {
    min: TIME_LIMITS.min,
    max,
    default: Math.min(TIME_LIMITS.defaultSession, max),
    availableMs,
  };
}

export function chosenDuration(choice, minutes, useRemaining = false) {
  if (useRemaining && choice.max === 0 && choice.availableMs > 0)
    return choice.availableMs;
  if (choice.max === 0)
    throw new RequestError(
      "INVALID_DURATION",
      "Use the remaining seconds before choosing another minute.",
    );
  return wholeMinutes(minutes ?? choice.default, choice.max) * MINUTE_MS;
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return (
    [
      hours ? `${hours}h` : "",
      minutes ? `${minutes}m` : "",
      rest ? `${rest}s` : "",
    ]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}

export function formatUsedDuration(ms) {
  return formatDuration(Math.floor(ms / 1000) * 1000);
}

export function totalUsedMs(rule) {
  return rule.usedMs + (rule.overtimeMs || 0);
}
