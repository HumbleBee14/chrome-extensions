import { wholeMinutes } from "./timing.js";
import {
  normalizePresets,
  messageColor,
  normalizeMessage,
} from "./preferences.js";

const modes = new Set(["domain", "prefix", "exact"]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const MAX_NAME_LENGTH = 32;

export function normalizeName(name, fallback = "") {
  return (String(name || "").trim() || fallback).slice(0, MAX_NAME_LENGTH);
}

export function normalizeRule(input, previous) {
  const raw = String(input.target || "").trim();
  if (!raw || raw.includes("*"))
    throw new Error("Enter a domain or a full website URL, without wildcards.");
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid website, such as reddit.com/r/books.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port
  ) {
    throw new Error(
      "Use an HTTP or HTTPS address without a port, login, query, or fragment.",
    );
  }
  if (!/^[a-z\d.-]+$/.test(url.hostname) || url.hostname.includes(".."))
    throw new Error("Enter a valid hostname.");
  if (!modes.has(input.mode))
    throw new Error("Choose a domain, path and children, or exact path.");
  const dailyMinutes = wholeMinutes(input.dailyMinutes);
  const explicitIntention = input.intentionalVisits !== undefined;
  const intentionalVisits = explicitIntention
    ? Boolean(input.intentionalVisits)
    : Boolean(input.requireReason || input.requireSession);
  if (
    input.presetMode !== undefined &&
    !["global", "custom"].includes(input.presetMode)
  )
    throw new Error("Choose global or custom saved reasons.");
  const includeSubdomains = input.includeSubdomains !== false;
  const host = includeSubdomains
    ? url.hostname.replace(/^www\./, "")
    : url.hostname;
  const path =
    input.mode === "domain" ? "/" : url.pathname.replace(/\/+$/, "") || "/";
  if (path.length > 500)
    throw new Error("That path is too long. Use a shorter parent path.");
  return {
    id: String(input.id || crypto.randomUUID()),
    label: normalizeName(input.label, `${host}${path === "/" ? "" : path}`),
    host,
    path,
    mode: input.mode,
    target: `${host}${path === "/" ? "" : path}`,
    dailyMinutes,
    preventOverrides: Boolean(input.preventOverrides),
    includeSubdomains,
    intentionalVisits,
    requireReason: explicitIntention
      ? intentionalVisits
      : Boolean(input.requireReason),
    requireSession: explicitIntention
      ? intentionalVisits
      : Boolean(input.requireSession),
    useSavedReasons: input.useSavedReasons !== false,
    presetMode: input.presetMode || "global",
    reasonPresets: normalizePresets(
      input.reasonPresets || [],
      previous?.reasonPresets || [],
    ),
    messageColor: messageColor(input.messageColor),
    message: normalizeMessage(input.message),
    enabled: input.enabled !== false,
  };
}

export function matches(rule, address) {
  if (!rule.enabled) return false;
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const hostMatches =
    url.hostname === rule.host ||
    (rule.includeSubdomains && url.hostname.endsWith(`.${rule.host}`));
  if (!hostMatches) return false;
  if (rule.mode === "domain") return true;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (rule.mode === "exact") return path === rule.path;
  return (
    rule.path === "/" || path === rule.path || path.startsWith(`${rule.path}/`)
  );
}

export function networkPattern(rule) {
  const subdomains = rule.includeSubdomains ? "([^/.:]+\\.)*" : "";
  const host = `^https?://${subdomains}${escapeRegex(rule.host)}(:[0-9]+)?`;
  if (rule.mode === "domain" || (rule.mode === "prefix" && rule.path === "/"))
    return `${host}/`;
  if (rule.mode === "exact" && rule.path === "/") return `${host}/+([?#]|$)`;
  const path = escapeRegex(rule.path);
  return `${host}${path}${rule.mode === "exact" ? "/*([?#]|$)" : "(/|[?#]|$)"}`;
}

export function permissionOrigins(rule) {
  const host = `${rule.includeSubdomains ? "*." : ""}${rule.host}`;
  return [`http://${host}/*`, `https://${host}/*`];
}
