import { dailySummary, popupClock } from "./popup-view.js";
import { matches } from "../core/rules.js";
import { request, node, openSettings, primaryLimit } from "./shared.js";

const $ = (id) => document.getElementById(id);
let target = "";
let editingId = "";
let refreshing = false;
$("settings").onclick = () => openSettings("", "", "settings");
$("monitor").onclick = () => openSettings(target, editingId);
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const data = await request("DASHBOARD", { summaryOnly: true });
    let url;
    try {
      url = new URL(tab?.url);
    } catch {
      url = null;
    }
    const supported = url && ["http:", "https:"].includes(url.protocol);
    target = supported
      ? `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`
      : "";
    const rules = supported
      ? data.rules
          .filter((rule) => matches({ ...rule, enabled: true }, tab.url))
          .sort((a, b) => b.path.length - a.path.length)
      : [];
    const primary = primaryLimit(rules);
    editingId = primary?.id || "";
    $("title").textContent =
      primary?.label || (supported ? url.hostname : "Choose a website");
    $("subtitle").hidden = Boolean(primary);
    $("subtitle").textContent = supported
      ? "No limit set"
      : "Add a limit to get started.";
    $("monitor").textContent = primary ? "Edit limit" : "Add a limit";
    $("rules").replaceChildren();
    for (const rule of rules) {
      const row = node("div", undefined, "popup-rule");
      const meta = node("div", undefined, "rule-meta");
      meta.append(
        node("strong", "Today"),
        node("span", dailySummary(rule), "muted"),
      );
      const progress = node("progress", undefined, "progress");
      progress.max = rule.dailyMinutes * 60000;
      progress.value = rule.usedMs;
      progress.setAttribute("aria-label", `${rule.label} daily usage`);
      if (rules.length > 1) row.append(node("h3", rule.label));
      row.append(meta, progress);
      $("rules").append(row);
    }
    if (rules.length) {
      const clock = popupClock(rules);
      const timer = node("div", undefined, "popup-timer");
      timer.append(
        node("span", clock.label, "muted"),
        node("strong", clock.value, "popup-countdown"),
      );
      $("rules").append(timer);
    }
    $("error").hidden = true;
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent = error.message;
  } finally {
    refreshing = false;
  }
}
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "RULES_CHANGED") void refresh();
});
await refresh();
setInterval(refresh, 1000);
