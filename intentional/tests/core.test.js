import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRule,
  matches,
  networkPattern,
  permissionOrigins,
} from "../extension/core/rules.js";
import {
  createState,
  dayKey,
  settleUsage,
  evaluate,
  approve,
  expireSessions,
  prune,
  MAX_LOG_BYTES,
} from "../extension/core/engine.js";

const rule = (overrides = {}) =>
  normalizeRule({
    id: "r1",
    target: "reddit.com/r/learnprogramming",
    mode: "prefix",
    dailyMinutes: 10,
    ...overrides,
  });

test("path prefixes respect segment boundaries and ignore queries", () => {
  const r = rule();
  assert.equal(
    matches(r, "https://www.reddit.com/r/learnprogramming/comments/123?q=1"),
    true,
  );
  assert.equal(matches(r, "https://reddit.com/r/learnprogrammingish"), false);
  assert.equal(
    matches(r, "https://reddit.com.evil.test/r/learnprogramming"),
    false,
  );
  assert.equal(
    matches(r, "https://other.test/?reddit.com/r/learnprogramming"),
    false,
  );
});

test("exact paths allow a trailing slash but exclude children and preserve case", () => {
  const r = rule({ mode: "exact" });
  assert.equal(
    matches(r, "http://reddit.com/r/learnprogramming/?sort=new"),
    true,
  );
  assert.equal(
    matches(r, "https://reddit.com/r/learnprogramming/comments"),
    false,
  );
  assert.equal(matches(r, "https://reddit.com/r/LearnProgramming"), false);
});

test("normal website formats normalize to one rule and match both protocols", () => {
  for (const target of [
    "reddit.com",
    "www.reddit.com",
    "https://www.reddit.com",
    "http://reddit.com/",
    "  HTTPS://WWW.REDDIT.COM/  ",
  ]) {
    const r = rule({ target, mode: "domain" });
    assert.equal(r.target, "reddit.com");
    assert.deepEqual(permissionOrigins(r), [
      "http://*.reddit.com/*",
      "https://*.reddit.com/*",
    ]);
    const network = new RegExp(networkPattern(r));
    for (const address of [
      "http://reddit.com/",
      "https://reddit.com/",
      "https://www.reddit.com/r/books",
      "https://old.reddit.com/",
    ]) {
      assert.equal(matches(r, address), true, `${target}: ${address}`);
      assert.equal(network.test(address), true, `${target}: ${address}`);
    }
    assert.equal(matches(r, "https://reddit.com.evil.test/"), false);
    assert.equal(network.test("https://notreddit.com/"), false);
  }
  const exactHost = rule({
    target: "https://www.reddit.com/",
    mode: "domain",
    includeSubdomains: false,
  });
  assert.equal(exactHost.host, "www.reddit.com");
  assert.equal(matches(exactHost, "https://www.reddit.com/"), true);
  assert.equal(matches(exactHost, "https://reddit.com/"), false);
});

test("domain mode includes subdomains only when selected", () => {
  const r = rule({
    target: "youtube.com",
    mode: "domain",
    includeSubdomains: false,
  });
  assert.equal(matches(r, "https://youtube.com/shorts/a"), true);
  assert.equal(matches(r, "https://m.youtube.com/shorts/a"), false);
  assert.deepEqual(permissionOrigins(r), [
    "http://youtube.com/*",
    "https://youtube.com/*",
  ]);
});

test("network and in-page matching agree across modes", () => {
  for (const mode of ["domain", "prefix", "exact"]) {
    const r = rule({ mode });
    const re = new RegExp(networkPattern(r));
    for (const url of [
      "https://reddit.com/r/learnprogramming",
      "https://www.reddit.com/r/learnprogramming/",
      "https://reddit.com/r/learnprogramming/comments/1",
      "https://reddit.com/r/learnprogrammingish",
      "https://reddit.com/r/LearnProgramming",
      "https://evil.test/?reddit.com/r/learnprogramming",
      "http://old.reddit.com:8080/r/learnprogramming?q=2",
    ]) {
      assert.equal(re.test(url), matches(r, url), `${mode}: ${url}`);
    }
  }
});

test("invalid targets and limits are rejected", () => {
  for (const target of [
    "chrome://settings",
    "https://user:pass@reddit.com",
    "reddit.com?token=abc",
    "reddit.com/#section",
    "*.reddit.com",
    "https://reddit.com:9000/r/test",
  ]) {
    assert.throws(() => rule({ target }));
  }
  for (const dailyMinutes of [0, -1, 1441, NaN])
    assert.throws(() => rule({ dailyMinutes }));
  assert.throws(() => rule({ mode: "regex" }));
});

test("focused usage charges all overlapping rules once and stops at a limit", () => {
  const now = new Date(2026, 9, 5, 12).getTime();
  const s = createState();
  s.rules = [
    rule({ dailyMinutes: 1 }),
    rule({ id: "r2", target: "reddit.com", mode: "domain" }),
  ];
  const cursor = { at: now - 5000, ids: ["r1", "r2"] };
  settleUsage(s, cursor, now);
  assert.equal(s.days[dayKey(now)].r1, 5000);
  assert.equal(s.days[dayKey(now)].r2, 5000);
  s.days[dayKey(now)].r1 = 59000;
  settleUsage(s, { at: now, ids: ["r1", "r2"] }, now + 5000);
  assert.equal(s.days[dayKey(now)].r1, 60000);
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now + 5000).kind,
    "blocked",
  );
});

test("sleep gaps are bounded and midnight splits usage into local days", () => {
  const midnight = new Date(2026, 9, 6).getTime();
  const s = createState();
  s.rules = [rule()];
  settleUsage(s, { at: midnight - 3000, ids: ["r1"] }, midnight + 2000);
  assert.equal(s.days[dayKey(midnight - 1)].r1, 3000);
  assert.equal(s.days[dayKey(midnight)].r1, 2000);
  settleUsage(s, { at: midnight, ids: ["r1"] }, midnight + 3600000);
  assert.equal(s.days[dayKey(midnight)].r1, 12000);
});

test("intention cannot be approved without a reason or requested duration", () => {
  const s = createState();
  s.rules = [rule({ requireReason: true, requireSession: true })];
  const now = Date.now();
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now).kind,
    "prompt",
  );
  assert.throws(() => approve(s, s.rules, "", 5, now));
  assert.throws(() => approve(s, s.rules, "Learn recursion", 0, now));
  approve(s, s.rules, "Learn recursion", 5, now);
  assert.equal(s.logs[0].reason, "Learn recursion");
  assert.equal(s.sessions.r1.deadline, now + 300000);
});

test("a running session cannot be extended and expiry allows an intentional renewal", () => {
  const s = createState();
  s.rules = [rule({ requireSession: true })];
  const now = Date.now();
  approve(s, s.rules, "", 2, now);
  approve(s, s.rules, "", 30, now + 1000);
  assert.equal(s.sessions.r1.deadline, now + 120000);
  expireSessions(s, now + 120000);
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now + 120000).kind,
    "prompt",
  );
  approve(s, s.rules, "Again", 5, now + 120000);
  assert.equal(s.sessions.r1.deadline, now + 420000);
});

test("locks reset next day while same-day session survives restart", () => {
  const now = new Date(2026, 9, 5, 23, 50).getTime();
  const s = createState();
  s.rules = [rule({ requireSession: true })];
  approve(s, s.rules, "", 1, now);
  const restored = JSON.parse(JSON.stringify(s));
  expireSessions(restored, now + 60000);
  assert.equal(
    evaluate(restored, "https://reddit.com/r/learnprogramming", now + 60000)
      .kind,
    "prompt",
  );
  const tomorrow = new Date(2026, 9, 6, 1).getTime();
  expireSessions(restored, tomorrow);
  assert.equal(
    evaluate(restored, "https://reddit.com/r/learnprogramming", tomorrow).kind,
    "prompt",
  );
});

test("unmonitored pages are ignored and approved rules reveal remaining time", () => {
  const s = createState();
  s.rules = [rule({ requireReason: true })];
  const now = Date.now();
  assert.equal(evaluate(s, "https://example.com", now).kind, "none");
  approve(s, s.rules, "Learn recursion", 5, now);
  const result = evaluate(s, "https://reddit.com/r/learnprogramming", now);
  assert.equal(result.kind, "allowed");
  assert.equal(result.rules[0].remainingMs, 600000);
});

test("logs have bounded retention", () => {
  const s = createState();
  const now = Date.now();
  s.logs = [{ at: now - 31 * 86400000 }, { at: now }];
  prune(s, now);
  assert.equal(s.logs.length, 1);
});

test("approved intention survives new documents and tabs until its session ends", () => {
  const s = createState();
  s.rules = [rule({ requireReason: true, requireSession: true })];
  const now = new Date(2026, 9, 5, 12).getTime();
  approve(s, s.rules, "Learn recursion", 5, now);
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(
    evaluate(
      restored,
      "https://reddit.com/r/learnprogramming/comments/1",
      now + 1000,
    ).kind,
    "allowed",
  );
  assert.equal(
    evaluate(restored, "https://reddit.com/r/learnprogramming", now + 300000)
      .kind,
    "prompt",
  );
});

test("reason sessions default to fifteen minutes and do not cover another rule", () => {
  const s = createState();
  s.rules = [
    rule({ requireReason: true, dailyMinutes: 20 }),
    rule({
      id: "r2",
      target: "youtube.com",
      mode: "domain",
      requireReason: true,
    }),
  ];
  const now = new Date(2026, 9, 5, 12).getTime();
  approve(s, [s.rules[0]], "Learn recursion", null, now);
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now + 899999).kind,
    "allowed",
  );
  assert.equal(evaluate(s, "https://youtube.com", now + 1000).kind, "prompt");
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now + 900000).kind,
    "prompt",
  );
});

test("session duration cannot exceed remaining daily time in any overlapping rule", () => {
  const now = new Date(2026, 9, 5, 12).getTime();
  const s = createState();
  s.rules = [
    rule({ requireReason: true, requireSession: true }),
    rule({
      id: "r2",
      target: "reddit.com",
      mode: "domain",
      dailyMinutes: 3,
      requireSession: true,
    }),
  ];
  s.days[dayKey(now)] = { r2: 60000 };
  assert.throws(
    () => approve(s, s.rules, "Learn recursion", 3, now),
    /whole number/,
  );
  assert.equal(s.logs.length, 0);
  assert.deepEqual(s.sessions, {});
  approve(s, s.rules, "Learn recursion", 2, now);
  assert.equal(s.sessions.r1.deadline, now + 120000);
  assert.equal(s.sessions.r2.deadline, now + 120000);
  assert.equal(s.sessions.r1.reason, "Learn recursion");
});

test("daily exhaustion still blocks session renewal", () => {
  const now = new Date(2026, 9, 5, 12).getTime();
  const s = createState();
  s.rules = [rule({ requireReason: true, requireSession: true })];
  s.days[dayKey(now)] = { r1: 600000 };
  assert.equal(
    evaluate(s, "https://reddit.com/r/learnprogramming", now).kind,
    "blocked",
  );
  assert.throws(() => approve(s, s.rules, "One more", 1, now));
});

test("limit names are capped at 32 characters, including generated names", () => {
  const long = rule({ label: "n".repeat(80) });
  assert.equal(long.label, "n".repeat(32));
  assert.equal(rule({ label: "n".repeat(32) }).label, "n".repeat(32));
  const generated = rule({
    target: "example.com/a-very-long-path-that-stays-in-the-target",
    label: "",
  });
  assert.ok(generated.label.length <= 32);
  assert.equal(
    generated.target,
    "example.com/a-very-long-path-that-stays-in-the-target",
  );
});

test("history is limited by bytes and by 30 local calendar dates", () => {
  const state = createState();
  const now = new Date(2026, 10, 9, 12).getTime();
  state.logs = Array.from({ length: 1000 }, (_, id) => ({
    id,
    at: now,
    reason: "界".repeat(500),
    labels: Array(100).fill("x".repeat(32)),
  }));
  state.days = { "2026-10-10": { r1: 5 }, "2026-10-11": { r1: 5 } };
  prune(state, now);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(state.logs)).length <=
      MAX_LOG_BYTES,
  );
  assert.ok(state.logs.length > 0 && state.logs.length < 1000);
  assert.equal(state.logs[0].id, 0);
  assert.equal(state.days["2026-10-10"], undefined);
  assert.ok(state.days["2026-10-11"]);
});

test("a session crossing midnight stops billing before the new intention prompt", () => {
  const midnight = new Date(2026, 10, 10).getTime();
  const state = createState();
  state.rules = [rule({ requireReason: true })];
  approve(state, state.rules, "Read", null, midnight - 5000, true);
  settleUsage(state, { ids: ["r1"], at: midnight - 1000 }, midnight + 3000);
  assert.equal(state.days[dayKey(midnight - 1)].r1, 1000);
  assert.equal(state.days[dayKey(midnight)].r1, 0);
});
