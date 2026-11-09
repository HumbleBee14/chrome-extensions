export async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok)
    throw new Error(response?.error || "Unable to connect to Intentional.");
  return response.data;
}

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export {
  formatDuration as duration,
  formatUsedDuration as usedDuration,
  totalUsedMs,
} from "../core/timing.js";
import { formatDuration as duration } from "../core/timing.js";

export function download(filename, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = node("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function limitLabel(rule) {
  if (rule.hasAccess === false) return "Access needed";
  if (rule.enabled === false) return "Paused";
  if (rule.locked)
    return rule.preventOverrides ? "Blocked until midnight" : "Limit reached";
  if (rule.overrideActive) return "Extra time active";
  return `${duration(rule.remainingMs)} left today`;
}

export function primaryLimit(rules) {
  const enabled = rules.filter((rule) => rule.enabled !== false);
  const granted = enabled.filter((rule) => rule.hasAccess !== false);
  const relevant = granted.length ? granted : enabled.length ? enabled : rules;
  return (
    relevant.find((rule) => rule.locked && rule.preventOverrides) ||
    relevant.find((rule) => rule.locked) ||
    relevant.find((rule) => rule.overrideActive) ||
    relevant[0]
  );
}

export function openSettings(target = "", edit = "", panel = "limits") {
  const params = new URLSearchParams();
  if (target) params.set("target", target);
  if (edit) params.set("edit", edit);
  if (panel !== "limits") params.set("panel", panel);
  return chrome.tabs.create({
    url: chrome.runtime.getURL(
      `ui/options.html${params.size ? `?${params}` : ""}`,
    ),
  });
}

export async function leavePage() {
  try {
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.update(tab.id, { url: "chrome://newtab/" });
  } catch {
    location.replace("about:blank");
  }
}
