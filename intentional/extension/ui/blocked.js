import { request, openSettings, leavePage } from "./shared.js";

const $ = (id) => document.getElementById(id);
$("leave").onclick = leavePage;
$("settings").onclick = () => openSettings();
try {
  const data = await request("DASHBOARD");
  const id = new URL(location.href).searchParams.get("rule");
  const rule = data.rules.find((item) => item.id === id);
  if (rule) {
    $("scope").hidden = false;
    $("scope").textContent = rule.label;
    if (rule.message) {
      $("message").style.color = rule.messageColor;
      $("message").classList.add("message-note");
    }
    if (!rule.locked || rule.canOverride) {
      $("title").textContent = rule.overrideActive
        ? "Extra time active."
        : rule.canOverride
          ? "Daily limit reached."
          : "Your time has reset.";
      $("retry").textContent = "Open website";
      $("retry").hidden = false;
      $("retry").onclick = async () => {
        const tab = await chrome.tabs.getCurrent();
        await chrome.tabs.update(tab.id, { url: `https://${rule.target}` });
      };
    }
    $("message").textContent = !rule.locked
      ? rule.overrideActive
        ? "Your extra time is active."
        : "This limit has reset. You can open the website again."
      : rule.message || "You’ve used the time you set aside for this.";
  }
} catch {
  $("message").textContent =
    "This page was blocked by a limit you set. Open your limits to see the details.";
}
