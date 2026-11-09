import { timeChoice, chosenDuration, MINUTE_MS } from "./timing.js";
import {
  presetsFor,
  messageColor,
  normalizeMessage,
  DEFAULT_REASONS,
} from "./preferences.js";
import { warningKeys, WARNING_MS } from "./warnings.js";
import { matches } from "./rules.js";

export const MAX_GAP_MS = 10000;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;

export function createState() {
  return {
    version: 1,
    settings: { strictMode: false, reasonPresets: [...DEFAULT_REASONS] },
    rules: [],
    days: {},
    activeDays: {},
    activeOvertimeDays: {},
    activitySince: new Date().setHours(0, 0, 0, 0),
    logs: [],
    locks: {},
    sessions: {},
    overrides: {},
    overrideCounts: {},
    overtimeDays: {},
  };
}

export function dayKey(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function nextMidnight(time = Date.now()) {
  const date = new Date(time);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

export function settleUsage(state, cursor, now = Date.now()) {
  if (!cursor?.ids?.length || !Number.isFinite(cursor.at) || cursor.at >= now)
    return;
  let start = cursor.at;
  const end = Math.min(now, start + MAX_GAP_MS);
  while (start < end) {
    const until = Math.min(end, nextMidnight(start));
    const key = dayKey(start);
    const rules = [...new Set(cursor.ids)]
      .map((id) => state.rules.find((rule) => rule.id === id && rule.enabled))
      .filter(Boolean);
    if (!rules.length) break;
    state.days[key] ||= {};
    const intervals = rules.map((rule) => {
      const used = state.days[key][rule.id] || 0;
      const remaining = Math.max(0, rule.dailyMinutes * 60000 - used);
      const reached = remaining === 0 || state.locks[rule.id]?.day === key;
      const override = state.overrides?.[rule.id];
      const extra =
        reached && !rule.preventOverrides && override?.day === key
          ? override
          : null;
      const session = state.sessions[rule.id];
      const needsSession = rule.requireReason || rule.requireSession;
      const deadline = extra
        ? override.deadline
        : reached
          ? start
          : Math.min(
              start + remaining,
              needsSession
                ? session?.day === key
                  ? session.deadline
                  : start
                : Infinity,
            );
      return { rule, used, extra, deadline };
    });
    const activeUntil = Math.max(
      start,
      Math.min(until, ...intervals.map((item) => item.deadline)),
    );
    const elapsed = activeUntil - start;
    state.activeDays ||= {};
    state.activeOvertimeDays ||= {};
    state.overtimeDays ||= {};
    let overtime = 0;
    for (const { rule, used, extra } of intervals) {
      state.days[key][rule.id] = Math.min(
        rule.dailyMinutes * 60000,
        used + elapsed,
      );
      if (extra) {
        const extraMs = Math.max(
          0,
          activeUntil - Math.max(start, extra.startedAt),
        );
        state.overtimeDays[key] ||= {};
        state.overtimeDays[key][rule.id] =
          (state.overtimeDays[key][rule.id] || 0) + extraMs;
        overtime = Math.max(overtime, extraMs);
      }
    }
    state.activeDays[key] = (state.activeDays[key] || 0) + elapsed;
    state.activeOvertimeDays[key] =
      (state.activeOvertimeDays[key] || 0) + overtime;
    start = until;
  }
}

export function expireSessions(state, now = Date.now()) {
  const today = dayKey(now);
  state.overrides ||= {};
  state.overrideCounts ||= {};
  state.overtimeDays ||= {};
  for (const [id, override] of Object.entries(state.overrides))
    if (override.day !== today) delete state.overrides[id];
  for (const [id, lock] of Object.entries(state.locks))
    if (lock.day !== today || lock.reason === "session") delete state.locks[id];
  for (const [id, session] of Object.entries(state.sessions))
    if (session.day !== today) delete state.sessions[id];
}

export function ruleStatus(state, rule, now = Date.now()) {
  const today = dayKey(now);
  const usedMs = state.days[today]?.[rule.id] || 0;
  const remainingMs = Math.max(0, rule.dailyMinutes * 60000 - usedMs);
  const lock = state.locks[rule.id];
  const override = state.overrides?.[rule.id];
  const dailyReached = remainingMs === 0 || lock?.day === today;
  const overrideActive = Boolean(
    dailyReached &&
    !rule.preventOverrides &&
    override?.day === today &&
    override.deadline > now,
  );
  const session = overrideActive ? override : state.sessions[rule.id];
  const sessionRemainingMs =
    session?.day === today ? Math.max(0, session.deadline - now) : null;
  const locked = dailyReached && !overrideActive;
  return {
    ...rule,
    messageColor: messageColor(rule.messageColor),
    message: normalizeMessage(rule.message),
    usedMs,
    remainingMs,
    dailyReached,
    overrideActive,
    canOverride: locked && !rule.preventOverrides,
    overrideAttempt: state.overrideCounts?.[today]?.[rule.id] || 0,
    overtimeMs: state.overtimeDays?.[today]?.[rule.id] || 0,
    sessionRemainingMs,
    sessionDeadline: session?.day === today ? session.deadline : null,
    warningThresholdMs: WARNING_MS,
    warningKeys: warningKeys(
      {
        ...rule,
        sessionDeadline: session?.day === today ? session.deadline : null,
      },
      today,
    ),
    previousReason:
      dailyReached && override?.day === today
        ? override.reason || ""
        : session?.day === today
          ? session.reason || ""
          : "",
    sessionExpired: sessionRemainingMs === 0,
    needsIntention: Boolean(
      !dailyReached &&
      (rule.requireReason || rule.requireSession) &&
      (sessionRemainingMs === null || sessionRemainingMs === 0),
    ),
    locked,
    lockReason:
      remainingMs === 0 ? "daily" : lock?.day === today ? lock.reason : null,
  };
}

export function evaluate(state, url, now = Date.now()) {
  expireSessions(state, now);
  const rules = state.rules
    .filter((rule) => matches(rule, url))
    .map((rule) => ruleStatus(state, rule, now));
  if (!rules.length)
    return { kind: "none", rules: [], now, resetAt: nextMidnight(now) };
  let kind = "allowed";
  if (rules.some((rule) => rule.locked)) kind = "blocked";
  else if (rules.some((rule) => rule.needsIntention)) kind = "prompt";
  return {
    kind,
    rules,
    now,
    resetAt: nextMidnight(now),
    timeChoice: timeChoice(rules, now, nextMidnight(now), kind === "blocked"),
    reasonPresets: presetsFor(state, rules),
    canOverride:
      kind === "blocked" &&
      rules.filter((rule) => rule.locked).every((rule) => rule.canOverride),
  };
}

export function approve(
  state,
  rules,
  reason,
  minutes,
  now = Date.now(),
  useRemaining = false,
) {
  expireSessions(state, now);
  if (rules.some((rule) => ruleStatus(state, rule, now).locked))
    throw new Error("This limit has been reached. Come back tomorrow.");
  const pending = rules.filter(
    (rule) => ruleStatus(state, rule, now).needsIntention,
  );
  if (!pending.length) return;
  const cleanReason = String(reason || "").trim();
  if (
    pending.some((rule) => rule.requireReason) &&
    (cleanReason.length < 3 || cleanReason.length > 500)
  )
    throw new Error("Write a reason between 3 and 500 characters.");
  const durationMs = chosenDuration(
    timeChoice(
      rules.map((rule) => ruleStatus(state, rule, now)),
      now,
      nextMidnight(now),
    ),
    minutes,
    useRemaining,
  );
  for (const rule of pending) {
    state.sessions[rule.id] = {
      day: dayKey(now),
      deadline: Math.min(nextMidnight(now), now + durationMs),
      startedAt: now,
      reason: cleanReason,
    };
  }
  state.logs.unshift({
    id: crypto.randomUUID(),
    at: now,
    ruleIds: pending.map((rule) => rule.id),
    labels: pending.map((rule) => rule.label),
    reason: cleanReason,
    durationMs,
    minutes: durationMs % MINUTE_MS === 0 ? durationMs / MINUTE_MS : null,
  });
  prune(state, now);
}

export function approveOverride(
  state,
  rules,
  reason,
  now = Date.now(),
  minutes,
  useRemaining = false,
) {
  expireSessions(state, now);
  const statuses = rules.map((rule) => ruleStatus(state, rule, now));
  const pending = statuses.filter((rule) => rule.locked);
  if (pending.some((rule) => !rule.canOverride))
    throw new Error("This limit prevents overrides until tomorrow.");
  if (!pending.length) return;
  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < 3 || cleanReason.length > 500)
    throw new Error("Write a reason between 3 and 500 characters.");
  const durationMs = chosenDuration(
    timeChoice(statuses, now, nextMidnight(now), true),
    minutes,
    useRemaining,
  );
  const durationMinutes =
    durationMs % MINUTE_MS === 0 ? durationMs / MINUTE_MS : null;
  const today = dayKey(now);
  state.overrideCounts[today] ||= {};
  const attempts = pending.map((rule) => {
    const attempt = (state.overrideCounts[today][rule.id] || 0) + 1;
    state.overrideCounts[today][rule.id] = attempt;
    state.overrides[rule.id] = {
      day: today,
      startedAt: now,
      deadline: Math.min(nextMidnight(now), now + durationMs),
      reason: cleanReason,
      attempt,
    };
    return {
      ruleId: rule.id,
      label: rule.label,
      attempt,
      minutes: durationMinutes,
      durationMs,
    };
  });
  state.logs.unshift({
    id: crypto.randomUUID(),
    at: now,
    type: "override",
    ruleIds: pending.map((rule) => rule.id),
    labels: pending.map((rule) => rule.label),
    reason: cleanReason,
    attempts,
    minutes: durationMinutes,
    durationMs,
  });
  prune(state, now);
}

export function prune(state, now = Date.now()) {
  const cutoffDate = new Date(now);
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - 29);
  const cutoff = cutoffDate.getTime();
  const encoder = new TextEncoder();
  let bytes = 2;
  state.logs = state.logs.filter((log) => log.at >= cutoff).slice(0, 1000);
  let count = 0;
  for (const log of state.logs) {
    bytes += encoder.encode(JSON.stringify(log)).length + (count ? 1 : 0);
    if (bytes > MAX_LOG_BYTES) break;
    count++;
  }
  state.logs.length = count;
  const cutoffDay = dayKey(cutoff);
  for (const records of [
    state.days,
    state.activeDays || {},
    state.activeOvertimeDays || {},
    state.overrideCounts || {},
    state.overtimeDays || {},
  ])
    for (const key of Object.keys(records))
      if (key < cutoffDay) delete records[key];
}
