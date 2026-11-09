import { normalizePresets } from "../core/preferences.js";
import { dismissedKeys, dismissWarning } from "../core/warnings.js";
import { isSettingsSender, RequestError } from "../core/messages.js";
import { shouldGuard } from "../core/strict.js";
import {
  normalizeRule,
  networkPattern,
  permissionOrigins,
} from "../core/rules.js";
import {
  approve,
  approveOverride,
  dayKey,
  evaluate,
  ruleStatus,
} from "../core/engine.js";
import {
  readState,
  readRuntime,
  writeState,
  protectStorage,
} from "./storage.js";
import {
  syncScripts,
  syncBlocks,
  schedule,
  injectOpenTabs,
  guardManager,
} from "./enforcement.js";
import { tick, publish, permittedState } from "./tracker.js";

let queue = Promise.resolve();
const serial = (task) => {
  const result = queue.then(task);
  queue = result.catch((error) => {
    if (!(error instanceof RequestError)) console.error("Intentional:", error);
  });
  return result;
};

async function reconcile(state, runtime, now, broadcast = true) {
  await guardManager(state);
  await writeState(state, runtime);
  await syncBlocks(state, runtime, now);
  await schedule(state, runtime.cursor, now);
  if (broadcast) {
    await publish(state, runtime, now);
    await chrome.storage.session.set({ runtime });
  }
}

async function refresh({ scripts = false, inject = false } = {}) {
  const state = await readState();
  const runtime = await readRuntime();
  if (scripts) await syncScripts(state, runtime);
  const now = Date.now();
  await tick(state, runtime, now);
  await reconcile(state, runtime, now);
  if (inject) {
    await injectOpenTabs(state, runtime);
    await chrome.runtime.sendMessage({ type: "RULES_CHANGED" }).catch(() => {});
  }
}

function trustedPage(sender) {
  return isSettingsSender(sender, chrome.runtime.id, chrome.runtime.getURL(""));
}

async function handle(message, sender) {
  const state = await readState();
  const runtime = await readRuntime();
  const now = Date.now();
  await tick(state, runtime, now);
  if (
    [
      "VISIT",
      "HEARTBEAT",
      "APPROVE",
      "OVERRIDE",
      "LEAVE",
      "DISMISS_WARNING",
    ].includes(message.type)
  ) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.tab ||
      sender.frameId !== 0 ||
      !/^https?:/.test(sender.url || "") ||
      !sender.documentId
    )
      throw new RequestError(
        "INVALID_PAGE",
        "This request must come from a monitored page.",
      );
    const frame = await chrome.webNavigation
      .getFrame({
        tabId: sender.tab.id,
        frameId: 0,
      })
      .catch(() => null);
    if (
      frame?.documentId !== sender.documentId &&
      message.type !== "DISMISS_WARNING"
    )
      throw new RequestError(
        "STALE_DOCUMENT",
        "This visit changed. Please continue on the current page.",
      );
    const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
    if (tab && !tab.url && ["VISIT", "HEARTBEAT"].includes(message.type))
      return { kind: "none", rules: [], now };
    if (!tab?.url)
      throw new RequestError(
        "STALE_DOCUMENT",
        "This page is no longer available.",
      );
    const effective = permittedState(state, runtime);
    if (message.type === "APPROVE") {
      const result = evaluate(effective, tab.url, now);
      if (result.kind !== "prompt")
        throw new RequestError(
          "INTENTION_CHANGED",
          "This page no longer needs an intention.",
        );
      approve(
        state,
        result.rules,
        message.reason,
        message.minutes,
        now,
        message.useRemaining === true,
      );
    }
    if (message.type === "OVERRIDE") {
      const result = evaluate(effective, tab.url, now);
      if (!result.canOverride)
        throw new RequestError(
          "OVERRIDE_UNAVAILABLE",
          "An override is not available for this page.",
        );
      approveOverride(
        state,
        result.rules,
        message.reason,
        now,
        message.minutes,
        message.useRemaining === true,
      );
    }
    if (message.type === "DISMISS_WARNING") {
      const result = evaluate(effective, tab.url, now);
      const rule = result.rules.find((rule) => rule.id === message.ruleId);
      if (!rule || rule.warningKeys?.[message.clock] !== message.warningKey)
        throw new RequestError(
          "WARNING_EXPIRED",
          "This reminder is no longer active.",
        );
      dismissWarning(runtime, rule, message.clock, now, result.resetAt);
    }
    if (message.type === "LEAVE") {
      await chrome.tabs
        .update(tab.id, { url: "chrome://newtab/" })
        .catch(() => chrome.tabs.update(tab.id, { url: "about:blank" }));
    }
    await tick(state, runtime, now);
    await reconcile(state, runtime, now, message.type !== "HEARTBEAT");
    return {
      ...evaluate(effective, tab.url, now),
      active: runtime.cursor?.tabId === tab.id,
      dismissedWarningKeys: dismissedKeys(runtime, now),
    };
  }
  if (!trustedPage(sender))
    throw new Error("Open Intentional to manage your settings.");
  let inject = false;
  if (message.type === "SAVE_RULE") {
    const existing = state.rules.find((rule) => rule.id === message.rule.id);
    const rule = normalizeRule({ ...message.rule, id: existing?.id }, existing);
    if (!existing && state.rules.length >= 100)
      throw new Error("You can monitor up to 100 rules.");
    if (
      !(await chrome.permissions.contains({ origins: permissionOrigins(rule) }))
    )
      throw new Error("Allow website access to monitor this rule.");
    const supported = await chrome.declarativeNetRequest.isRegexSupported({
      regex: networkPattern(rule),
      isCaseSensitive: true,
    });
    if (!supported.isSupported)
      throw new Error(
        "Chrome cannot monitor this path. Use a shorter parent path.",
      );
    if (
      state.rules.some(
        (item) =>
          item.id !== rule.id &&
          item.host === rule.host &&
          item.path === rule.path &&
          item.mode === rule.mode &&
          item.includeSubdomains === rule.includeSubdomains,
      )
    )
      throw new Error("This rule already exists. Edit it instead.");
    if (existing) state.rules[state.rules.indexOf(existing)] = rule;
    else state.rules.push(rule);
    delete state.locks[rule.id];
    delete state.sessions[rule.id];
    delete state.overrides[rule.id];
    await syncScripts(state, runtime);
    inject = true;
  } else if (message.type === "DELETE_RULE") {
    state.rules = state.rules.filter((rule) => rule.id !== message.id);
    delete state.sessions[message.id];
    delete state.locks[message.id];
    delete state.overrides[message.id];
    for (const records of [state.overrideCounts, state.overtimeDays])
      for (const day of Object.values(records)) delete day[message.id];
    for (const day of Object.values(state.days)) delete day[message.id];
    await syncScripts(state, runtime);
    inject = true;
  } else if (message.type === "CLEAR_LOGS") {
    state.logs = message.days
      ? state.logs.filter((log) => !message.days.includes(dayKey(log.at)))
      : message.day
        ? state.logs.filter((log) => dayKey(log.at) !== message.day)
        : [];
  } else if (message.type === "SAVE_REASON_PRESETS") {
    let reasonPresets;
    try {
      reasonPresets = normalizePresets(
        message.presets,
        state.settings.reasonPresets || [],
      );
    } catch (error) {
      throw new RequestError("INVALID_PRESETS", error.message);
    }
    state.settings = { ...state.settings, reasonPresets };
  } else if (message.type === "SET_STRICT") {
    if (
      message.enabled &&
      !(await chrome.permissions.contains({ permissions: ["tabs"] }))
    )
      throw new Error(
        "Allow tab URL access to enable the extension-page guard.",
      );
    state.settings = {
      ...state.settings,
      strictMode: Boolean(message.enabled),
    };
  } else if (message.type === "CLEAR_DATA") {
    state.settings = { strictMode: false, reasonPresets: [] };
    state.rules = [];
    state.days = {};
    state.activeDays = {};
    state.activeOvertimeDays = {};
    state.activitySince = new Date().setHours(0, 0, 0, 0);
    state.logs = [];
    state.sessions = {};
    state.locks = {};
    state.overrides = {};
    state.overrideCounts = {};
    state.overtimeDays = {};
    runtime.dismissedWarnings = {};
    await syncScripts(state, runtime);
    inject = true;
  } else if (message.type !== "DASHBOARD") {
    throw new Error("Unknown request.");
  }
  await tick(state, runtime, now);
  await reconcile(state, runtime, now);
  if (inject) {
    await injectOpenTabs(state, runtime);
    await chrome.runtime.sendMessage({ type: "RULES_CHANGED" }).catch(() => {});
  }
  const summary = {
    rules: state.rules.map((rule) => ({
      ...ruleStatus(state, rule, now),
      hasAccess: !runtime.denied.includes(rule.id),
    })),
    today: dayKey(now),
    now,
  };
  return message.type === "DASHBOARD" && message.summaryOnly
    ? summary
    : { ...state, ...summary };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RULES_CHANGED") return;
  serial(() => handle(message, sender)).then(
    (data) => sendResponse({ ok: true, data }),
    (error) =>
      sendResponse({
        ok: false,
        error: error.message,
        ...(error instanceof RequestError ? { code: error.code } : {}),
      }),
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() =>
  serial(async () => {
    await protectStorage();
    chrome.idle.setDetectionInterval(60);
    await refresh({ scripts: true, inject: true });
  }),
);
chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    await protectStorage();
    chrome.idle.setDetectionInterval(60);
    await refresh({ scripts: true, inject: true });
  }),
);
chrome.alarms.onAlarm.addListener(() => serial(() => refresh()));
chrome.tabs.onActivated.addListener(() => serial(() => refresh()));
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url || change.status === "loading")
    serial(async () => {
      const state = await readState();
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (tab && shouldGuard(state.settings, change.url || tab.url)) {
        await chrome.tabs.update(id, {
          url: chrome.runtime.getURL("ui/strict.html"),
        });
      }
      await refresh();
    });
});
chrome.tabs.onRemoved.addListener(() => serial(() => refresh()));
chrome.windows.onFocusChanged.addListener(() => serial(() => refresh()));
chrome.idle.onStateChanged.addListener(() => serial(() => refresh()));
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) serial(() => refresh());
});
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  if (details.frameId === 0) serial(() => refresh());
});
chrome.permissions.onAdded.addListener(() =>
  serial(() => refresh({ scripts: true, inject: true })),
);
chrome.permissions.onRemoved.addListener(() =>
  serial(() => refresh({ scripts: true, inject: true })),
);
