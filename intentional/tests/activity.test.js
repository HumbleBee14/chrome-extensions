import test from "node:test";
import assert from "node:assert/strict";
import {
  activitySummary,
  activityTime,
  periodDays,
  shiftDay,
} from "../extension/core/activity.js";
import {
  createState,
  dayKey,
  settleUsage,
  prune,
} from "../extension/core/engine.js";
import { normalizeRule } from "../extension/core/rules.js";

const at = (day, hour = 12) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).getTime();
test("daily and weekly metrics follow local dates, including year boundaries", () => {
  assert.deepEqual(periodDays("2026-11-08", "week"), [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
  assert.equal(periodDays("2027-01-01", "week")[0], "2026-12-28");
  assert.equal(shiftDay("2026-03-08", 1), "2026-03-09");
  const state = {
    today: "2026-11-08",
    activitySince: at("2026-11-01", 0),
    activeDays: { "2026-11-07": 600000, "2026-11-08": 300000 },
    activeOvertimeDays: { "2026-11-07": 120000 },
    overrideCounts: { "2026-11-07": { one: 2 } },
    logs: [
      { at: at("2026-11-07"), reason: "Work" },
      { at: at("2026-11-07"), type: "override" },
      { at: at("2026-11-08"), reason: "Read" },
    ],
  };
  const yesterday = activitySummary(state, ["2026-11-07"]);
  assert.equal(yesterday.sessions, 1);
  assert.equal(yesterday.overrides, 2);
  assert.equal(yesterday.activeMs, 600000);
  assert.equal(yesterday.overtimeMs, 120000);
  const week = activitySummary(state, periodDays(state.today, "week"));
  assert.equal(week.sessions, 2);
  assert.equal(week.activeMs, 900000);
  assert.equal(week.partial, false);
  state.logs = [];
  assert.equal(activitySummary(state, ["2026-11-07"]).overrides, 2);
  assert.equal(activitySummary(state, ["2026-11-07"]).activeMs, 600000);
});

test("older active time stays unknown and migration-day totals are marked partial", () => {
  const state = {
    today: "2026-11-08",
    activitySince: at("2026-11-08"),
    logs: [],
  };
  assert.equal(activitySummary(state, ["2026-11-07"]).activeMs, null);
  assert.equal(activitySummary(state, ["2026-11-08"]).partial, true);
  assert.equal(activityTime(null), "—");
  assert.equal(activityTime(1000), "<1m");
  assert.equal(activityTime(900000), "15m");
});

test("active and overtime totals count overlapping limits once and prune after retention", () => {
  const state = createState();
  const now = at("2026-11-08");
  state.rules = ["a", "b"].map((id) =>
    normalizeRule({
      id,
      target: "example.com",
      mode: "domain",
      dailyMinutes: 10,
    }),
  );
  settleUsage(state, { ids: ["a", "b"], at: now }, now + 5000);
  assert.equal(state.activeDays[dayKey(now)], 5000);
  state.days[dayKey(now)] = { a: 600000, b: 600000 };
  state.overrides = Object.fromEntries(
    ["a", "b"].map((id) => [
      id,
      { day: dayKey(now), startedAt: now + 5000, deadline: now + 8000 },
    ]),
  );
  settleUsage(state, { ids: ["a", "b"], at: now + 5000 }, now + 10000);
  assert.equal(state.activeDays[dayKey(now)], 8000);
  assert.equal(state.activeOvertimeDays[dayKey(now)], 3000);
  state.activeDays["2026-09-01"] = 1000;
  state.activeOvertimeDays["2026-09-01"] = 1000;
  prune(state, now);
  assert.equal(state.activeDays["2026-09-01"], undefined);
  assert.equal(state.activeOvertimeDays["2026-09-01"], undefined);
});

test("active totals split at local midnight and ignore locked or disabled rules", () => {
  const state = createState();
  state.rules = [
    normalizeRule({
      id: "a",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 10,
    }),
  ];
  const midnight = at("2026-11-09", 0);
  settleUsage(state, { ids: ["a"], at: midnight - 2000 }, midnight + 2000);
  assert.equal(state.activeDays["2026-11-08"], 2000);
  assert.equal(state.activeDays["2026-11-09"], 2000);
  state.locks.a = { day: "2026-11-09" };
  settleUsage(state, { ids: ["a"], at: midnight + 2000 }, midnight + 4000);
  assert.equal(state.activeDays["2026-11-09"], 2000);
});

test("active totals stop at the first session or daily boundary across overlapping limits", () => {
  const state = createState();
  const now = at("2026-11-08");
  state.rules = ["a", "b"].map((id) =>
    normalizeRule({
      id,
      mode: "domain",
      target: "example.com",
      dailyMinutes: 10,
    }),
  );
  state.rules[0].requireSession = true;
  state.sessions.a = { day: dayKey(now), deadline: now + 2000 };
  settleUsage(state, { ids: ["a", "b"], at: now }, now + 5000);
  assert.equal(state.activeDays[dayKey(now)], 2000);
  assert.equal(state.days[dayKey(now)].a, 2000);
  assert.equal(state.days[dayKey(now)].b, 2000);
  delete state.sessions.a;
  state.rules[0].requireSession = false;
  state.days[dayKey(now)].a = 599000;
  settleUsage(state, { ids: ["a", "b"], at: now + 5000 }, now + 10000);
  assert.equal(state.activeDays[dayKey(now)], 3000);
  assert.equal(state.days[dayKey(now)].b, 3000);
});
