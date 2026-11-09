// Handle dynamic blur
document.getElementById("blur-level").addEventListener("input", () => {
  const blurLevel = document.getElementById("blur-level").value;

  // Save the blur level
  chrome.storage.local.set({ blurLevel });

  // Send the blur level to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { blurLevel });
  });
});

// Handle overlay toggle
document.getElementById("color-overlay").addEventListener("change", (event) => {
  const addOverlay = event.target.checked;

  // Save overlay state
  chrome.storage.local.set({ addOverlay });

  // Send the overlay state to content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { addOverlay });
  });
});

// Handle the new "Overlay Mode (Hide Controls)" toggle
document.getElementById("hide-controls").addEventListener("change", (event) => {
  const hideControls = event.target.checked;

  // Save the state to chrome.storage
  chrome.storage.local.set({ hideControls });

  // Send the state to the content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { hideControls });
  });
});

// Restore UI state when popup opens
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["blurLevel", "addOverlay", "hideControls"], (data) => {
    // Set slider to saved blur level
    document.getElementById("blur-level").value = data.blurLevel || 0;

    // Set overlay checkbox to saved state
    document.getElementById("color-overlay").checked = data.addOverlay || false;

    // Set the "Hide Controls" checkbox to saved state
    document.getElementById("hide-controls").checked = data.hideControls || false;
  });
});
