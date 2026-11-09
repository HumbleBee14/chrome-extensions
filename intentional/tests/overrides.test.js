import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../extension/core/engine.js";
import { normalizeRule } from "../extension/core/rules.js";

const now = new Date(2026, 10, 8, 12).getTime();
const url = "https://example.com/focus/child";
function fixture(input = {}) {
  const state = engine.createState();
  state.rules = [
    normalizeRule({
      id: "r1",
      target: "example.com/focus",
      mode: "prefix",
      dailyMinutes: 1,
      ...input,
    }),
  ];
  state.days[engine.dayKey(now)] = { r1: 60000 };
  return state;
}

test("over-limit continuation requires a reason and expires after the selected duration", () => {
  const state = fixture();
  assert.equal(engine.evaluate(state, url, now).canOverride, true);
  assert.throws(
    () => engine.approveOverride(state, state.rules, "", now),
    /reason/,
  );
  assert.equal(state.logs.length, 0);
  engine.approveOverride(state, state.rules, "Finish the article", now);
  assert.equal(engine.evaluate(state, url, now + 59999).kind, "allowed");
  assert.equal(engine.evaluate(state, url, now + 60000).kind, "blocked");
  assert.equal(state.logs[0].type, "override");
  assert.equal(state.logs[0].attempts[0].attempt, 1);
});

test("refresh and restart share an override without extending it or counting another attempt", () => {
  const state = fixture({ overrideMinutes: 1 });
  engine.approveOverride(state, state.rules, "Finish reading", now);
  const restored = JSON.parse(JSON.stringify(state));
  engine.approveOverride(restored, restored.rules, "Another tab", now + 1000);
  assert.equal(restored.overrides.r1.deadline, now + 60000);
  assert.equal(restored.logs.length, 1);
  assert.equal(engine.evaluate(restored, url, now + 60000).kind, "blocked");
  restored.logs = [];
  engine.approveOverride(
    restored,
    restored.rules,
    "Read the conclusion",
    now + 60000,
  );
  assert.equal(restored.logs[0].attempts[0].attempt, 2);
  assert.equal(restored.overrideCounts[engine.dayKey(now)].r1, 2);
});

test("prevent overrides wins across overlapping rules and rejects changes atomically", () => {
  const state = fixture();
  state.rules.push(
    normalizeRule({
      id: "r2",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 1,
      preventOverrides: true,
    }),
  );
  state.days[engine.dayKey(now)].r2 = 60000;
  assert.equal(engine.evaluate(state, url, now).canOverride, false);
  assert.throws(
    () => engine.approveOverride(state, state.rules, "Keep reading", now),
    /overrides/,
  );
  assert.deepEqual(state.overrides, {});
  assert.equal(state.logs.length, 0);
});

test("overlapping override attempts are numbered independently per rule", () => {
  const state = fixture();
  state.rules.push(
    normalizeRule({
      id: "r2",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 1,
      overrideMinutes: 2,
    }),
  );
  state.days[engine.dayKey(now)].r2 = 60000;
  engine.approveOverride(state, state.rules, "Finish reading", now);
  assert.deepEqual(
    state.logs[0].attempts.map((item) => [item.ruleId, item.attempt]),
    [
      ["r1", 1],
      ["r2", 1],
    ],
  );
  engine.approveOverride(
    state,
    state.rules,
    "Continue the article",
    now + 120000,
  );
  assert.equal(state.overrides.r1.deadline, now + 180000);
  assert.equal(state.overrides.r2.deadline, now + 180000);
  assert.deepEqual(
    state.logs[0].attempts.map((item) => [item.ruleId, item.attempt]),
    [
      ["r1", 2],
      ["r2", 2],
    ],
  );
});

test("actual over-limit usage is tracked separately and stops at the override deadline", () => {
  const state = fixture({ overrideMinutes: 1 });
  engine.approveOverride(state, state.rules, "Finish reading", now);
  engine.settleUsage(state, { at: now + 58000, ids: ["r1"] }, now + 65000);
  assert.equal(state.days[engine.dayKey(now)].r1, 60000);
  assert.equal(state.overtimeDays[engine.dayKey(now)].r1, 2000);
});

test("midnight resets overrides and attempt numbers, with old counters pruned", () => {
  const state = fixture();
  const late = new Date(2026, 10, 8, 23, 59).getTime();
  engine.approveOverride(state, state.rules, "Finish reading", late);
  assert.equal(state.overrides.r1.deadline, engine.nextMidnight(late));
  const tomorrow = engine.nextMidnight(late);
  engine.expireSessions(state, tomorrow);
  assert.equal(state.overrides.r1, undefined);
  state.days[engine.dayKey(tomorrow)] = { r1: 60000 };
  engine.approveOverride(state, state.rules, "Read another article", tomorrow);
  assert.equal(state.logs[0].attempts[0].attempt, 1);
  engine.prune(state, tomorrow + 32 * 86400000);
  assert.deepEqual(state.overrideCounts, {});
  assert.deepEqual(state.overtimeDays, {});
});

test("each override uses a chosen whole duration capped by the daily limit, ignoring legacy intervals", () => {
  for (const invalid of [0, 11, 1.5, NaN, Infinity, "1e1", true]) {
    const state = fixture({ dailyMinutes: 10, overrideMinutes: 40 });
    state.days[engine.dayKey(now)].r1 = 600000;
    assert.throws(
      () =>
        engine.approveOverride(state, state.rules, "Quick check", now, invalid),
      /whole number/,
    );
    assert.deepEqual(state.overrides, {});
    assert.equal(state.logs.length, 0);
  }
  const state = fixture({ dailyMinutes: 10, overrideMinutes: 40 });
  state.days[engine.dayKey(now)].r1 = 600000;
  engine.approveOverride(state, state.rules, "Quick check", now, 3);
  assert.equal(state.overrides.r1.deadline, now + 180000);
  engine.approveOverride(state, state.rules, "Finish up", now + 180000, 10);
  assert.equal(state.logs[0].attempts[0].attempt, 2);
  assert.equal(state.logs[0].minutes, 10);
  assert.equal(state.days[engine.dayKey(now)].r1, 600000);
});

test("an active override does not prevent a normal intention for an overlapping rule", () => {
  const state = fixture();
  engine.approveOverride(state, state.rules, "Finish reading", now);
  state.rules.push(
    normalizeRule({
      id: "r2",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 10,
      requireReason: true,
    }),
  );
  engine.approve(
    state,
    state.rules,
    "Read a related page",
    null,
    now + 1000,
    true,
  );
  assert.equal(state.sessions.r2.deadline, now + 60000);
  assert.equal(state.overrides.r1.deadline, now + 60000);
});
