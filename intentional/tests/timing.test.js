import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRule } from "../extension/core/rules.js";
import {
  createState,
  approve,
  evaluate,
  dayKey,
} from "../extension/core/engine.js";
import { formatDuration } from "../extension/core/timing.js";
const now = new Date(2026, 10, 9, 12).getTime();
function fixture() {
  const state = createState();
  state.rules = [
    normalizeRule({
      id: "r",
      target: "example.com",
      mode: "domain",
      dailyMinutes: 10,
      intentionalVisits: true,
    }),
  ];
  return state;
}
test("daily and session inputs reject fractional and malformed durations", () => {
  for (const value of [
    1.5,
    "1.5",
    "1e1",
    "",
    true,
    [],
    Infinity,
    -1,
    0,
    1441,
  ]) {
    assert.throws(
      () =>
        normalizeRule({
          target: "example.com",
          mode: "domain",
          dailyMinutes: value,
        }),
      /whole number/,
    );
    const state = fixture();
    assert.throws(
      () => approve(state, state.rules, "Read", value, now),
      /whole number/,
    );
    assert.equal(state.logs.length, 0);
  }
});
test("remaining allowance displays seconds, but offers only whole minutes", () => {
  const state = fixture();
  state.days[dayKey(now)] = { r: 15000 };
  const result = evaluate(state, "https://example.com", now);
  assert.equal(result.timeChoice.max, 9);
  assert.equal(formatDuration(result.rules[0].remainingMs), "9m 45s");
  assert.equal(formatDuration(result.rules[0].usedMs), "15s");
  assert.throws(
    () => approve(state, state.rules, "Read", 9.75, now),
    /whole number/,
  );
  approve(state, state.rules, "Read", 9, now);
  assert.equal(state.sessions.r.deadline, now + 540000);
});
test("sub-minute remainders require explicit approval and retain precise history", () => {
  const state = fixture();
  state.days[dayKey(now)] = { r: 555000 };
  assert.equal(evaluate(state, "https://example.com", now).timeChoice.max, 0);
  assert.throws(
    () => approve(state, state.rules, "Finish", null, now),
    /remaining seconds/,
  );
  approve(state, state.rules, "Finish", null, now, true);
  assert.equal(state.sessions.r.deadline, now + 45000);
  assert.equal(state.logs[0].durationMs, 45000);
  assert.equal(state.logs[0].minutes, null);
});
