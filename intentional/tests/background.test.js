import test from "node:test";
import assert from "node:assert/strict";
import { createState, dayKey, ruleStatus } from "../extension/core/engine.js";

import { normalizeRule } from "../extension/core/rules.js";

let savedState = createState();
let savedRuntime = { cursor: null, denied: [] };
let receive;
let storageFailure = false;
let frameMissing = false;
let urlHidden = false;
let rejectNewTab = false;
let navigations = [];
const event = () => ({ addListener() {} });
globalThis.chrome = {
  runtime: {
    id: "test-extension",
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    onMessage: {
      addListener: (listener) => {
        receive = listener;
      },
    },
    onInstalled: event(),
    onStartup: event(),
  },
  storage: {
    local: {
      get: async () => {
        if (storageFailure) throw new Error("Storage unavailable");
        return { state: structuredClone(savedState) };
      },
      set: async ({ state }) => {
        savedState = structuredClone(state);
      },
    },
    session: {
      get: async () => ({ runtime: structuredClone(savedRuntime) }),
      set: async ({ runtime }) => {
        savedRuntime = structuredClone(runtime);
      },
    },
  },
  windows: {
    getLastFocused: async () => ({ focused: false }),
    onFocusChanged: event(),
  },
  idle: { queryState: async () => "active", onStateChanged: event() },
  tabs: {
    onActivated: event(),
    onUpdated: event(),
    onRemoved: event(),
    get: async () => ({
      id: 1,
      ...(urlHidden ? {} : { url: "https://example.com/read/child" }),
    }),
    query: async () => [],
    update: async (id, { url }) => {
      navigations.push({ id, url });
      if (rejectNewTab && url === "chrome://newtab/")
        throw new Error("Unavailable");
    },
  },
  webNavigation: {
    getFrame: async () => {
      if (frameMissing) throw new Error("No frame with id 0");
      return { documentId: "current-document" };
    },
    onHistoryStateUpdated: event(),
    onReferenceFragmentUpdated: event(),
  },
  permissions: { onAdded: event(), onRemoved: event() },
  alarms: {
    onAlarm: event(),
    create: async () => {},
    get: async () => ({ name: "reconcile" }),
  },
  declarativeNetRequest: { getDynamicRules: async () => [] },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async () => {},
  },
};
await import("../extension/background/index.js");
const request = (message, sender) =>
  new Promise((resolve) => receive(message, sender, resolve));

test("navigation races reject stale documents quietly, while unexpected failures remain visible", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const stale = await request(
      { type: "HEARTBEAT" },
      {
        id: "test-extension",
        tab: { id: 1 },
        frameId: 0,
        url: "https://example.com/old",
        documentId: "old-document",
      },
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "STALE_DOCUMENT");
    assert.deepEqual(errors, []);
    const oldSender = {
      id: "test-extension",
      tab: { id: 1 },
      frameId: 0,
      url: "https://example.com/old",
      documentId: "old-document",
    };
    const approval = await request(
      { type: "APPROVE", reason: "Old page", minutes: 5 },
      oldSender,
    );
    assert.equal(approval.ok, false);
    assert.equal(approval.code, "STALE_DOCUMENT");
    frameMissing = true;
    const removed = await request({ type: "HEARTBEAT" }, oldSender);
    assert.equal(removed.ok, false);
    assert.equal(removed.code, "STALE_DOCUMENT");
    assert.deepEqual(errors, []);
    frameMissing = false;
    const invalid = await request(
      { type: "VISIT" },
      { tab: { id: 1 }, frameId: 0, url: "about:blank" },
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "INVALID_PAGE");
    assert.deepEqual(errors, []);
    storageFailure = true;
    const failed = await request({ type: "HEARTBEAT" }, {});
    assert.equal(failed.ok, false);
    assert.equal(failed.error, "Storage unavailable");
    assert.equal(errors.length, 1);
  } finally {
    storageFailure = false;
    frameMissing = false;
    console.error = originalError;
  }
});

test("a dismissal can finish during navigation but cannot dismiss a renewed timer", async () => {
  const now = Date.now();
  savedState = createState();
  savedRuntime = { cursor: null, denied: [] };
  savedState.rules = [
    normalizeRule({
      id: "r1",
      target: "example.com/read",
      mode: "prefix",
      dailyMinutes: 20,
      intentionalVisits: true,
    }),
  ];
  savedState.sessions.r1 = {
    day: dayKey(now),
    deadline: now + 20000,
    startedAt: now,
    reason: "Read",
  };
  const key = ruleStatus(savedState, savedState.rules[0], now).warningKeys
    .session;
  const sender = {
    id: "test-extension",
    tab: { id: 1 },
    frameId: 0,
    url: "https://example.com/read",
    documentId: "old-document",
  };
  const message = {
    type: "DISMISS_WARNING",
    ruleId: "r1",
    clock: "session",
    warningKey: key,
  };
  const dismissed = await request(message, sender);
  assert.equal(dismissed.ok, true);
  assert.equal(savedRuntime.dismissedWarnings[key], now + 20000);
  assert.equal(savedState.logs.length, 0);
  assert.equal(savedState.sessions.r1.deadline, now + 20000);
  savedState.sessions.r1.deadline += 5000;
  const old = await request(message, sender);
  assert.equal(old.ok, false);
  assert.equal(old.code, "WARNING_EXPIRED");
  const newKey = ruleStatus(savedState, savedState.rules[0], now).warningKeys
    .session;
  assert.equal(savedRuntime.dismissedWarnings[newKey], undefined);
});

test("Leave opens New Tab and falls back to blank when unavailable", async () => {
  const sender = {
    id: "test-extension",
    tab: { id: 1 },
    frameId: 0,
    url: "https://example.com/read/child",
    documentId: "current-document",
  };
  navigations = [];
  assert.equal((await request({ type: "LEAVE" }, sender)).ok, true);
  assert.deepEqual(navigations, [{ id: 1, url: "chrome://newtab/" }]);
  rejectNewTab = true;
  navigations = [];
  try {
    assert.equal((await request({ type: "LEAVE" }, sender)).ok, true);
    assert.deepEqual(navigations, [
      { id: 1, url: "chrome://newtab/" },
      { id: 1, url: "about:blank" },
    ]);
  } finally {
    rejectNewTab = false;
  }
});

test("revoking site access clears an existing page gate without approving access", async () => {
  const sender = {
    id: "test-extension",
    tab: { id: 1 },
    frameId: 0,
    url: "https://example.com/read/child",
    documentId: "current-document",
  };
  urlHidden = true;
  try {
    const result = await request({ type: "HEARTBEAT" }, sender);
    assert.equal(result.ok, true);
    assert.equal(result.data.kind, "none");
    assert.deepEqual(result.data.rules, []);
    const approval = await request(
      { type: "APPROVE", reason: "Continue", minutes: 5 },
      sender,
    );
    assert.equal(approval.ok, false);
    assert.equal(approval.code, "STALE_DOCUMENT");
  } finally {
    urlHidden = false;
  }
});

test("invalid duration requests return a useful error without creating Chrome extension errors", async () => {
  savedState = createState();
  savedState.rules = [
    normalizeRule({
      id: "r1",
      target: "example.com/read",
      mode: "prefix",
      dailyMinutes: 10,
      intentionalVisits: true,
    }),
  ];
  savedRuntime = { cursor: null, denied: [] };
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const result = await request(
      { type: "APPROVE", reason: "Read", minutes: 1.5 },
      {
        id: "test-extension",
        tab: { id: 1 },
        frameId: 0,
        url: "https://example.com/read/child",
        documentId: "current-document",
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_DURATION");
    assert.deepEqual(errors, []);
    assert.equal(savedState.logs.length, 0);
  } finally {
    console.error = originalError;
  }
});
