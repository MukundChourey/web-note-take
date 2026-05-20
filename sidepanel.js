// AuraNotes Native Side Panel Workspace Controller (Strictly XSS-Safe)

document.addEventListener("DOMContentLoaded", () => {
  const inspectorToggle = document.getElementById("inspector-toggle");
  const searchInput = document.getElementById("search-input");
  const pinsList = document.getElementById("pins-list");
  const pinsCounter = document.getElementById("pins-counter");
  
  const tabPins = document.getElementById("tab-pins");
  const tabJournal = document.getElementById("tab-journal");
  const panePins = document.getElementById("pane-pins");
  const paneJournal = document.getElementById("pane-journal");
  const addPageNoteBtn = document.getElementById("add-page-note-btn");
  const pageStatus = document.getElementById("page-status");
  
  const searchBarWrapper = document.getElementById("search-bar-wrapper");
  const listSectionWrapper = document.getElementById("list-section-wrapper");
  const editorPane = document.getElementById("editor-pane");
  const sectionTitleLabel = document.getElementById("section-title-label");

  let activeTab = null;
  let activeTabUrl = "";
  let activeTabMode = "pins"; // "pins" or "journal"
  let isEditing = false;
  let searchQuery = "";
  
  // Store annotations for active webpage URL
  let pageAnnotations = { elementAnnotations: [], globalNotes: [] };

  // Override AuraNotesStorage key engine dynamically to match active browser tab webpage!
  AuraNotesStorage.getPageKey = function () {
    if (!activeTabUrl) return "";
    try {
      const url = new URL(activeTabUrl);
      let path = url.pathname;
      if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      return url.origin + path;
    } catch (e) {
      return "";
    }
  };

  // --- 1. INITIALIZE AND SYNC ACTIVE WEB PAGE CONTEXT ---
  async function initTabContext() {
    isEditing = false; // Reset editing states on page switches
    searchQuery = "";
    if (searchInput) searchInput.value = "";
    
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        activeTab = tabs[0];
        activeTabUrl = activeTab.url || "";

        if (activeTabUrl && (activeTabUrl.startsWith("http://") || activeTabUrl.startsWith("https://"))) {
          const url = new URL(activeTabUrl);
          pageStatus.textContent = url.hostname;
          enableWorkspace();
          
          // Sync Inspector check state from background trackers
          chrome.runtime.sendMessage({ 
            action: "GET_INSPECTOR_STATE", 
            tabId: activeTab.id 
          }, (response) => {
            if (response && inspectorToggle) {
              inspectorToggle.checked = response.enabled || false;
            }
          });

          // Load Page Pins and Journal Entries
          await loadPageData();
        } else {
          renderDisabledState("Cannot run AuraNotes on system pages.");
        }
      }
    } catch (err) {
      console.error("AuraNotes SidePanel: Error initializing active context", err);
      renderDisabledState("Select an active webpage tab to load workspace.");
    }
  }

  // Sync tab selection activated and url change listeners
  chrome.tabs.onActivated.addListener(async () => {
    await initTabContext();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
      await initTabContext();
    }
  });

  // --- 2. MESSAGE BRIDGE FROM LIGHTWEIGHT CONTENT SCRIPTS ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ensure the message is coming from the active tab we are inspecting
    if (!activeTab || sender.tab.id !== activeTab.id) return;

    switch (message.action) {
      case "ELEMENT_SELECTED":
        // Content script clicked on inspected component
        if (inspectorToggle) inspectorToggle.checked = false;
        openEditor(null, true, false, message.selector); // Mount element editor inside Side Panel
        break;

      case "PIN_CLICKED":
        // User clicked circular Pin marker on the page DOM
        if (activeTabMode !== "pins") {
          tabPins.click(); // Pivot view to Pins tab
        }
        const annotation = pageAnnotations.elementAnnotations.find(a => a.id === message.annotationId);
        if (annotation) {
          openEditor(annotation, false, false);
        }
        break;

      case "SET_INSPECTOR_STATE":
        // Content script cancelled inspect state manually
        if (inspectorToggle) inspectorToggle.checked = message.enabled;
        break;

      default:
        break;
    }
  });

  // --- 3. DUAL TABS NAVIGATION ---
  tabPins.addEventListener("click", () => {
    if (activeTabMode === "pins") return;
    activeTabMode = "pins";
    
    tabPins.classList.add("active");
    tabJournal.classList.remove("active");
    panePins.classList.remove("hidden");
    paneJournal.classList.add("hidden");
    
    sectionTitleLabel.textContent = "Page Pins";
    searchInput.placeholder = "Search pins on this page...";
    searchInput.value = "";
    searchQuery = "";
    
    isEditing = false;
    restoreListView();
  });

  tabJournal.addEventListener("click", () => {
    if (activeTabMode === "journal") return;
    activeTabMode = "journal";
    
    tabJournal.classList.add("active");
    tabPins.classList.remove("active");
    paneJournal.classList.remove("hidden");
    panePins.classList.add("hidden");
    
    sectionTitleLabel.textContent = "Journal Notes";
    searchInput.placeholder = "Search global journal notes...";
    searchInput.value = "";
    searchQuery = "";
    
    isEditing = false;
    restoreListView();
  });

  // --- 4. ELEMENT INSPECTOR TOGGLERS ---
  inspectorToggle.addEventListener("change", (e) => {
    const checked = e.target.checked;
    chrome.runtime.sendMessage({
      action: "SET_INSPECTOR_STATE",
      enabled: checked,
      tabId: activeTab.id
    });
  });

  // --- 5. ADD GLOBAL PAGE NOTE TRIGGERS ---
  addPageNoteBtn.addEventListener("click", () => {
    openEditor(null, true, true); // Mounts Page Journal editor
  });

  // --- 6. DATA INGEST AND LIST CARDS RENDERERS ---
  async function loadPageData() {
    if (isEditing) return; // Yield to editor card
    
    try {
      pageAnnotations = await AuraNotesStorage.getAnnotationsForCurrentPage();
      
      const targetList = activeTabMode === "pins" ? 
        pageAnnotations.elementAnnotations : pageAnnotations.globalNotes;
        
      renderActiveList(targetList);
    } catch (err) {
      console.error("AuraNotes SidePanel: Error fetching annotations", err);
    }
  }

  function renderActiveList(items) {
    pinsList.replaceChildren();
    
    pinsCounter.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "empty-icon");
      svg.setAttribute("fill", "none");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("stroke", "currentColor");
      
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-width", "1.5");
      
      if (activeTabMode === "pins") {
        path.setAttribute("d", "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z");
      } else {
        path.setAttribute("d", "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253");
      }
      svg.appendChild(path);
      
      const text = document.createElement("p");
      if (searchQuery) {
        text.textContent = "No items match your active search query.";
      } else {
        text.textContent = activeTabMode === "pins" ?
          "No pins anchored yet. Toggle Element Inspector above and click on webpage components!" :
          "Your page journal is empty. Take global summary notes or ask overview questions above!";
      }
        
      empty.appendChild(svg);
      empty.appendChild(text);
      pinsList.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "pin-item";
      
      card.addEventListener("click", () => {
        if (activeTabMode === "pins") {
          // Reroute element pins scroll-focus directly to host webpage DOM!
          chrome.tabs.sendMessage(activeTab.id, {
            action: "FOCUS_ANNOTATION",
            annotationId: item.id
          });
        }
        openEditor(item, false, activeTabMode === "journal");
      });

      const header = document.createElement("div");
      header.className = "pin-item-header";

      const idxBadge = document.createElement("span");
      idxBadge.className = "pin-item-index";
      idxBadge.textContent = (index + 1).toString();
      header.appendChild(idxBadge);

      const title = document.createElement("h4");
      title.className = "pin-item-title";
      title.textContent = item.title;
      header.appendChild(title);
      
      card.appendChild(header);

      if (item.notes) {
        const desc = document.createElement("p");
        desc.className = "pin-item-desc";
        desc.textContent = item.notes;
        card.appendChild(desc);
      }

      // Meta thread stats
      const meta = document.createElement("div");
      meta.className = "pin-item-meta";

      const questions = item.questions || [];
      const openCount = questions.filter(q => !q.resolved).length;
      const resolvedCount = questions.filter(q => q.resolved).length;

      if (questions.length > 0) {
        if (openCount > 0) {
          const openStat = document.createElement("div");
          openStat.className = "pin-meta-stat";
          const dot = document.createElement("span");
          dot.className = "stat-dot dot-open";
          openStat.appendChild(dot);
          const text = document.createElement("span");
          text.textContent = `${openCount} query`;
          openStat.appendChild(text);
          meta.appendChild(openStat);
        }
        if (resolvedCount > 0) {
          const resolvedStat = document.createElement("div");
          resolvedStat.className = "pin-meta-stat";
          const dot = document.createElement("span");
          dot.className = "stat-dot dot-resolved";
          resolvedStat.appendChild(dot);
          const text = document.createElement("span");
          text.textContent = `${resolvedCount} resolved`;
          resolvedStat.appendChild(text);
          meta.appendChild(resolvedStat);
        }
      } else {
        const stat = document.createElement("span");
        stat.textContent = "No active threads";
        meta.appendChild(stat);
      }

      card.appendChild(meta);
      pinsList.appendChild(card);
    });
  }

  // --- 7. SHARED DYNAMIC TEXT SEARCH FILTER ---
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    const targetList = activeTabMode === "pins" ? 
      pageAnnotations.elementAnnotations : pageAnnotations.globalNotes;

    if (!searchQuery) {
      renderActiveList(targetList);
      return;
    }

    const filtered = targetList.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(searchQuery);
      const notesMatch = item.notes && item.notes.toLowerCase().includes(searchQuery);
      const questionMatch = item.questions && item.questions.some(q => 
        q.text.toLowerCase().includes(searchQuery) || 
        (q.comments && q.comments.some(c => c.text.toLowerCase().includes(searchQuery)))
      );
      return titleMatch || notesMatch || questionMatch;
    });

    renderActiveList(filtered);
  });

  // --- 8. NATIVE PANEL EDITOR FRAME builders (Strictly XSS-Safe) ---
  
  /**
   * Mounts the editor screen inside the Side Panel.
   * @param {Object} item
   * @param {boolean} isNew
   * @param {boolean} isGlobal
   * @param {string} selectorFallback
   */
  function openEditor(item, isNew, isGlobal, selectorFallback) {
    isEditing = true;
    
    // Hide Lists panels
    searchBarWrapper.classList.add("hidden");
    listSectionWrapper.classList.add("hidden");
    editorPane.classList.remove("hidden");

    editorPane.replaceChildren();

    // Build inputs programmatically (No innerHTML used to prevent XSS)
    const titleGroup = document.createElement("div");
    titleGroup.className = "editor-input-group";
    const titleLabel = document.createElement("label");
    titleLabel.className = "editor-label";
    titleLabel.textContent = isGlobal ? "Page Note Title" : "Element Note Title";
    titleGroup.appendChild(titleLabel);
    
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "editor-input";
    titleInput.value = isNew ? "" : item.title;
    titleInput.placeholder = isGlobal ? "e.g. Document Architecture thoughts..." : "e.g. Submit CTA Button issue...";
    titleGroup.appendChild(titleInput);
    editorPane.appendChild(titleGroup);

    const notesGroup = document.createElement("div");
    notesGroup.className = "editor-input-group";
    const notesLabel = document.createElement("label");
    notesLabel.className = "editor-label";
    notesLabel.textContent = "Insights & Notes";
    notesGroup.appendChild(notesLabel);
    
    const notesArea = document.createElement("textarea");
    notesArea.className = "editor-input editor-textarea";
    notesArea.value = isNew ? "" : item.notes;
    notesArea.placeholder = isGlobal ? "Type global overview scratchpad notes, requirements summaries..." : "Describe components spacing, colors, dynamic states...";
    notesGroup.appendChild(notesArea);
    editorPane.appendChild(notesGroup);

    // --- NESTED DISCUSSIONS & BADGES ---
    if (!isNew) {
      const discTitle = document.createElement("h4");
      discTitle.className = "discussion-title";
      discTitle.textContent = "Discussions & Threads";
      editorPane.appendChild(discTitle);

      const discList = document.createElement("div");
      discList.className = "discussion-list";

      const questions = item.questions || [];

      if (questions.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No questions raised yet.";
        discList.appendChild(empty);
      } else {
        questions.forEach(q => {
          const qNode = document.createElement("div");
          qNode.className = "question-node";

          const header = document.createElement("div");
          header.className = "question-header";
          const text = document.createElement("span");
          text.className = "question-text";
          text.textContent = q.text;
          header.appendChild(text);

          const badge = document.createElement("span");
          badge.className = "badge " + (q.resolved ? "badge-resolved" : "badge-open");
          badge.textContent = q.resolved ? "Resolved" : "Open";
          
          // Toggle resolved action
          badge.addEventListener("click", async () => {
            const updated = await AuraNotesStorage.toggleQuestionResolve(item.id, q.id, !q.resolved);
            const activeList = isGlobal ? updated.globalNotes : updated.elementAnnotations;
            const updatedItem = activeList.find(i => i.id === item.id);
            if (updatedItem) openEditor(updatedItem, false, isGlobal);
          });
          header.appendChild(badge);
          qNode.appendChild(header);

          // Render thread comments
          if (q.comments && q.comments.length > 0) {
            const wrap = document.createElement("div");
            wrap.className = "comments-wrapper";

            q.comments.forEach(c => {
              const cNode = document.createElement("div");
              cNode.className = "comment-node";

              const cMeta = document.createElement("div");
              cMeta.className = "comment-meta";
              const user = document.createElement("span");
              user.className = "comment-user";
              user.textContent = c.user;
              cMeta.appendChild(user);
              
              const time = document.createElement("span");
              time.textContent = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              cMeta.appendChild(time);
              cNode.appendChild(cMeta);

              const val = document.createElement("div");
              val.textContent = c.text;
              cNode.appendChild(val);

              wrap.appendChild(cNode);
            });
            qNode.appendChild(wrap);
          }

          // Reply Form inside questions
          const rForm = document.createElement("div");
          rForm.className = "reply-form";

          const rInput = document.createElement("input");
          rInput.type = "text";
          rInput.className = "editor-input reply-input";
          rInput.placeholder = "Reply to thread...";
          rForm.appendChild(rInput);

          const rBtn = document.createElement("button");
          rBtn.className = "reply-btn";
          rBtn.textContent = "Reply";
          
          rBtn.addEventListener("click", async () => {
            const str = rInput.value.trim();
            if (str) {
              const updated = await AuraNotesStorage.addComment(item.id, q.id, str);
              const activeList = isGlobal ? updated.globalNotes : updated.elementAnnotations;
              const updatedItem = activeList.find(i => i.id === item.id);
              if (updatedItem) openEditor(updatedItem, false, isGlobal);
            }
          });
          rForm.appendChild(rBtn);
          qNode.appendChild(rForm);

          discList.appendChild(qNode);
        });
      }
      editorPane.appendChild(discList);

      // Form to raise new queries
      const addQGroup = document.createElement("div");
      addQGroup.className = "editor-input-group";
      const addQLabel = document.createElement("label");
      addQLabel.className = "editor-label";
      addQLabel.textContent = "Raise a New Query";
      addQGroup.appendChild(addQLabel);

      const addQForm = document.createElement("div");
      addQForm.className = "reply-form";

      const addQInput = document.createElement("input");
      addQInput.type = "text";
      addQInput.className = "editor-input reply-input";
      addQInput.placeholder = "Ask a question...";
      addQForm.appendChild(addQInput);

      const addQBtn = document.createElement("button");
      addQBtn.className = "reply-btn";
      addQBtn.textContent = "Ask";
      
      addQBtn.addEventListener("click", async () => {
        const str = addQInput.value.trim();
        if (str) {
          const updated = await AuraNotesStorage.addQuestion(item.id, str);
          const activeList = isGlobal ? updated.globalNotes : updated.elementAnnotations;
          const updatedItem = activeList.find(i => i.id === item.id);
          if (updatedItem) openEditor(updatedItem, false, isGlobal);
        }
      });
      addQForm.appendChild(addQBtn);
      addQGroup.appendChild(addQForm);
      editorPane.appendChild(addQGroup);
    }

    // --- FOOTER ACTIONS ---
    const footer = document.createElement("div");
    footer.className = "editor-footer";

    if (!isNew) {
      const delBtn = document.createElement("button");
      delBtn.className = "panel-btn panel-btn-danger";
      delBtn.style.marginRight = "auto";
      delBtn.textContent = "Delete";
      
      delBtn.addEventListener("click", async () => {
        await AuraNotesStorage.deleteAnnotation(item.id);
        
        // Tell host tab content script to refresh DOM pins marker overlays
        chrome.tabs.sendMessage(activeTab.id, { action: "REFRESH_PINS" });
        
        isEditing = false;
        restoreListView();
        loadPageData();
      });
      footer.appendChild(delBtn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "panel-btn panel-btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      isEditing = false;
      restoreListView();
      loadPageData();
    });
    footer.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.className = "panel-btn panel-btn-primary";
    saveBtn.textContent = "Save";
    
    saveBtn.addEventListener("click", async () => {
      const titleText = titleInput.value.trim() || (isGlobal ? "Untitled Page Note" : "Untitled Pin Note");
      const notesText = notesArea.value.trim();

      if (isNew) {
        const newAnnotation = {
          id: (isGlobal ? "global_" : "note_") + Date.now(),
          title: titleText,
          notes: notesText,
          questions: [],
          timestamp: Date.now()
        };

        if (!isGlobal) {
          newAnnotation.selector = selectorFallback;
        }

        await AuraNotesStorage.saveAnnotation(newAnnotation);
      } else {
        await AuraNotesStorage.updateAnnotation(item.id, {
          title: titleText,
          notes: notesText
        });
      }

      // Tell host tab content script to refresh DOM pins marker overlays
      chrome.tabs.sendMessage(activeTab.id, { action: "REFRESH_PINS" });

      isEditing = false;
      restoreListView();
      loadPageData();
    });
    footer.appendChild(saveBtn);

    editorPane.appendChild(footer);
  }

  function restoreListView() {
    editorPane.replaceChildren();
    editorPane.classList.add("hidden");
    searchBarWrapper.classList.remove("hidden");
    listSectionWrapper.classList.remove("hidden");
  }

  function enableWorkspace() {
    if (inspectorToggle) inspectorToggle.disabled = false;
    if (searchInput) searchInput.disabled = false;
    tabPins.disabled = false;
    tabJournal.disabled = false;
  }

  function renderDisabledState(message) {
    if (inspectorToggle) inspectorToggle.disabled = true;
    if (searchInput) searchInput.disabled = true;
    tabPins.disabled = true;
    tabJournal.disabled = true;
    
    pinsList.replaceChildren();
    pinsCounter.textContent = "0 items";
    
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const text = document.createElement("p");
    text.textContent = message;
    empty.appendChild(text);
    pinsList.appendChild(empty);
  }

  // Initialise Active Webpage tab load
  initTabContext();
});
