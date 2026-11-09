import test from "node:test";
import assert from "node:assert/strict";
import * as warnings from "../extension/core/warnings.js";

const fixture = (remaining) => {
  const now = 1000000;
  const rule = {
    id: "r1",
    dailyMinutes: 10,
    remainingMs: remaining,
    sessionRemainingMs: remaining,
    sessionDeadline: now + remaining,
  };
  rule.warningKeys = warnings.warningKeys(rule, "2026-11-09");
  return { now, rule };
};
test("the one 30-second reminder stays dismissed across reloads until its timer ends", () => {
  const { now, rule } = fixture(30000);
  assert.equal(typeof rule.warningKeys.session, "string");
  const runtime = {};
  warnings.dismissWarning(runtime, rule, "session", now, now + 86400000);
  const restored = JSON.parse(JSON.stringify(runtime));
  assert.deepEqual(warnings.dismissedKeys(restored, now + 21000), [
    rule.warningKeys.session,
  ]);
  assert.deepEqual(warnings.dismissedKeys(restored, now + 30000), []);
});
test("a renewed timer or changed daily limit gets a fresh 30-second reminder", () => {
  const first = { id: "r1", dailyMinutes: 10, sessionDeadline: 2000000 };
  const old = warnings.warningKeys(first, "2026-11-09");
  const renewed = warnings.warningKeys(
    { ...first, sessionDeadline: 3000000, dailyMinutes: 20 },
    "2026-11-09",
  );
  assert.notEqual(old.session, renewed.session);
  assert.notEqual(old.daily, renewed.daily);
});
test("reminders cannot be dismissed before the final 30 seconds or for an absent timer", () => {
  const { now, rule } = fixture(30001);
  assert.throws(() =>
    warnings.dismissWarning({}, rule, "daily", now, now + 86400000),
  );
  assert.throws(() =>
    warnings.dismissWarning({}, rule, "session", now, now + 86400000),
  );
  rule.sessionRemainingMs = null;
  assert.throws(() =>
    warnings.dismissWarning({}, rule, "session", now, now + 86400000),
  );
});
