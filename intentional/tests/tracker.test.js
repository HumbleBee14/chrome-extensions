import test from "node:test";
import assert from "node:assert/strict";
import { createState, dayKey, approve } from "../extension/core/engine.js";
import { normalizeRule } from "../extension/core/rules.js";
import { tick } from "../extension/background/tracker.js";

function fixture() {
  const state = createState();
  state.rules = [
    normalizeRule({
      id: "r1",
      target: "example.com/focus",
      mode: "prefix",
      dailyMinutes: 20,
    }),
  ];
  const runtime = { cursor: null, denied: [] };
  const browser = {
    focused: true,
    idle: "active",
    tabId: 1,
    url: "https://example.com/focus",
  };
  globalThis.chrome = {
    windows: {
      getLastFocused: async () => ({ id: 1, focused: browser.focused }),
    },
    idle: { queryState: async () => browser.idle },
    tabs: { query: async () => [{ id: browser.tabId, url: browser.url }] },
  };
  return { state, runtime, browser };
}

test("usage pauses when browser loses focus and resumes without charging the gap", async () => {
  const { state, runtime, browser } = fixture();
  const now = Date.now();
  await tick(state, runtime, now);
  browser.focused = false;
  await tick(state, runtime, now + 2000);
  assert.equal(runtime.cursor, null);
  await tick(state, runtime, now + 7000);
  browser.focused = true;
  await tick(state, runtime, now + 8000);
  await tick(state, runtime, now + 10000);
  assert.equal(state.days[dayKey(now)].r1, 4000);
});

test("reading without input still counts, but a locked screen stops tracking", async () => {
  const { state, runtime, browser } = fixture();
  const now = Date.now();
  browser.idle = "idle";
  await tick(state, runtime, now);
  await tick(state, runtime, now + 3000);
  assert.equal(state.days[dayKey(now)].r1, 3000);
  browser.idle = "locked";
  await tick(state, runtime, now + 4000);
  await tick(state, runtime, now + 9000);
  assert.equal(state.days[dayKey(now)].r1, 4000);
});

test("multiple tabs do not double count and worker rehydration preserves the cursor", async () => {
  const { state, runtime, browser } = fixture();
  const now = Date.now();
  await tick(state, runtime, now);
  browser.tabId = 2;
  await tick(state, runtime, now + 3000);
  const rehydrated = JSON.parse(JSON.stringify(runtime));
  await tick(state, rehydrated, now + 5000);
  assert.equal(state.days[dayKey(now)].r1, 5000);
  assert.equal(rehydrated.cursor.tabId, 2);
});

test("usage never accrues while an intention gate is waiting", async () => {
  const { state, runtime } = fixture();
  state.rules[0].requireReason = true;
  const now = Date.now();
  await tick(state, runtime, now);
  await tick(state, runtime, now + 5000);
  assert.equal(state.days[dayKey(now)], undefined);
  approve(state, state.rules, "Read with purpose", 5, now + 6000);
  await tick(state, runtime, now + 6000);
  await tick(state, runtime, now + 8000);
  assert.equal(state.days[dayKey(now)].r1, 2000);
});

test("returning during an approved session resumes usage without another prompt", async () => {
  const { state, runtime, browser } = fixture();
  state.rules[0].requireReason = true;
  const now = Date.now();
  approve(state, state.rules, "Read with purpose", 5, now);
  await tick(state, runtime, now);
  browser.url = "https://example.com/home";
  await tick(state, runtime, now + 1000);
  assert.equal(runtime.cursor, null);
  browser.url = "https://example.com/focus/child";
  await tick(state, runtime, now + 2000);
  assert.deepEqual(runtime.cursor.ids, ["r1"]);
  await tick(state, runtime, now + 300001);
  assert.equal(runtime.cursor, null);
});

test("closing a tab settles the final interval into the same daily counter read after rehydration", async () => {
  const { state, runtime, browser } = fixture();
  const now = new Date(2026, 10, 9, 12).getTime();
  await tick(state, runtime, now);
  for (let seconds = 5; seconds <= 50; seconds += 5)
    await tick(state, runtime, now + seconds * 1000);
  browser.url = undefined;
  await tick(state, runtime, now + 55000);
  assert.equal(state.days[dayKey(now)].r1, 55000);
  assert.equal(runtime.cursor, null);
  const restored = JSON.parse(JSON.stringify(state));
  await tick(restored, JSON.parse(JSON.stringify(runtime)), now + 65000);
  assert.equal(restored.days[dayKey(now)].r1, 55000);
});
