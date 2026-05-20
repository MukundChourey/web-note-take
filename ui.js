// AuraNotes Lightweight Webpage UI Element Injections (Strictly XSS-Safe)

const AuraNotesUI = {
  /**
   * Safely creates the global hover highlighter overlay.
   * @returns {HTMLDivElement}
   */
  createHighlighter() {
    const div = document.createElement('div');
    div.className = 'auranotes-highlighter';
    div.style.display = 'none';
    return div;
  },

  /**
   * Safely creates a circular annotation indicator pin on page.
   * @param {number} index
   * @param {Function} onClick
   * @returns {HTMLDivElement}
   */
  createPin(index, onClick) {
    const pin = document.createElement('div');
    pin.className = 'auranotes-pin';
    pin.textContent = index.toString();
    
    pin.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    
    return pin;
  }
};
