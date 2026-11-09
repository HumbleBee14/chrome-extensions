import { openSettings, leavePage, request } from "./shared.js";

document.getElementById("settings").onclick = () => openSettings();
document.getElementById("leave").onclick = leavePage;

document.getElementById("disable-guard").onclick = async () => {
  const button = document.getElementById("disable-guard");
  button.disabled = true;
  try {
    await request("SET_STRICT", { enabled: false });
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.update(tab.id, { url: "chrome://extensions/" });
  } catch (error) {
    const message = document.getElementById("error");
    message.textContent = error.message;
    message.hidden = false;
    button.disabled = false;
  }
};
