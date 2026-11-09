import { TIME_LIMITS } from "../core/timing.js";
import {
  periodDays,
  shiftDay,
  activitySummary,
  activityTime,
} from "../core/activity.js";
import {
  normalizePresets,
  MESSAGE_COLORS,
  DEFAULT_REASONS,
  MAX_REASON_LENGTH,
  MAX_REASON_COUNT,
} from "../core/preferences.js";
import { normalizeRule, permissionOrigins } from "../core/rules.js";
import { dayKey } from "../core/engine.js";
import {
  request,
  node,
  duration,
  usedDuration,
  totalUsedMs,
  download,
  limitLabel,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
$("dailyMinutes").min = TIME_LIMITS.min;
$("dailyMinutes").max = TIME_LIMITS.max;
$("dailyMinutes").defaultValue = TIME_LIMITS.defaultDaily;
$("daily-limit-max").textContent =
  `Max ${TIME_LIMITS.max.toLocaleString("en-US")} min · ${TIME_LIMITS.max / 60} hr`;
let data;
let activityMode = "day";
let activityDate;
const LOG_PAGE_SIZE = 50;
let logPage = 0;
let logPeriod = "";
let editingId;
let confirmation;
let toastTimer;
let loading = false;
let refreshPending = false;
let selectedPanel = "limits";
let presetsDirty = false;

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3500);
}

function showError(error) {
  $("page-error").hidden = false;
  $("page-error").textContent = error.message;
}

function confirmAction(title, copy, label, action) {
  $("confirm-title").textContent = title;
  $("confirm-copy").textContent = copy;
  $("confirm-action").textContent = label;
  confirmation = action;
  $("confirm-dialog").showModal();
}

function openRule(rule = null, target = "") {
  editingId = rule?.id;
  $("rule-form").reset();
  $("rule-dialog-title").textContent = rule ? "Edit limit" : "Add a limit";
  $("delete-rule").hidden = !rule;
  $("enabled-field").hidden = !rule;
  $("form-error").hidden = true;
  $("save-rule").disabled = false;
  if (rule) {
    for (const field of ["target", "mode", "dailyMinutes", "label", "message"])
      $(field).value = rule[field];
    $("intentionalVisits").checked =
      rule.intentionalVisits ??
      Boolean(rule.requireReason || rule.requireSession);

    const color =
      MESSAGE_COLORS.find((color) => color.value === rule.messageColor)
        ?.value || MESSAGE_COLORS[0].value;
    document.querySelector(
      `input[name="messageColor"][value="${color}"]`,
    ).checked = true;
    for (const field of ["includeSubdomains", "preventOverrides", "enabled"])
      $(field).checked = rule[field];
  } else if (target) {
    $("target").value = target;
    try {
      $("mode").value =
        new URL(`https://${target.replace(/^https?:\/\//, "")}`).pathname ===
        "/"
          ? "domain"
          : "prefix";
    } catch {
      $("mode").value = "prefix";
    }
  }
  $("message-color-picker").open = false;
  updateMessageColor();
  updateMessageCount();
  $("rule-dialog").showModal();
  $("target").focus();
}

function updateMessageCount() {
  $("message-count").textContent = `${$("message").value.length}/160`;
}
$("message").oninput = updateMessageCount;
function updateMessageColor() {
  const color = document.querySelector(
    'input[name="messageColor"]:checked',
  ).value;
  $("message-color-preview").style.backgroundColor = color;
  $("message").style.color = color;
}
for (const input of document.querySelectorAll('input[name="messageColor"]'))
  input.onchange = () => {
    updateMessageColor();
    $("message-color-picker").open = false;
  };
document.addEventListener("click", (event) => {
  for (const id of ["message-color-picker"])
    if (!$(id).contains(event.target)) $(id).open = false;
});
function readPresets(id) {
  return [...$(id).querySelectorAll("input[data-reason]")].map(
    (input) => input.value,
  );
}
function renderPresetEditor(id, values, previous, changed) {
  const editor = $(id);
  editor.replaceChildren();
  values.forEach((value, index) => {
    const row = node("div", undefined, "preset-choice");
    const input = document.createElement("input");
    input.type = "text";
    input.dataset.reason = "";
    input.value = value;
    input.maxLength = previous.includes(value)
      ? Math.max(MAX_REASON_LENGTH, value.length)
      : MAX_REASON_LENGTH;
    input.setAttribute("aria-label", `Reason ${index + 1}`);
    input.placeholder = "New reason";
    const sizeChoice = () => {
      input.style.width = `${Math.max(11, Math.min(22, input.value.length + 1))}ch`;
    };
    sizeChoice();
    input.oninput = () => {
      sizeChoice();
      const legacy = previous.some((old) => old.trim() === input.value.trim());
      input.setCustomValidity(
        [...input.value.trim()].length > MAX_REASON_LENGTH && !legacy
          ? `Keep edited choices to ${MAX_REASON_LENGTH} characters.`
          : "",
      );
      changed();
    };
    input.onkeydown = async (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      const error =
        id === "global-presets" ? $("global-presets-error") : $("form-error");
      error.hidden = true;
      try {
        const next = normalizePresets(
          readPresets(id).filter((reason) => reason.trim()),
          previous,
        );
        if (input.value.trim().length < 3)
          throw new Error("Use at least 3 characters.");
        if (!input.reportValidity()) return;
        input.disabled = true;
        if (id === "global-presets") {
          data = await request("SAVE_REASON_PRESETS", { presets: next });
          presetsDirty = true;
          $("save-presets").disabled = true;
        }
        renderPresetEditor(
          id,
          next.length < MAX_REASON_COUNT ? [...next, ""] : next,
          next,
          changed,
        );
        const inputs = editor.querySelectorAll("input[data-reason]");
        inputs[inputs.length - 1].focus();
      } catch (issue) {
        input.disabled = false;
        error.textContent = issue.message;
        error.hidden = false;
      }
    };
    const remove = node("button", undefined, "remove-choice");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 4l8 8M12 4l-8 8");
    icon.append(path);
    remove.append(icon);
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove reason ${index + 1}`);
    remove.onclick = () => {
      const next = readPresets(id);
      next.splice(index, 1);
      renderPresetEditor(id, next, previous, changed);
      changed();
    };
    row.append(input, remove);
    editor.append(row);
  });
  const actions = node("div", undefined, "preset-editor-actions");
  const add = node("button", "Add choice", "text-button small");
  add.type = "button";
  add.disabled = values.length >= MAX_REASON_COUNT;
  add.onclick = () => {
    renderPresetEditor(id, [...readPresets(id), ""], previous, changed);
    changed();
    editor.querySelectorAll("input[data-reason]")[values.length].focus();
  };
  actions.append(add);
  if (!values.length) {
    const examples = node("button", "Use examples", "text-button small");
    examples.type = "button";
    examples.onclick = () => {
      renderPresetEditor(id, DEFAULT_REASONS, previous, changed);
      changed();
    };
    actions.append(examples);
  }
  editor.append(actions);
}
function globalReasonsChanged() {
  presetsDirty = true;
  $("save-presets").disabled = false;
}
$("global-presets-form").onsubmit = async (event) => {
  event.preventDefault();
  $("save-presets").disabled = true;
  $("global-presets-error").hidden = true;
  try {
    const presets = normalizePresets(
      readPresets("global-presets").filter((reason) => reason.trim()),
      data.settings?.reasonPresets || [],
    );
    data = await request("SAVE_REASON_PRESETS", { presets });
    presetsDirty = false;
    render();
    toast("Reasons saved.");
  } catch (error) {
    $("global-presets-error").textContent = error.message;
    $("global-presets-error").hidden = false;
    $("save-presets").disabled = false;
  }
};

for (const button of document.querySelectorAll("[data-info]")) {
  const hint = $(button.dataset.info);
  let pinned = false;
  const show = () => {
    if (!hint.matches(":popover-open")) hint.showPopover();
    const source = button.getBoundingClientRect();
    const box = hint.getBoundingClientRect();
    hint.style.left = `${Math.max(12, Math.min(source.left, innerWidth - box.width - 12))}px`;
    hint.style.top = `${Math.max(12, Math.min(source.bottom + 8, innerHeight - box.height - 12))}px`;
    button.setAttribute("aria-expanded", "true");
  };
  const hide = () => {
    if (!pinned && hint.matches(":popover-open")) hint.hidePopover();
  };
  button.addEventListener("pointerenter", show);
  button.addEventListener("pointerleave", hide);
  button.addEventListener("focus", show);
  button.addEventListener("blur", hide);
  button.onclick = () => {
    pinned = !pinned;
    if (pinned) show();
    else hide();
  };
  hint.addEventListener("toggle", () => {
    if (!hint.matches(":popover-open")) {
      pinned = false;
      button.setAttribute("aria-expanded", "false");
    }
  });
}

function empty(title, copy) {
  const container = node("div", undefined, "empty");
  container.append(
    node("div", "◒", "symbol"),
    node("h2", title),
    node("p", copy),
  );
  return container;
}

function renderBudget(rule) {
  const budget = node("div", undefined, "rule-budget");
  const meta = node("div", undefined, "rule-meta");
  const paused = rule.enabled === false;
  const summary =
    rule.overrideActive && !paused
      ? `Extra time · ${duration(rule.sessionRemainingMs)} left`
      : limitLabel(rule);
  const separator = node("span", "|", "rule-divider");
  separator.setAttribute("aria-hidden", "true");
  const total = node("span", undefined, "rule-total muted");
  total.append(
    separator,
    node(
      "span",
      `${usedDuration(totalUsedMs(rule))} / ${duration(rule.dailyMinutes * 60000)}`,
    ),
  );
  meta.append(
    node("strong", summary, rule.locked && !paused ? "locked-label" : ""),
    total,
  );
  const progress = node("progress", undefined, "progress");
  progress.max = rule.dailyMinutes * 60000;
  progress.value = rule.usedMs;
  progress.setAttribute("aria-label", `${rule.label} daily usage`);
  budget.append(meta, progress);
  return budget;
}

function renderRules() {
  $("rules").replaceChildren();
  if (!data.rules.length) {
    const container = empty(
      "No limits yet.",
      "Add a website or path to get started.",
    );
    const examples = node("div", undefined, "examples");
    for (const [label, target] of [
      ["YouTube Shorts", "youtube.com/shorts"],
      ["A subreddit", "reddit.com/r/books"],
      ["A whole website", "instagram.com"],
    ]) {
      const button = node("button", label, "example");
      button.onclick = () => openRule(null, target);
      examples.append(button);
    }
    container.append(examples);
    $("rules").append(container);
    return;
  }
  const list = node("div", undefined, "rule-list");
  for (const rule of data.rules) {
    const paused = rule.enabled === false;
    const row = node(
      "article",
      undefined,
      `rule-row${paused ? " paused" : rule.locked ? " locked" : ""}`,
    );
    row.dataset.ruleId = rule.id;
    const info = node("div");
    const name = node("div", undefined, "rule-name");
    name.append(
      node(
        "span",
        undefined,
        `dot${paused || !rule.hasAccess ? " paused" : rule.locked ? " locked" : ""}`,
      ),
      node("h3", rule.label),
    );
    if (paused) name.append(node("span", "Paused", "paused-badge"));
    const scope =
      rule.mode === "domain"
        ? "Whole website"
        : rule.mode === "exact"
          ? "Exact path"
          : "Path + children";
    const features = [
      scope,
      ...(rule.requireReason || rule.requireSession
        ? ["Intentional visits"]
        : []),
      rule.preventOverrides ? "Overrides off" : "Extra time available",
    ];
    const tags = node("ul", undefined, "rule-features");
    tags.setAttribute("aria-label", "Limit settings");
    for (const feature of features)
      tags.append(node("li", feature, "rule-tag"));
    info.append(name, tags);
    const budget = renderBudget(rule);
    const edit = node("button", "Edit", "text-button edit-rule");
    edit.setAttribute("aria-label", `Edit ${rule.label}`);
    edit.onclick = () => openRule(rule);
    row.append(info, budget, edit);
    list.append(row);
  }
  $("rules").append(list);
}

function renderLogs() {
  activityDate ||= data.today;
  const days = periodDays(activityDate, activityMode);
  const summary = activitySummary(data, days);
  const logs = summary.logs;
  $("activity-date").value = activityDate;
  $("activity-date").max = data.today;
  $("activity-date").min = shiftDay(data.today, -29);
  $("activity-day").setAttribute(
    "aria-pressed",
    String(activityMode === "day"),
  );
  $("activity-week").setAttribute(
    "aria-pressed",
    String(activityMode === "week"),
  );
  const dateLabel = (day) =>
    new Date(`${day}T12:00:00`).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  $("activity-period").textContent =
    activityMode === "day"
      ? dateLabel(activityDate)
      : `${dateLabel(days[0])} – ${dateLabel(days[6])}`;
  $("active-time").textContent =
    `${summary.partial ? "≥ " : ""}${activityTime(summary.activeMs)}`;
  $("session-count").textContent = summary.sessions;
  $("override-count").textContent = summary.overrides;
  $("overtime-time").textContent =
    `${summary.partial ? "≥ " : ""}${activityTime(summary.overtimeMs)}`;
  $("activity-note").hidden = summary.activeMs !== null && !summary.partial;
  $("activity-note").textContent =
    summary.activeMs === null
      ? "Active time wasn’t recorded before this update."
      : "Active time is available for part of this period.";
  $("activity-weekdays").hidden = activityMode !== "week";
  $("activity-weekdays").replaceChildren();
  if (activityMode === "week")
    for (const day of days) {
      const daySummary = activitySummary(data, [day]);
      const button = node("button", undefined, "week-day secondary");
      button.disabled = day > data.today || day < shiftDay(data.today, -29);
      button.append(
        node(
          "span",
          new Date(`${day}T12:00:00`).toLocaleDateString([], {
            weekday: "short",
            day: "numeric",
          }),
        ),
        node("strong", activityTime(daySummary.activeMs)),
        node("span", `${daySummary.overrides} overrides`, "small"),
      );
      button.onclick = () => {
        activityDate = day;
        activityMode = "day";
        renderLogs();
      };
      $("activity-weekdays").append(button);
    }
  const period = `${activityMode}:${activityDate}`;
  const samePeriod = logPeriod === period;
  if (!samePeriod) logPage = 0;
  logPeriod = period;
  logPage = Math.min(
    logPage,
    Math.max(0, Math.ceil(logs.length / LOG_PAGE_SIZE) - 1),
  );
  const openRows = new Set(
    samePeriod
      ? [...document.querySelectorAll(".log-item[open]")].map(
          (row) => row.dataset.logId,
        )
      : [],
  );
  const scrollTop = samePeriod
    ? document.querySelector(".log-scroll")?.scrollTop || 0
    : 0;
  $("logs").replaceChildren();
  const summaryDay = activityMode === "day" ? activityDate : null;
  const counts = Object.entries(data.overrideCounts?.[summaryDay] || {}).filter(
    ([, count]) => count > 0,
  );
  if (counts.length) {
    const summary = node("section", undefined, "override-summary");
    summary.append(
      node(
        "h3",
        summaryDay === data.today
          ? "Over limit today"
          : `Over limit · ${summaryDay}`,
      ),
    );
    for (const [id, count] of counts) {
      const label =
        data.rules.find((rule) => rule.id === id)?.label || "Removed limit";
      const seconds = Math.floor(
        (data.overtimeDays?.[summaryDay]?.[id] || 0) / 1000,
      );
      summary.append(
        node(
          "p",
          `${label} · ${count} ${count === 1 ? "override" : "overrides"} · ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s over limit`,
        ),
      );
    }
    $("logs").append(summary);
  }
  $("clear-logs").disabled = !logs.length;
  $("export-logs").disabled = !logs.length;
  if (!logs.length) {
    $("logs").append(
      empty(
        "No reasons for this period.",
        "Your session and override reasons will appear here.",
      ),
    );
    return;
  }
  const scroll = node("div", undefined, "log-scroll");
  scroll.setAttribute("aria-label", "Activity entries");
  const start = logPage * LOG_PAGE_SIZE;
  const groups = Map.groupBy(logs.slice(start, start + LOG_PAGE_SIZE), (log) =>
    dayKey(log.at),
  );
  for (const [date, items] of groups) {
    const section = node("section", undefined, "log-day");
    const header = node("div", undefined, "day-header");
    const label =
      date === data.today
        ? "Today"
        : new Date(`${date}T12:00:00`).toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          });
    const clear = node("button", "Clear day", "text-button small");
    clear.onclick = () => clearLogs(date);
    header.append(node("h3", label), clear);
    const list = node("div", undefined, "log-list");
    for (const log of items) {
      const row = node(
        "details",
        undefined,
        `log-item${log.type === "override" ? " log-override" : ""}`,
      );
      row.dataset.logId = log.id;
      row.open = openRows.has(log.id);
      const heading = node("summary", undefined, "log-line");
      const time = node(
        "time",
        new Date(log.at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        "log-time",
      );
      time.dateTime = new Date(log.at).toISOString();
      const reason = log.reason || "Chose a timed visit.";
      const labels =
        log.type === "override"
          ? log.attempts.map((item) => item.label)
          : log.labels;
      heading.append(
        time,
        node("span", reason, "log-preview"),
        node("span", labels.join(", "), "log-scope"),
      );
      if (log.type === "override")
        heading.append(
          node(
            "span",
            log.attempts.map((item) => `Override #${item.attempt}`).join(" · "),
            "override-badge",
          ),
        );
      else if (log.durationMs || log.minutes)
        heading.append(
          node(
            "span",
            duration(log.durationMs ?? log.minutes * 60000),
            "log-duration",
          ),
        );
      const arrow = node("span", "›", "log-chevron");
      arrow.setAttribute("aria-hidden", "true");
      heading.append(arrow);
      const body = node("div", undefined, "log-expanded");
      body.append(
        node("p", `Reason: ${reason}`, "log-reason"),
        node(
          "p",
          log.type === "override"
            ? log.attempts
                .map(
                  (item) =>
                    `${item.label} · Override #${item.attempt} · ${duration(item.durationMs ?? item.minutes * 60000)} extra time`,
                )
                .join("; ")
            : `${labels.join(", ")}${log.durationMs || log.minutes ? ` · ${duration(log.durationMs ?? log.minutes * 60000)} session` : ""}`,
          "log-detail",
        ),
      );
      row.append(heading, body);
      list.append(row);
    }
    section.append(header, list);
    scroll.append(section);
  }
  $("logs").append(scroll);
  scroll.scrollTop = scrollTop;
  if (logs.length > LOG_PAGE_SIZE) {
    const pages = node("nav", undefined, "log-pages");
    pages.setAttribute("aria-label", "Activity pages");
    const newer = node("button", "Newer", "secondary");
    const older = node("button", "Older", "secondary");
    newer.disabled = logPage === 0;
    older.disabled = start + LOG_PAGE_SIZE >= logs.length;
    for (const [button, step] of [
      [newer, -1],
      [older, 1],
    ])
      button.onclick = () => {
        logPage += step;
        renderLogs();
        document.querySelector(".log-scroll").scrollTop = 0;
      };
    pages.append(
      newer,
      node(
        "span",
        `${start + 1}–${Math.min(start + LOG_PAGE_SIZE, logs.length)} of ${logs.length}`,
        "muted",
      ),
      older,
    );
    $("logs").append(pages);
  }
}

function render() {
  if (!presetsDirty && !$("global-presets").contains(document.activeElement))
    renderPresetEditor(
      "global-presets",
      data.settings?.reasonPresets || [],
      data.settings?.reasonPresets || [],
      globalReasonsChanged,
    );
  const strict = data.settings?.strictMode === true;
  $("strict-toggle").textContent = strict ? "Disable guard" : "Enable guard";
  $("strict-toggle").setAttribute("aria-pressed", String(strict));
  renderRules();
  renderLogs();
}

function finishRefresh() {
  loading = false;
  if (refreshPending) {
    refreshPending = false;
    void refresh();
  }
}

async function refresh() {
  if (loading) {
    refreshPending = true;
    return;
  }
  if ($("rule-dialog").open || $("confirm-dialog").open) return;
  loading = true;
  try {
    data = await request("DASHBOARD");
    $("page-error").hidden = true;
    render();
  } catch (error) {
    showError(error);
  } finally {
    finishRefresh();
  }
}

async function refreshStats() {
  if (
    !data ||
    loading ||
    document.hidden ||
    selectedPanel !== "limits" ||
    $("rule-dialog").open ||
    $("confirm-dialog").open
  )
    return;
  loading = true;
  try {
    data = { ...data, ...(await request("DASHBOARD", { summaryOnly: true })) };
    for (const row of $("rules").querySelectorAll(".rule-row")) {
      const rule = data.rules.find((rule) => rule.id === row.dataset.ruleId);
      if (!rule) continue;
      row.querySelector(".rule-budget").replaceWith(renderBudget(rule));
      row.classList.toggle("locked", rule.enabled !== false && rule.locked);
      const dot = row.querySelector(".dot");
      dot.classList.toggle(
        "locked",
        rule.enabled !== false && rule.hasAccess !== false && rule.locked,
      );
    }
    $("page-error").hidden = true;
  } catch (error) {
    showError(error);
  } finally {
    finishRefresh();
  }
}

function clearLogs(day = null) {
  confirmAction(
    day ? "Clear this day’s logs?" : "Clear all logs?",
    "Your daily usage and locked pages stay as they are. This cannot be undone.",
    "Clear logs",
    async () => {
      data = await request("CLEAR_LOGS", { day });
      render();
      toast("Logs cleared. Your limits are unchanged.");
    },
  );
}

function selectPanel(panel) {
  selectedPanel = panel;
  $("page-title").textContent = {
    limits: "Limits",
    activity: "Activity",
    settings: "Settings",
  }[panel];
  $("add-rule").hidden = panel !== "limits";
  const url = new URL(location.href);
  if (panel === "limits") url.searchParams.delete("panel");
  else url.searchParams.set("panel", panel);
  history.replaceState(null, "", `${url.pathname}${url.search}`);
  for (const name of ["limits", "activity", "settings"]) {
    $(`${name}-tab`).setAttribute("aria-selected", String(name === panel));
    $(`${name}-tab`).tabIndex = name === panel ? 0 : -1;
    $(`${name}-panel`).hidden = name !== panel;
  }
  refresh();
}

$("limits-tab").onclick = () => selectPanel("limits");
$("activity-tab").onclick = () => selectPanel("activity");
$("settings-tab").onclick = () => selectPanel("settings");
document
  .querySelector("[role=tablist]")
  .addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const panels = ["limits", "activity", "settings"];
      const index = panels.indexOf(selectedPanel);
      selectPanel(
        event.key === "Home"
          ? "limits"
          : event.key === "End"
            ? "settings"
            : panels[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3],
      );
      $(`${selectedPanel}-tab`).focus();
    }
  });
$("strict-toggle").onclick = async () => {
  $("strict-toggle").disabled = true;
  try {
    const enabled = !data.settings?.strictMode;
    if (
      enabled &&
      !(await chrome.permissions.request({ permissions: ["tabs"] }))
    )
      throw new Error(
        "Tab URL access is required for the extension-page guard.",
      );
    data = await request("SET_STRICT", { enabled });
    render();
    toast(
      enabled
        ? "Extension-page guard enabled."
        : "Extension-page guard disabled.",
    );
  } catch (error) {
    showError(error);
  } finally {
    $("strict-toggle").disabled = false;
  }
};
$("add-rule").onclick = () => openRule();
$("close-rule").onclick = $("cancel-rule").onclick = () =>
  $("rule-dialog").close();
$("confirm-cancel").onclick = () => $("confirm-dialog").close();
$("confirm-action").onclick = async () => {
  $("confirm-action").disabled = true;
  try {
    await confirmation();
    $("confirm-dialog").close();
  } catch (error) {
    showError(error);
    $("confirm-dialog").close();
  } finally {
    $("confirm-action").disabled = false;
  }
};
$("rule-form").onsubmit = async (event) => {
  event.preventDefault();
  $("save-rule").disabled = true;
  $("form-error").hidden = true;
  try {
    const input = { id: editingId };
    for (const field of ["target", "mode", "dailyMinutes", "label", "message"])
      input[field] = $(field).value;
    for (const field of ["includeSubdomains", "preventOverrides", "enabled"])
      input[field] = $(field).checked;
    input.intentionalVisits = $("intentionalVisits").checked;
    // Retain old per-site lists in stored configuration; hints now use Settings only.
    const previous = data.rules.find((rule) => rule.id === editingId);
    input.reasonPresets = previous?.reasonPresets || [];
    input.presetMode = previous?.presetMode || "global";
    input.useSavedReasons = previous?.useSavedReasons ?? true;
    input.messageColor = document.querySelector(
      'input[name="messageColor"]:checked',
    ).value;
    const rule = normalizeRule(
      input,
      data.rules.find((rule) => rule.id === editingId),
    );
    const granted = await chrome.permissions.request({
      origins: permissionOrigins(rule),
    });
    if (!granted)
      throw new Error(
        "Website access is needed to count time and show your prompts. You can try again when you’re ready.",
      );
    data = await request("SAVE_RULE", { rule });
    $("rule-dialog").close();
    render();
    toast(editingId ? "Limit updated." : "Your limit is ready.");
  } catch (error) {
    $("form-error").hidden = false;
    $("form-error").textContent = error.message;
  } finally {
    $("save-rule").disabled = false;
  }
};
$("delete-rule").onclick = () => {
  const id = editingId;
  $("rule-dialog").close();
  confirmAction(
    "Delete this limit?",
    "This removes its usage and lock. Past intention logs are kept.",
    "Delete limit",
    async () => {
      data = await request("DELETE_RULE", { id });
      render();
      toast("Limit deleted.");
    },
  );
};
$("activity-date").onchange = () => {
  const day = $("activity-date").value;
  if (day && day <= data.today && day >= shiftDay(data.today, -29)) {
    activityDate = day;
    renderLogs();
  }
};
for (const mode of ["day", "week"])
  $("activity-" + mode).onclick = () => {
    activityMode = mode;
    renderLogs();
  };
$("clear-logs").onclick = () => {
  const days = periodDays(activityDate, activityMode);
  confirmAction(
    "Clear these reasons?",
    "Usage and override totals stay unchanged.",
    "Clear logs",
    async () => {
      data = await request("CLEAR_LOGS", { days });
      render();
    },
  );
};
$("export-logs").onclick = async () => {
  try {
    const days = periodDays(activityDate, activityMode);
    data = await request("DASHBOARD");
    download(
      `intentional-logs-${data.today}.json`,
      activitySummary(data, days).logs,
    );
    render();
  } catch (error) {
    showError(error);
  }
};
$("export-data").onclick = async () => {
  try {
    data = await request("DASHBOARD");
    download(`intentional-data-${data.today}.json`, {
      version: data.version,
      settings: data.settings,
      rules: data.rules,
      days: data.days,
      activeDays: data.activeDays,
      activeOvertimeDays: data.activeOvertimeDays,
      activitySince: data.activitySince,
      logs: data.logs,
      sessions: data.sessions,
      locks: data.locks,
      overrides: data.overrides,
      overrideCounts: data.overrideCounts,
      overtimeDays: data.overtimeDays,
    });
    render();
  } catch (error) {
    showError(error);
  }
};
$("clear-data").onclick = () =>
  confirmAction(
    "Erase all Intentional data?",
    "This removes all limits, usage, timers, and logs from this device. It cannot be undone. Website permissions can be removed in Chrome’s extension settings.",
    "Erase everything",
    async () => {
      data = await request("CLEAR_DATA");
      presetsDirty = false;
      $("global-presets-error").hidden = true;
      $("save-presets").disabled = true;
      render();
      toast("All data erased.");
    },
  );

await refresh();
const params = new URL(location.href).searchParams;
const target = params.get("target");
const edit = params.get("edit");
selectPanel(
  ["limits", "activity", "settings"].includes(params.get("panel"))
    ? params.get("panel")
    : "limits",
);
if (target || edit) {
  history.replaceState(null, "", location.pathname);
  const rule = edit ? data.rules.find((rule) => rule.id === edit) : null;
  if (rule) openRule(rule);
  else if (target) openRule(null, target);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
window.addEventListener("focus", () => {
  void refresh();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "RULES_CHANGED" && !document.hidden) void refresh();
});
setInterval(refreshStats, 1000);
setInterval(() => {
  if (!document.hidden && selectedPanel !== "limits") void refresh();
}, 15000);
