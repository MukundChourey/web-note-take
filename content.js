// AuraNotes Lightweight Webpage Injection Script

(function () {
  if (window.AuraNotesInjected) return;
  window.AuraNotesInjected = true;

  let isInspectorActive = false;
  let currentHoveredElement = null;
  let activeHighlighter = null;
  
  // Store references to active DOM Pin markers on page
  let activePins = [];
  let currentPageData = { elementAnnotations: [], globalNotes: [] };

  // Initialize Orchestrator
  function init() {
    setupHighlighter();
    setupMessageListeners();
    loadPageAnnotations();
    setupViewportListeners();
    setupSPAListeners();
  }

  // --- 1. SCAFFOLD HOVER HIGHLIGHTER ---
  function setupHighlighter() {
    activeHighlighter = AuraNotesUI.createHighlighter();
    document.body.appendChild(activeHighlighter);
  }

  // --- 2. RUNTIME MESSAGE ROUTING WITH SIDE PANEL ---
  function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case "PING":
          sendResponse({ success: true, status: "PONG" });
          break;

        case "TOGGLE_INSPECTOR":
          toggleInspectorMode(message.enabled);
          sendResponse({ success: true });
          break;

        case "REFRESH_PINS":
          // Triggered by Side Panel when notes are added/modified/deleted
          loadPageAnnotations();
          sendResponse({ success: true });
          break;

        case "FOCUS_ANNOTATION":
          // Focus/Scroll page DOM to pinpoint element pin
          scrollAndFocusPin(message.annotationId);
          sendResponse({ success: true });
          break;

        default:
          break;
      }
    });
  }

  // --- 3. ELEMENT INSPECTOR MODE AND CLICK HIJACKS ---
  function toggleInspectorMode(enable) {
    isInspectorActive = enable;
    
    if (enable) {
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleMouseClick, true);
      document.body.style.cursor = 'crosshair';
    } else {
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleMouseClick, true);
      document.body.style.cursor = 'default';
      if (activeHighlighter) {
        activeHighlighter.style.display = 'none';
      }
      currentHoveredElement = null;
    }
  }

  function handleMouseMove(e) {
    if (!isInspectorActive) return;

    const target = e.target;
    if (!target) return;

    // Avoid loop highlights on highlighter box itself
    if (target.closest('.auranotes-pin') || 
        target.closest('.auranotes-highlighter')) {
      if (activeHighlighter) activeHighlighter.style.display = 'none';
      return;
    }

    if (target === currentHoveredElement) return;
    currentHoveredElement = target;

    const pos = AuraNotesDOM.getElementPosition(target);
    if (activeHighlighter) {
      activeHighlighter.style.top = `${pos.top}px`;
      activeHighlighter.style.left = `${pos.left}px`;
      activeHighlighter.style.width = `${pos.width}px`;
      activeHighlighter.style.height = `${pos.height}px`;
      activeHighlighter.style.display = 'block';
    }
  }

  function handleMouseClick(e) {
    if (!isInspectorActive) return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    if (!target) return;

    if (target.closest('.auranotes-pin') || 
        target.closest('.auranotes-highlighter')) {
      return;
    }

    // Stop Inspector Mode
    toggleInspectorMode(false);
    currentHoveredElement = target;

    // Notify Side Panel of inspect cancellation state sync
    chrome.runtime.sendMessage({ action: "SET_INSPECTOR_STATE", enabled: false });

    // Generate CSS Selector path
    const selector = AuraNotesDOM.getUniqueSelector(target);

    // Send selector metadata straight to the native Side Panel!
    chrome.runtime.sendMessage({
      action: "ELEMENT_SELECTED",
      selector: selector
    });
  }

  // --- 4. ANCHORED PINS INJECTIONS CONTROLLERS ---
  
  async function loadPageAnnotations() {
    clearPins();

    try {
      currentPageData = await AuraNotesStorage.getAnnotationsForCurrentPage();
    } catch (e) {
      console.warn("AuraNotes Content: Error reading storage items on reload.", e);
      return;
    }

    const elementPins = currentPageData.elementAnnotations || [];
    
    elementPins.forEach((annotation, index) => {
      let targetElement = null;
      
      try {
        targetElement = document.querySelector(annotation.selector);
      } catch (err) {
        console.warn("AuraNotes: Invalid query selector path", annotation.selector, err);
      }

      if (!targetElement) return;

      const pos = AuraNotesDOM.getElementPosition(targetElement);
      
      // Create circular indicator pin
      const pin = AuraNotesUI.createPin(index + 1, () => {
        // Pin Click: Notify native Side Panel to pivot tabs and focus detail card!
        chrome.runtime.sendMessage({
          action: "PIN_CLICKED",
          annotationId: annotation.id
        });
      });

      const pinOffset = 12;
      pin.style.left = `${pos.left + pos.width - pinOffset}px`;
      pin.style.top = `${pos.top - pinOffset}px`;

      document.body.appendChild(pin);
      activePins.push({
        element: pin,
        annotation: annotation,
        target: targetElement
      });
    });
  }

  function clearPins() {
    activePins.forEach(p => p.element.remove());
    activePins = [];
  }

  // Smooth scrolls and highlights a selected pin
  function scrollAndFocusPin(annotationId) {
    const pinObj = activePins.find(p => p.annotation.id === annotationId);
    if (pinObj) {
      pinObj.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Temporarily flash high-precision highlight box
      const pos = AuraNotesDOM.getElementPosition(pinObj.target);
      if (activeHighlighter) {
        activeHighlighter.style.top = `${pos.top}px`;
        activeHighlighter.style.left = `${pos.left}px`;
        activeHighlighter.style.width = `${pos.width}px`;
        activeHighlighter.style.height = `${pos.height}px`;
        activeHighlighter.style.display = 'block';
        
        setTimeout(() => {
          if (!isInspectorActive && activeHighlighter) {
            activeHighlighter.style.display = 'none';
          }
        }, 1200);
      }
    }
  }

  // --- 5. RESIZE RECOMPUTE VIEWPORT COORDINATES ---
  function setupViewportListeners() {
    window.addEventListener('resize', () => {
      requestAnimationFrame(repositionPins);
    });
  }

  function repositionPins() {
    activePins.forEach(pinObj => {
      if (document.body.contains(pinObj.target)) {
        const pos = AuraNotesDOM.getElementPosition(pinObj.target);
        const pinOffset = 12;
        pinObj.element.style.left = `${pos.left + pos.width - pinOffset}px`;
        pinObj.element.style.top = `${pos.top - pinOffset}px`;
      }
    });
  }

  // --- 6. SPA ROUTINGS ON PAGE TRANSITIONS ---
  function setupSPAListeners() {
    let lastUrl = window.location.href;

    window.addEventListener('popstate', () => {
      handleUrlChange();
    });

    const originalPush = history.pushState;
    history.pushState = function () {
      originalPush.apply(this, arguments);
      handleUrlChange();
    };

    const originalReplace = history.replaceState;
    history.replaceState = function () {
      originalReplace.apply(this, arguments);
      handleUrlChange();
    };

    function handleUrlChange() {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        loadPageAnnotations();
      }
    }

    let titleObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        loadPageAnnotations();
      }
    });
    titleObserver.observe(document.querySelector('head') || document.documentElement, {
      subtree: true,
      childList: true
    });
  }

  // Execute Initializations
  init();
})();
