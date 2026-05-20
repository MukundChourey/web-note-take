// AuraNotes Storage Utilities for Content Scripts

const AuraNotesStorage = {
  /**
   * Compute a robust key combining origin and path, stripping trailing slashes to avoid duplicates.
   * @returns {string}
   */
  getPageKey() {
    let path = window.location.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return window.location.origin + path;
  },

  /**
   * Get current username from settings or generate a fallback.
   * @returns {Promise<string>}
   */
  async getActiveUser() {
    try {
      const res = await chrome.storage.local.get("extensionSettings");
      if (res.extensionSettings && res.extensionSettings.defaultUser) {
        return res.extensionSettings.defaultUser;
      }
    } catch (e) {
      console.error("AuraNotes: Error getting active user, using fallback", e);
    }
    return "User_" + Math.floor(1000 + Math.random() * 9000);
  },

  /**
   * Get all annotations (bifurcated elementAnnotations and globalNotes) saved for current page.
   * Performs automatic backward-compatible migration if old flat schema is detected.
   * @returns {Promise<{elementAnnotations: Array, globalNotes: Array}>}
   */
  async getAnnotationsForCurrentPage() {
    const key = this.getPageKey();
    try {
      const data = await chrome.storage.local.get(key);
      let raw = data[key];

      if (!raw) {
        return { elementAnnotations: [], globalNotes: [] };
      }

      // Migration Layer: convert old flat array of annotations to bifurcated schema
      if (Array.isArray(raw)) {
        raw = {
          elementAnnotations: raw,
          globalNotes: []
        };
        // Sync back to local storage immediately
        await chrome.storage.local.set({ [key]: raw });
      } else {
        // Guarantee fields exist
        if (!raw.elementAnnotations) raw.elementAnnotations = [];
        if (!raw.globalNotes) raw.globalNotes = [];
      }

      return raw;
    } catch (e) {
      console.error("AuraNotes: Error retrieving annotations for current page", e);
      return { elementAnnotations: [], globalNotes: [] };
    }
  },

  /**
   * Save a new annotation (either element pin or global note).
   * @param {Object} annotation
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async saveAnnotation(annotation) {
    const key = this.getPageKey();
    try {
      const dataObj = await this.getAnnotationsForCurrentPage();
      const isGlobal = !annotation.selector;

      // Generate unique ID if missing
      if (!annotation.id) {
        const prefix = isGlobal ? "global_" : "note_";
        annotation.id = prefix + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
      }

      if (isGlobal) {
        dataObj.globalNotes.push(annotation);
      } else {
        dataObj.elementAnnotations.push(annotation);
      }

      await chrome.storage.local.set({ [key]: dataObj });

      // Notify runtime orchestrator
      chrome.runtime.sendMessage({ action: "ANNOTATION_ADDED", annotation, isGlobal });

      return dataObj;
    } catch (e) {
      console.error("AuraNotes: Error saving annotation", e);
      throw e;
    }
  },

  /**
   * Update an existing annotation in either elementAnnotations or globalNotes.
   * @param {string} id
   * @param {Object} updatedFields
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async updateAnnotation(id, updatedFields) {
    const key = this.getPageKey();
    try {
      const dataObj = await this.getAnnotationsForCurrentPage();
      
      // Try to update in elementAnnotations first
      let index = dataObj.elementAnnotations.findIndex(item => item.id === id);
      if (index !== -1) {
        dataObj.elementAnnotations[index] = { ...dataObj.elementAnnotations[index], ...updatedFields };
      } else {
        // Try to update in globalNotes
        index = dataObj.globalNotes.findIndex(item => item.id === id);
        if (index !== -1) {
          dataObj.globalNotes[index] = { ...dataObj.globalNotes[index], ...updatedFields };
        }
      }

      if (index !== -1) {
        await chrome.storage.local.set({ [key]: dataObj });
      }

      return dataObj;
    } catch (e) {
      console.error(`AuraNotes: Error updating annotation with ID ${id}`, e);
      throw e;
    }
  },

  /**
   * Delete an annotation from either elementAnnotations or globalNotes.
   * @param {string} id
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async deleteAnnotation(id) {
    const key = this.getPageKey();
    try {
      const dataObj = await this.getAnnotationsForCurrentPage();
      dataObj.elementAnnotations = dataObj.elementAnnotations.filter(item => item.id !== id);
      dataObj.globalNotes = dataObj.globalNotes.filter(item => item.id !== id);

      await chrome.storage.local.set({ [key]: dataObj });
      return dataObj;
    } catch (e) {
      console.error(`AuraNotes: Error deleting annotation with ID ${id}`, e);
      throw e;
    }
  },

  /**
   * Add a nested discussion comment to a specific question inside any annotation.
   * @param {string} annotationId
   * @param {string} questionId
   * @param {string} commentText
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async addComment(annotationId, questionId, commentText) {
    const dataObj = await this.getAnnotationsForCurrentPage();
    const annotation = dataObj.elementAnnotations.find(item => item.id === annotationId) || 
                       dataObj.globalNotes.find(item => item.id === annotationId);
    if (!annotation) return dataObj;

    const question = annotation.questions.find(q => q.id === questionId);
    if (!question) return dataObj;

    const currentUser = await this.getActiveUser();
    
    const newComment = {
      id: "comment_" + Date.now() + "_" + Math.random().toString(36).substring(2, 5),
      user: currentUser,
      text: commentText,
      timestamp: Date.now()
    };

    question.comments.push(newComment);
    return await this.updateAnnotation(annotationId, { questions: annotation.questions });
  },

  /**
   * Add a new question to a specific annotation.
   * @param {string} annotationId
   * @param {string} questionText
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async addQuestion(annotationId, questionText) {
    const dataObj = await this.getAnnotationsForCurrentPage();
    const annotation = dataObj.elementAnnotations.find(item => item.id === annotationId) || 
                       dataObj.globalNotes.find(item => item.id === annotationId);
    if (!annotation) return dataObj;

    const newQuestion = {
      id: "question_" + Date.now() + "_" + Math.random().toString(36).substring(2, 5),
      text: questionText,
      resolved: false,
      comments: []
    };

    annotation.questions = annotation.questions || [];
    annotation.questions.push(newQuestion);
    return await this.updateAnnotation(annotationId, { questions: annotation.questions });
  },

  /**
   * Toggle resolution status of a question.
   * @param {string} annotationId
   * @param {string} questionId
   * @param {boolean} resolved
   * @returns {Promise<Object>} Updated bifurcated data object
   */
  async toggleQuestionResolve(annotationId, questionId, resolved) {
    const dataObj = await this.getAnnotationsForCurrentPage();
    const annotation = dataObj.elementAnnotations.find(item => item.id === annotationId) || 
                       dataObj.globalNotes.find(item => item.id === annotationId);
    if (!annotation) return dataObj;

    const question = annotation.questions.find(q => q.id === questionId);
    if (!question) return dataObj;

    question.resolved = resolved;
    return await this.updateAnnotation(annotationId, { questions: annotation.questions });
  }
};
