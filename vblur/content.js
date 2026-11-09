// Function to inject CSS into the page
function injectStyles(blurLevel, addOverlay, hideControls) {
  // Remove any existing style tag added by the extension
  const existingStyle = document.getElementById("video-blur-extension-styles");
  if (existingStyle) {
    existingStyle.remove();
  }

  // Build the new CSS
  const styleContent = `
    ${
      hideControls
        ? `
    /* Apply blur to the container (hides controls) */
    #player.style-scope.ytd-watch-flexy,
    #player-full-bleed-container.style-scope.ytd-watch-flexy {
      position: relative;
      filter: blur(${blurLevel}px) !important;
    }
    `
        : `
    /* Apply blur to the video element (shows controls) */
    video {
      filter: blur(${blurLevel}px) !important;
      pointer-events: auto; /* Ensure controls remain functional */
    }
    `
    }

    /* Add gradient overlay using ::after */
    ${
      addOverlay
        ? `
    #player.style-scope.ytd-watch-flexy::after,
    #player-full-bleed-container.style-scope.ytd-watch-flexy::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(270deg, rgba(249, 54, 166, .3), rgba(120, 75, 160, .35), rgba(43, 134, 197, 0.3), rgba(245, 197, 94, .41), rgba(255, 60, 172, 0.3));
      background-size: 400% 400%;
      z-index: 150;
      pointer-events: none; /* Allow interaction with video controls */
      animation: movingGradient 11s ease infinite;
    }

    /* Define the gradient animation */
    @keyframes movingGradient {
      0% {
        background-position: 0% 50%;
      }
      25% {
        background-position: 50% 100%;
      }
      50% {
        background-position: 100% 50%;
      }
      75% {
        background-position: 50% 0%;
      }
      100% {
        background-position: 0% 50%;
      }
    }
    `
        : ""
    }
  `;

  // Create a new style tag
  const styleTag = document.createElement("style");
  styleTag.id = "video-blur-extension-styles";
  styleTag.textContent = styleContent;

  // Append the style tag to the head
  document.head.appendChild(styleTag);
}

// Apply saved settings on page load
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["blurLevel", "addOverlay", "hideControls"], (data) => {
    const blurLevel = data.blurLevel || 0;
    const addOverlay = data.addOverlay || false;
    const hideControls = data.hideControls || false;

    injectStyles(blurLevel, addOverlay, hideControls); // Inject both blur and overlay styles
  });
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { blurLevel, addOverlay, hideControls } = request;

  if (blurLevel !== undefined || addOverlay !== undefined || hideControls !== undefined) {
    chrome.storage.local.get(["blurLevel", "addOverlay", "hideControls"], (data) => {
      const updatedBlurLevel = blurLevel !== undefined ? blurLevel : data.blurLevel || 0;
      const updatedAddOverlay = addOverlay !== undefined ? addOverlay : data.addOverlay || false;
      const updatedHideControls = hideControls !== undefined ? hideControls : data.hideControls || false;

      injectStyles(updatedBlurLevel, updatedAddOverlay, updatedHideControls); // Inject updated styles
    });

    sendResponse({ status: "Styles updated!" });
  }
});
