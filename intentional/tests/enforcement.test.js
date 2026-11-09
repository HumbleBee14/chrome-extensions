import test from "node:test";
import assert from "node:assert/strict";
import { schedule } from "../extension/background/enforcement.js";
import { createState, nextMidnight } from "../extension/core/engine.js";

test("expired sessions do not schedule an alarm loop while waiting for reflection", async () => {
  const now = new Date(2026, 9, 5, 12).getTime();
  const state = createState();
  state.sessions.r1 = { deadline: now - 1 };
  let boundary;
  globalThis.chrome = {
    alarms: {
      create: async (name, alarm) => {
        if (name === "boundary") boundary = alarm.when;
      },
      get: async () => ({ name: "reconcile" }),
    },
  };
  await schedule(state, null, now);
  assert.equal(boundary, nextMidnight(now));
});

test("network redirects apply only to exhausted rules that prevent overrides", async () => {
  const { syncBlocks } = await import("../extension/background/enforcement.js");
  const { normalizeRule } = await import("../extension/core/rules.js");
  const { dayKey } = await import("../extension/core/engine.js");
  const now = new Date(2026, 10, 8, 12).getTime();
  const state = createState();
  state.rules = [false, true].map((preventOverrides, index) =>
    normalizeRule({
      id: `r${index}`,
      target: `example.com/${index}`,
      mode: "prefix",
      dailyMinutes: 1,
      preventOverrides,
    }),
  );
  state.days[dayKey(now)] = { r0: 60000, r1: 60000 };
  let update;
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async (rules) => {
        update = rules;
      },
    },
  };
  await syncBlocks(state, { denied: [] }, now);
  assert.equal(update.addRules.length, 1);
  assert.ok(update.addRules[0].action.redirect.url.endsWith("rule=r1"));
});

test("open-tab injection is limited to enabled granted hosts, including paths outside a monitored SPA route", async () => {
  const { injectOpenTabs } =
    await import("../extension/background/enforcement.js");
  const { normalizeRule } = await import("../extension/core/rules.js");
  const state = createState();
  state.rules = [
    normalizeRule({
      id: "allowed",
      target: "example.com/read",
      mode: "prefix",
      dailyMinutes: 10,
    }),
    normalizeRule({
      id: "denied",
      target: "denied.com",
      mode: "domain",
      dailyMinutes: 10,
    }),
    normalizeRule({
      id: "disabled",
      target: "disabled.com",
      mode: "domain",
      dailyMinutes: 10,
      enabled: false,
    }),
  ];
  const injected = [];
  globalThis.chrome = {
    tabs: {
      query: async () => [
        { id: 1, url: "https://example.com/other" },
        { id: 2, url: "https://www.example.com/read" },
        { id: 3, url: "https://unrelated.com" },
        { id: 4, url: "https://denied.com" },
        { id: 5, url: "https://disabled.com" },
        { id: 6, url: "chrome://extensions" },
        { id: 7 },
      ],
    },
    scripting: {
      executeScript: async ({ target }) => injected.push(target.tabId),
    },
  };
  await injectOpenTabs(state, { denied: ["denied"] });
  assert.deepEqual(injected, [1, 2]);
});
