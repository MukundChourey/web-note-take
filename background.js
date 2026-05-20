// Background Service Worker for AuraNotes

// Set the native Side Panel behavior to open when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("AuraNotes Background: Error setting panel behavior", error));

// Initialize storage schema on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("AuraNotes: In-Context DOM Annotator Extension Installed successfully.");
  
  // Initialize default settings
  chrome.storage.local.set({
    extensionSettings: {
      darkMode: true,
      defaultUser: "User_" + Math.floor(1000 + Math.random() * 9000)
    }
  });
});

// Keep track of active tab states (optional, but useful for debugging/coordination)
const activeTabStates = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  
  switch (message.action) {
    case "GET_INSPECTOR_STATE":
      sendResponse({ enabled: activeTabStates[message.tabId] || false });
      break;
      
    case "SET_INSPECTOR_STATE":
      const targetTabId = message.tabId || (sender.tab ? sender.tab.id : null);
      if (targetTabId) {
        activeTabStates[targetTabId] = message.enabled;
        // Broadcast to the specific tab content script
        chrome.tabs.sendMessage(targetTabId, { 
          action: "TOGGLE_INSPECTOR", 
          enabled: message.enabled 
        });
      }
      sendResponse({ success: true });
      break;
      
    case "ANNOTATION_ADDED":
      console.log(`Annotation added on tab ${tabId} for URL: ${sender.url}`);
      sendResponse({ success: true });
      break;

    default:
      return false;
  }
  return true; // Keep channel open for asynchronous sendResponse
});
