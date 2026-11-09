import { normalizeMessage, messageColor } from "../core/preferences.js";
import { normalizeName } from "../core/rules.js";
import { createState, prune } from "../core/engine.js";

export async function readState() {
  const { state } = await chrome.storage.local.get("state");
  if (!state) return createState();
  state.activeDays ||= {};
  state.activeOvertimeDays ||= {};
  state.activitySince ??= Date.now();
  for (const rule of state.rules) {
    rule.label = normalizeName(rule.label, rule.target);
    rule.message = normalizeMessage(rule.message);
    rule.messageColor = messageColor(rule.messageColor);
  }
  return state;
}

export async function readRuntime() {
  const { runtime } = await chrome.storage.session.get("runtime");
  return runtime || { cursor: null, denied: [] };
}

export async function writeState(state, runtime) {
  prune(state);
  await chrome.storage.local.set({ state });
  await chrome.storage.session.set({ runtime });
}

export async function protectStorage() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}
