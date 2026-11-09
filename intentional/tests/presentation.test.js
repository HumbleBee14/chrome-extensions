import test from "node:test";
import assert from "node:assert/strict";
import * as presentation from "../extension/ui/shared.js";
import { limitLabel } from "../extension/ui/shared.js";

test("status wording distinguishes a reached limit, a prevented override, and active extra time", () => {
  assert.equal(
    limitLabel({ locked: true, preventOverrides: false }),
    "Limit reached",
  );
  assert.equal(
    limitLabel({ locked: true, preventOverrides: true }),
    "Blocked until midnight",
  );
  assert.equal(limitLabel({ overrideActive: true }), "Extra time active");
  assert.equal(limitLabel({ enabled: false }), "Paused");
  assert.equal(limitLabel({ hasAccess: false }), "Access needed");
});

test("popup prioritizes active boundaries over disabled overlapping limits", () => {
  const paused = {
    id: "paused",
    enabled: false,
    locked: true,
    preventOverrides: true,
  };
  const active = { id: "active", enabled: true };
  const blocked = {
    id: "blocked",
    enabled: true,
    locked: true,
    preventOverrides: true,
  };
  assert.equal(presentation.primaryLimit([paused, active]), active);
  assert.equal(presentation.primaryLimit([paused, active, blocked]), blocked);
  assert.equal(presentation.primaryLimit([paused]), paused);
});

test("popup presents one clear timer for sessions, daily limits, extra time, and overlapping boundaries", async () => {
  const { popupClock, dailySummary } =
    await import("../extension/ui/popup-view.js");
  const rule = {
    enabled: true,
    hasAccess: true,
    usedMs: 11200,
    dailyMinutes: 2,
    remainingMs: 108800,
    sessionRemainingMs: 48000,
  };
  assert.equal(dailySummary(rule), "11 sec used · 2 min limit");
  assert.deepEqual(popupClock([rule]), {
    label: "This visit",
    value: "48 sec left",
  });
  assert.deepEqual(popupClock([{ ...rule, sessionRemainingMs: null }]), {
    label: "Daily allowance",
    value: "1 min 49 sec left",
  });
  assert.deepEqual(popupClock([{ ...rule, remainingMs: 10000 }]), {
    label: "This visit",
    value: "10 sec left",
  });
  const extra = {
    ...rule,
    usedMs: 120000,
    remainingMs: 0,
    overrideActive: true,
    overtimeMs: 61000,
  };
  assert.equal(dailySummary(extra), "3 min 1 sec used · 2 min limit");
  assert.deepEqual(popupClock([extra]), {
    label: "Extra time",
    value: "48 sec left",
  });
  assert.deepEqual(popupClock([extra, { ...rule, remainingMs: 5000 }]), {
    label: "This visit",
    value: "5 sec left",
  });
  for (const flags of [{ enabled: false }, { hasAccess: false }]) {
    assert.deepEqual(
      popupClock([rule, { ...extra, ...flags, locked: true }]),
      popupClock([rule]),
    );
  }
  assert.equal(popupClock([{ ...rule, enabled: false }]).value, "Paused");
  assert.equal(
    popupClock([{ ...rule, hasAccess: false }]).value,
    "Access needed",
  );
  assert.equal(
    popupClock([{ ...rule, locked: true }]).value,
    "Daily limit reached",
  );
  assert.equal(
    popupClock([{ ...rule, needsIntention: true, sessionRemainingMs: null }])
      .value,
    "Waiting to start",
  );
  assert.equal(
    popupClock([
      {
        ...rule,
        needsIntention: true,
        sessionExpired: true,
        sessionRemainingMs: 0,
      },
    ]).value,
    "Time to check in",
  );
});
