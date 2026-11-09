import { dismissedKeys } from "../core/warnings.js";
import {
  evaluate,
  settleUsage,
  expireSessions,
  ruleStatus,
} from "../core/engine.js";

export function permittedState(state, runtime) {
  return {
    ...state,
    rules: state.rules.filter((rule) => !runtime.denied.includes(rule.id)),
  };
}

export async function tick(state, runtime, now = Date.now()) {
  settleUsage(state, runtime.cursor, now);
  expireSessions(state, now);
  runtime.cursor = null;
  const window = await chrome.windows.getLastFocused().catch(() => null);
  const idle = await chrome.idle.queryState(60);
  if (!window?.focused || idle === "locked") return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab?.url) return;
  const result = evaluate(permittedState(state, runtime), tab.url, now);
  if (result.kind === "allowed")
    runtime.cursor = {
      at: now,
      tabId: tab.id,
      ids: result.rules.map((rule) => rule.id),
    };
}

export async function publish(state, runtime, now) {
  const effective = permittedState(state, runtime);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => /^https?:/.test(tab.url || ""))
      .map(async (tab) => {
        const result = evaluate(effective, tab.url, now);
        await chrome.tabs.sendMessage(tab.id, {
          type: "STATUS",
          status: {
            ...result,
            active: runtime.cursor?.tabId === tab.id,
            dismissedWarningKeys: dismissedKeys(runtime, now),
          },
        });
      }),
  );
  const cursor = runtime.cursor;
  const text = cursor
    ? String(
        Math.ceil(
          Math.min(
            ...cursor.ids.map((id) => {
              const rule = state.rules.find((item) => item.id === id);
              if (!rule) return Infinity;
              const status = ruleStatus(state, rule, now);
              return status.overrideActive
                ? status.sessionRemainingMs
                : status.remainingMs;
            }),
          ) / 60000,
        ),
      )
    : "";
  await chrome.action.setBadgeBackgroundColor({ color: "#244c3d" });
  await chrome.action.setBadgeText({ text });
}
