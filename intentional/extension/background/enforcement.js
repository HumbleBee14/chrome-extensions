import { shouldGuard } from "../core/strict.js";
import { matches, networkPattern, permissionOrigins } from "../core/rules.js";
import { ruleStatus, nextMidnight } from "../core/engine.js";

const contentFiles = ["content/styles.js", "content/index.js"];

export async function syncScripts(state, runtime) {
  const eligible = [];
  runtime.denied = [];
  for (const rule of state.rules) {
    if (
      !(await chrome.permissions.contains({ origins: permissionOrigins(rule) }))
    )
      runtime.denied.push(rule.id);
    else if (rule.enabled) eligible.push(rule);
  }
  const matches = [...new Set(eligible.flatMap(permissionOrigins))].sort();
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const existing = scripts.find(
    (script) => script.id === "intentional-monitor",
  );
  if (
    JSON.stringify(existing?.matches?.slice().sort() || []) ===
      JSON.stringify(matches) &&
    JSON.stringify(existing?.js || []) === JSON.stringify(contentFiles)
  )
    return;
  if (existing)
    await chrome.scripting.unregisterContentScripts({
      ids: ["intentional-monitor"],
    });
  if (matches.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: "intentional-monitor",
        matches,
        js: contentFiles,
        runAt: "document_start",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  }
}

export async function syncBlocks(state, runtime, now) {
  const rules = state.rules.filter(
    (rule) =>
      rule.enabled &&
      rule.preventOverrides &&
      !runtime.denied.includes(rule.id) &&
      ruleStatus(state, rule, now).locked,
  );
  const desired = rules.map((rule, index) => ({
    id: index + 1,
    priority: rule.path.length + 1,
    action: {
      type: "redirect",
      redirect: {
        url: chrome.runtime.getURL(
          `ui/blocked.html?rule=${encodeURIComponent(rule.id)}`,
        ),
      },
    },
    condition: {
      regexFilter: networkPattern(rule),
      isUrlFilterCaseSensitive: true,
      resourceTypes: ["main_frame"],
    },
  }));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const comparable = (items) =>
    JSON.stringify(
      items
        .slice()
        .sort((a, b) => a.id - b.id)
        .map(({ id, priority, action, condition }) => ({
          id,
          priority,
          action,
          condition,
        })),
    );
  if (comparable(existing) !== comparable(desired)) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: desired,
    });
  }
}

export async function schedule(state, cursor, now) {
  const deadlines = [nextMidnight(now)];
  for (const session of [
    ...Object.values(state.sessions),
    ...Object.values(state.overrides || {}),
  ])
    if (session.deadline > now) deadlines.push(session.deadline);
  if (cursor) {
    for (const id of cursor.ids) {
      const rule = state.rules.find((item) => item.id === id);
      if (rule) {
        const left = ruleStatus(state, rule, now).remainingMs;
        if (left > 0) deadlines.push(now + left);
      }
    }
  }
  await chrome.alarms.create("boundary", {
    when: Math.max(now + 100, Math.min(...deadlines)),
  });
  const heartbeat = await chrome.alarms.get("reconcile");
  if (!heartbeat)
    await chrome.alarms.create("reconcile", { periodInMinutes: 0.5 });
}

export async function injectOpenTabs(state, runtime) {
  // Inject across each granted host so navigation into a monitored SPA path works.
  const hosts = state.rules
    .filter((rule) => rule.enabled && !runtime.denied.includes(rule.id))
    .map((rule) => ({ ...rule, mode: "domain" }));
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => hosts.some((rule) => matches(rule, tab.url)))
      .map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: contentFiles,
        }),
      ),
  );
}

export async function guardManager(state) {
  if (!state.settings?.strictMode) return;
  if (!(await chrome.permissions.contains({ permissions: ["tabs"] }))) {
    state.settings.strictMode = false;
    return;
  }
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => shouldGuard(state.settings, tab.url))
      .map((tab) =>
        chrome.tabs.update(tab.id, {
          url: chrome.runtime.getURL("ui/strict.html"),
        }),
      ),
  );
}
