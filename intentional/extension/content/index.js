(() => {
  if (globalThis.__intentionalLoaded) return;
  globalThis.__intentionalLoaded = true;

  const host = document.createElement("intentional-guard");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = globalThis.__intentionalStyles;
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "intentional-title");
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.hidden = true;
  chip.title = "Daily and session time remaining. Click for details.";
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  root.append(style, dialog, chip, toast);

  let status = null;
  let signature = "";
  let lastUrl = location.href;
  let busy = false;
  let pending = false;
  let disconnected = false;
  let receivedAt = Date.now();
  const warned = new Set();
  let toastTimer;
  let toastClock = null;

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const time = (ms) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  };
  function attach() {
    if (!host.isConnected && document.documentElement)
      document.documentElement.append(host);
  }
  attach();
  new MutationObserver(attach).observe(document, {
    childList: true,
    subtree: true,
  });

  function pauseMedia() {
    document.querySelectorAll("video,audio").forEach((media) => media.pause());
  }
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  document.addEventListener(
    "play",
    () => {
      if (dialog.open) pauseMedia();
    },
    true,
  );

  async function send(type, extra = {}) {
    if (disconnected)
      throw new Error(
        "The extension was updated. Reload this page to continue.",
      );
    try {
      const response = await chrome.runtime.sendMessage({ type, ...extra });
      if (!response?.ok) {
        const error = new Error(
          response?.error || "Unable to check your limits.",
        );
        error.code = response?.code;
        throw error;
      }
      return response.data;
    } catch (error) {
      if (!chrome.runtime?.id || /context invalidated/i.test(error.message))
        disconnected = true;
      throw error;
    }
  }

  function showToast(title, detail, clock = null) {
    clearTimeout(toastTimer);
    toastClock = clock;
    const close = element("button", "×");
    close.setAttribute("aria-label", "Dismiss warning");
    close.onclick = () => {
      const dismissed = toastClock;
      toast.hidden = true;
      toastClock = null;
      if (dismissed?.key) {
        warned.add(dismissed.key);
        send("DISMISS_WARNING", {
          ruleId: dismissed.id,
          clock: dismissed.session ? "session" : "daily",
          warningKey: dismissed.key,
        })
          .then((result) => {
            if (status)
              status.dismissedWarningKeys = result.dismissedWarningKeys;
          })
          .catch(() => {});
      }
    };
    const heading = element("strong", title);
    if (clock) {
      heading.setAttribute("role", "timer");
      heading.setAttribute("aria-live", "off");
      heading.setAttribute(
        "aria-label",
        clock.session ? "Session countdown" : "Daily countdown",
      );
      clock.node = heading;
    }
    toast.replaceChildren(close, heading, element("span", detail));
    toast.hidden = false;
    if (!clock)
      toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, 10000);
  }

  function updateTimeLimit(result) {
    const input = dialog.querySelector("#intentional-minutes");
    if (!input || !result.timeChoice) return;
    const max = result.timeChoice.max;
    input.max = String(max);
    input.setCustomValidity(
      Number(input.value) > max ? `Choose at most ${max} whole minutes.` : "",
    );
    dialog.querySelector("#intentional-max").textContent = `Max ${max} min`;
  }

  function buildGate(result, chooseExtra = false) {
    const blocked = result.kind === "blocked";
    const overriding = blocked && result.canOverride && chooseExtra;
    const rules = result.rules
      .filter((rule) => (blocked ? rule.locked : rule.needsIntention))
      .sort((a, b) => b.path.length - a.path.length);
    const expired = !blocked && rules.some((rule) => rule.sessionExpired);
    const card = element("section", "", "card");
    const header = element("div", "", "gate-header");
    header.append(
      element("div", "◒  Intentional", "brand"),
      element("span", location.hostname, "gate-site"),
    );
    const title = element(
      "h1",
      blocked
        ? overriding
          ? "Choose extra time."
          : "Daily limit reached."
        : expired
          ? "Time to check in."
          : "What brings you here?",
    );
    title.id = "intentional-title";
    card.append(header, title);
    const note = rules.find((rule) => rule.message);
    if (note) {
      const message = element("p", note.message, "reminder message-note");
      message.style.color = note.messageColor;
      card.append(message);
    } else if (blocked)
      card.append(
        element("p", "You’ve used your daily allowance.", "reminder"),
      );
    const leave = element(
      "button",
      "Leave",
      blocked && !overriding ? "primary" : "secondary",
    );
    leave.type = "button";
    leave.onclick = () =>
      send("LEAVE").catch(() => location.replace("about:blank"));
    if (blocked && !overriding) {
      card.append(
        element("p", "Resets at midnight.", "previous-reason"),
        leave,
      );
      if (result.canOverride) {
        const extra = element("button", "Choose extra time", "secondary");
        extra.type = "button";
        extra.onclick = () => {
          if (status?.kind === "blocked" && status.canOverride)
            buildGate(status, true);
        };
        card.append(extra);
      }
    } else {
      const form = document.createElement("form");
      const reasonRequired =
        overriding || rules.some((rule) => rule.requireReason);
      let reason;
      let minutes;
      if (overriding)
        card.append(
          element(
            "p",
            rules
              .map(
                (rule) =>
                  `Override #${rule.overrideAttempt + 1}${rules.length > 1 ? ` · ${rule.label}` : ""}`,
              )
              .join(" · "),
            "override-label",
          ),
        );
      if (reasonRequired) {
        const label = element("label", "Reason");
        label.htmlFor = "intentional-reason";
        form.append(label);
        reason = document.createElement("textarea");
        reason.id = "intentional-reason";
        reason.required = true;
        reason.minLength = 3;
        reason.maxLength = 500;
        reason.rows = 2;
        reason.value =
          rules.find((rule) => rule.previousReason)?.previousReason || "";
        form.append(reason);
        const hints = element("div", "", "reason-hints");
        hints.setAttribute("role", "group");
        hints.setAttribute("aria-label", "Suggested reasons");
        hints.hidden = true;
        const showHints = (event) => {
          if (event?.isComposing) return;
          const typed = reason.value.trim().toLocaleLowerCase();
          hints.replaceChildren();
          const matches = typed
            ? (result.reasonPresets || []).filter((preset) => {
                const text = preset.toLocaleLowerCase();
                return text.startsWith(typed) && text !== typed;
              })
            : [];
          for (const preset of matches) {
            const hint = element("button", preset, "reason-hint");
            hint.type = "button";
            hint.setAttribute("aria-label", `Use reason: ${preset}`);
            hint.onclick = () => {
              reason.value = preset;
              hints.hidden = true;
              reason.focus();
            };
            hints.append(hint);
          }
          hints.hidden = !matches.length;
        };
        reason.addEventListener("input", showHints);
        reason.addEventListener("compositionend", showHints);
        form.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && !hints.hidden) {
            event.preventDefault();
            event.stopPropagation();
            hints.hidden = true;
            reason.focus();
          }
        });
        form.append(hints);
      }
      const remainder = result.timeChoice.max === 0;
      if (!remainder) {
        const label = element("label", "Time");
        label.htmlFor = "intentional-minutes";
        const row = element("div", "", "time-row");
        const field = element("div", "", "time-input");
        minutes = document.createElement("input");
        minutes.id = "intentional-minutes";
        minutes.setAttribute("aria-label", "Time in minutes");
        minutes.setAttribute("aria-describedby", "intentional-max");
        minutes.type = "number";
        minutes.min = String(result.timeChoice.min);
        minutes.step = "1";
        minutes.required = true;
        minutes.value = String(result.timeChoice.default);
        minutes.oninput = () => updateTimeLimit(status || result);
        const suffix = element("span", "min");
        suffix.setAttribute("aria-hidden", "true");
        field.append(minutes, suffix);
        const max = element("span", "", "time-max");
        max.id = "intentional-max";
        row.append(field, max);
        form.append(label, row);
      }
      const error = element("p", "", "error");
      error.setAttribute("role", "alert");
      const submit = element(
        "button",
        remainder
          ? `Use remaining ${Math.ceil(result.timeChoice.availableMs / 1000)} sec`
          : "Continue",
        "primary",
      );
      submit.type = "submit";
      form.append(error, submit, leave);
      if (overriding) {
        const back = element("button", "Back", "secondary");
        back.type = "button";
        back.onclick = () => buildGate(status);
        form.append(back);
      }
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          apply(
            await send(overriding ? "OVERRIDE" : "APPROVE", {
              reason: reason?.value || "",
              minutes: minutes?.value || null,
              useRemaining: remainder,
            }),
          );
        } catch (failure) {
          error.textContent = failure.message;
          submit.disabled = false;
        }
      };
      card.append(form);
    }
    dialog.replaceChildren(card);
    updateTimeLimit(result);
    attach();
    if (!dialog.open) dialog.showModal();
    pauseMedia();
    dialog.querySelector("textarea,input,button")?.focus();
  }

  function apply(result) {
    status = result;
    receivedAt = Date.now();
    const next = JSON.stringify([
      result.kind,
      result.reasonPresets,
      result.rules.map((rule) => [
        rule.id,
        rule.message,
        rule.messageColor,
        rule.requireReason,
        rule.requireSession,
        rule.lockReason,
        rule.needsIntention,
        rule.sessionExpired,
        rule.overrideAttempt,
        rule.preventOverrides,
        result.timeChoice?.max === 0,
      ]),
    ]);
    if (result.kind === "blocked" || result.kind === "prompt") {
      chip.hidden = true;
      toast.hidden = true;
      toastClock = null;
      if (signature !== next || !dialog.open) buildGate(result);
    } else {
      if (dialog.open) dialog.close();
      chip.hidden = result.kind !== "allowed";
      if (chip.hidden) {
        toast.hidden = true;
        toastClock = null;
      }
    }
    signature = next;
    updateTimeLimit(result);
    updateClock();
  }

  function remaining(rule, session = false) {
    const elapsed = Date.now() - receivedAt;
    return Math.max(
      0,
      (session ? rule.sessionRemainingMs : rule.remainingMs) -
        (session || status.active ? elapsed : 0),
    );
  }

  function updateClock() {
    if (status?.kind !== "allowed") return;
    const left = Math.min(
      ...status.rules.flatMap((rule) => [
        ...(!rule.overrideActive ? [remaining(rule)] : []),
        ...(rule.sessionRemainingMs !== null ? [remaining(rule, true)] : []),
      ]),
    );
    chip.textContent = `◒  ${time(left)} left`;
    const clocks = status.rules
      .flatMap((rule) => [
        ...(status.active && !rule.dailyReached
          ? [{ rule, session: false, value: remaining(rule) }]
          : []),
        ...(rule.sessionRemainingMs !== null
          ? [{ rule, session: true, value: remaining(rule, true) }]
          : []),
      ])
      .filter(
        (clock) =>
          clock.value > 0 && clock.value <= clock.rule.warningThresholdMs,
      )
      .sort((a, b) => a.value - b.value);
    const clock = clocks[0];
    if (clock && !document.hidden) {
      const key = clock.rule.warningKeys?.[clock.session ? "session" : "daily"];
      if (
        key &&
        !warned.has(key) &&
        !status.dismissedWarningKeys?.includes(key)
      ) {
        warned.add(key);
        showToast(`${time(clock.value)} left`, "Wrap up your current work.", {
          id: clock.rule.id,
          session: clock.session,
          key,
        });
      }
    }
    if (toastClock) {
      const rule = status.rules.find((rule) => rule.id === toastClock.id);
      const value = rule ? remaining(rule, toastClock.session) : 0;
      if (
        !rule ||
        value <= 0 ||
        value > rule.warningThresholdMs ||
        status.dismissedWarningKeys?.includes(toastClock.key)
      ) {
        toast.hidden = true;
        toastClock = null;
      } else toastClock.node.textContent = `${time(value)} left`;
    }
    if (left === 0 && !pending) check("HEARTBEAT");
  }

  chip.onclick = () =>
    showToast(
      "Your time, at a glance",
      status.rules
        .map(
          (rule) =>
            `${rule.label}: ${rule.overrideActive ? "daily limit reached" : `${time(remaining(rule))} daily`}${rule.sessionRemainingMs !== null ? `, ${time(remaining(rule, true))} session` : ""}`,
        )
        .join(" · "),
    );

  function showDisconnected() {
    status = null;
    chip.hidden = true;
    toast.hidden = true;
    toastClock = null;
    const card = element("section", "", "card");
    const title = element("h1", "Please reload this page.");
    title.id = "intentional-title";
    const reload = element("button", "Reload page", "primary");
    reload.onclick = () => location.reload();
    const leave = element("button", "Leave this page", "secondary");
    leave.onclick = () => location.replace("about:blank");
    card.append(
      element("div", "◒  Intentional", "brand"),
      title,
      element("p", "Reload to reconnect Intentional.", "reminder"),
      reload,
      leave,
    );
    dialog.replaceChildren(card);
    attach();
    if (!dialog.open) dialog.showModal();
    pauseMedia();
    reload.focus();
  }

  async function check(type = "HEARTBEAT") {
    if (busy || disconnected) return;
    busy = true;
    pending = true;
    try {
      apply(await send(type));
    } catch (error) {
      if (["STALE_DOCUMENT", "INVALID_PAGE"].includes(error.code)) return;
      if (disconnected) showDisconnected();
      else showToast("Unable to check your limits", error.message);
    } finally {
      busy = false;
      pending = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATUS") apply(message.status);
  });
  document.addEventListener("visibilitychange", () => check());
  addEventListener("pageshow", () => check("VISIT"));
  setInterval(() => {
    if (lastUrl !== location.href) {
      lastUrl = location.href;
      check("VISIT");
    }
    updateClock();
  }, 500);
  setInterval(() => {
    if (!document.hidden) check();
  }, 5000);
  check("VISIT");
})();
