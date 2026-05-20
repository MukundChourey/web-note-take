// AuraNotes DOM Utilities for Content Scripts

const AuraNotesDOM = {
  /**
   * Detects if a given ID string looks dynamically generated (e.g. by CSS-in-JS, React, or build-time toolchains).
   * @param {string} id
   * @returns {boolean}
   */
  isDynamicId(id) {
    if (!id) return true;
    // Numeric or starting with numeric (invalid/dynamic)
    if (/^\d/.test(id)) return true;
    // Typical auto-generated patterns: e.g., "react-...", "ember...", "vue-...", "id-...", "val-..."
    if (/^(react|ember|vue|angular|id|val|__next|__nuxt|__grid|aria-|tab-)/i.test(id)) return true;
    // Contains random looking hashes (e.g., e328f, 8a8f923)
    if (/[a-f0-9]{6,}/i.test(id)) return true;
    // Contains dynamic character formats like colon/brackets/colons
    if (/[:[\]]/.test(id)) return true;
    return false;
  },

  /**
   * Detects if a class name looks dynamically generated (e.g., obfuscated CSS-in-JS, highly specific Tailwind classes).
   * @param {string} className
   * @returns {boolean}
   */
  isDynamicClass(className) {
    if (!className) return true;
    // Dynamic build hashes or CSS-in-JS: contains both letters and numbers, length > 12
    if (/[a-zA-Z]/.test(className) && /\d/.test(className) && className.length > 10) return true;
    // Tailwind utility classes (e.g., "w-[20px]", "md:hover:bg-red-200", "p-4", "grid-cols-3") are stable but identical across many elements.
    // We exclude them from class name selectors because they don't assist uniqueness and lead to bloated selectors.
    if (/^(w-|h-|p-|m-|bg-|text-|grid-|flex-|border-|shadow-|hover:|focus:|active:|md:|lg:|sm:)/.test(className)) return true;
    // Cryptic hashes (e.g. "css-12fx9a", "sc-bczRLJ")
    if (/^(css-|sc-|styled|styled-)/i.test(className)) return true;
    // Too long or contains cryptic characters
    if (className.length > 24) return true;
    return false;
  },

  /**
   * Calculates a highly robust, unique CSS selector path for a specific DOM element.
   * Walks up the DOM tree, utilizing stable identifiers first, then tags/classes, and falls back to :nth-child().
   * @param {HTMLElement} element
   * @returns {string}
   */
  getUniqueSelector(element) {
    if (!(element instanceof HTMLElement)) return "";
    
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tagName = current.tagName.toLowerCase();

      // HTML or BODY can terminate the selector chain safely
      if (tagName === 'html' || tagName === 'body') {
        path.unshift(tagName);
        break;
      }

      // 1. Check for a stable ID
      const id = current.getAttribute('id');
      if (id && !this.isDynamicId(id)) {
        // Confirm uniqueness in page
        try {
          const escapedId = CSS.escape(id);
          if (document.querySelectorAll(`#${escapedId}`).length === 1) {
            path.unshift(`#${escapedId}`);
            break; // Unique ID found, stop traversal
          }
        } catch (err) {
          // Safe fallback if escaping fails
        }
      }

      // 2. Check for high-stability attributes
      let attributeSelector = "";
      const stableAttrs = ['name', 'aria-label', 'data-testid', 'data-qa', 'data-uid', 'role'];
      for (const attr of stableAttrs) {
        const val = current.getAttribute(attr);
        if (val) {
          attributeSelector = `[${attr}="${CSS.escape(val)}"]`;
          break;
        }
      }

      // 3. Filter and combine class names
      const classList = Array.from(current.classList);
      const stableClasses = classList
        .filter(c => !this.isDynamicClass(c))
        .map(c => `.${CSS.escape(c)}`);

      let selectorToken = tagName;
      if (attributeSelector) {
        selectorToken += attributeSelector;
      } else if (stableClasses.length > 0) {
        selectorToken += stableClasses.join('');
      }

      // 4. Validate uniqueness or add sibling positioning fallbacks
      const parent = current.parentElement;
      if (parent) {
        // Query selector siblings matching our token
        let siblings;
        try {
          siblings = Array.from(parent.querySelectorAll(`:scope > ${selectorToken}`));
        } catch (e) {
          siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tagName);
        }

        if (siblings.length > 1) {
          // Duplicate sibling tags exist, calculate :nth-child relative to parent
          const index = Array.from(parent.children).indexOf(current) + 1;
          selectorToken += `:nth-child(${index})`;
        }
      }

      path.unshift(selectorToken);
      
      // Test if path matches uniquely so far
      try {
        const currentSelector = path.join(' > ');
        if (document.querySelectorAll(currentSelector).length === 1) {
          break; // Unique selector achieved, terminate early
        }
      } catch (e) {
        // Safe fallback
      }

      current = current.parentElement;
    }

    return path.join(' > ');
  },

  /**
   * Safely retrieves the absolute viewport-relative coordinates of a DOM element.
   * Accounts for document scroll offsets.
   * @param {HTMLElement} element
   * @returns {{top: number, left: number, width: number, height: number}}
   */
  getElementPosition(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height
    };
  }
};
