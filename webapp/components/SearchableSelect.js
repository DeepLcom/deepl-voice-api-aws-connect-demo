// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * SearchableSelect - A custom searchable dropdown component
 * Replaces standard <select> elements with a searchable interface
 */
export class SearchableSelect {
  constructor(selectElement) {
    this.originalSelect = selectElement;
    this.isOpen = false;
    this.selectedValue = selectElement.value;
    this.options = [];
    this.filteredOptions = [];
    this.highlightedIndex = -1;

    this.init();
  }

  init() {
    // Extract options from original select
    const optionElements = this.originalSelect.querySelectorAll('option');
    this.options = Array.from(optionElements).map(opt => ({
      value: opt.value,
      text: opt.textContent,
      selected: opt.selected
    })).filter(opt => opt.value !== ''); // Filter out placeholder options

    // Create the searchable select structure
    this.createSearchableSelect();

    // Hide the original select
    this.originalSelect.style.display = 'none';

    // Insert the searchable select after the original
    this.originalSelect.parentNode.insertBefore(this.container, this.originalSelect.nextSibling);

    // Set initial value
    if (this.selectedValue) {
      this.setValue(this.selectedValue);
    }
  }

  createSearchableSelect() {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'searchable-select';

    // Create selected display
    this.selectedDisplay = document.createElement('div');
    this.selectedDisplay.className = 'searchable-select-selected';
    this.selectedDisplay.textContent = this.getSelectedText() || '-- Select Language --';
    this.selectedDisplay.addEventListener('click', () => this.toggle());

    // Create dropdown arrow
    const arrow = document.createElement('span');
    arrow.className = 'searchable-select-arrow';
    arrow.textContent = '▼';
    this.selectedDisplay.appendChild(arrow);

    // Create dropdown container
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'searchable-select-dropdown';

    // Create search input
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'searchable-select-search';
    this.searchInput.placeholder = 'Search languages...';
    this.searchInput.addEventListener('input', (e) => this.filterOptions(e.target.value));
    this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Create options list
    this.optionsList = document.createElement('div');
    this.optionsList.className = 'searchable-select-options';

    this.dropdown.appendChild(this.searchInput);
    this.dropdown.appendChild(this.optionsList);

    this.container.appendChild(this.selectedDisplay);
    this.container.appendChild(this.dropdown);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.close();
      }
    });

    // Initial render of options
    this.renderOptions();
  }

  filterOptions(searchTerm) {
    const term = searchTerm.toLowerCase();

    if (!term) {
      this.filteredOptions = [...this.options];
    } else {
      this.filteredOptions = this.options.filter(opt => {
        // Search by language name or language code
        const textMatch = opt.text.toLowerCase().includes(term);
        const valueMatch = opt.value.toLowerCase().includes(term);
        return textMatch || valueMatch;
      });
    }

    // Reset highlight to first option when filtering
    this.highlightedIndex = this.filteredOptions.length > 0 ? 0 : -1;
    this.renderOptions();
  }

  renderOptions() {
    this.optionsList.innerHTML = '';
    const optionsToRender = this.filteredOptions.length > 0 ? this.filteredOptions : this.options;

    if (optionsToRender.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'searchable-select-option searchable-select-no-results';
      noResults.textContent = 'No languages found';
      this.optionsList.appendChild(noResults);
      this.highlightedIndex = -1;
      return;
    }

    optionsToRender.forEach((opt, index) => {
      const optionEl = document.createElement('div');
      optionEl.className = 'searchable-select-option';
      optionEl.textContent = opt.text;
      optionEl.dataset.value = opt.value;
      optionEl.dataset.index = index;

      if (opt.value === this.selectedValue) {
        optionEl.classList.add('selected');
      }

      if (index === this.highlightedIndex) {
        optionEl.classList.add('highlighted');
      }

      optionEl.addEventListener('click', () => this.selectOption(opt));
      optionEl.addEventListener('mouseenter', () => {
        this.highlightedIndex = index;
        this.updateHighlight();
      });

      this.optionsList.appendChild(optionEl);
    });
  }

  selectOption(option) {
    this.selectedValue = option.value;
    this.originalSelect.value = option.value;
    this.selectedDisplay.textContent = option.text;

    // Re-add arrow
    const arrow = document.createElement('span');
    arrow.className = 'searchable-select-arrow';
    arrow.textContent = '▼';
    this.selectedDisplay.appendChild(arrow);

    // Auto-save to localStorage based on select element's ID
    this.autoSaveToLocalStorage();

    // Trigger change event on original select
    const event = new Event('change', { bubbles: true });
    this.originalSelect.dispatchEvent(event);

    this.close();
  }

  autoSaveToLocalStorage() {
    // Automatically save to localStorage based on the select element's ID
    const selectId = this.originalSelect.id;
    const localStorageKeyMap = {
      'customerTranslateFromLanguageSelect': 'customerTranslateFromLanguage',
      'customerTranslateToLanguageSelect': 'customerTranslateToLanguage',
      'agentTranslateFromLanguageSelect': 'agentTranslateFromLanguage',
      'agentTranslateToLanguageSelect': 'agentTranslateToLanguage'
    };

    const storageKey = localStorageKeyMap[selectId];
    if (storageKey) {
      window.localStorage.setItem(storageKey, this.selectedValue);
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.dropdown.style.display = 'block';
    this.container.classList.add('open');
    this.searchInput.value = '';
    this.filteredOptions = [...this.options];
    this.highlightedIndex = 0;
    this.renderOptions();

    // Focus the search input
    setTimeout(() => this.searchInput.focus(), 10);
  }

  close() {
    this.isOpen = false;
    this.dropdown.style.display = 'none';
    this.container.classList.remove('open');
    this.searchInput.value = '';
  }

  handleKeydown(e) {
    const optionsToRender = this.filteredOptions.length > 0 ? this.filteredOptions : this.options;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Select highlighted option or first option if none highlighted
      const selectedOption = this.highlightedIndex >= 0
        ? optionsToRender[this.highlightedIndex]
        : optionsToRender[0];
      if (selectedOption) {
        this.selectOption(selectedOption);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.highlightedIndex < optionsToRender.length - 1) {
        this.highlightedIndex++;
        this.updateHighlight();
        this.scrollToHighlighted();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.highlightedIndex > 0) {
        this.highlightedIndex--;
        this.updateHighlight();
        this.scrollToHighlighted();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.highlightedIndex = 0;
      this.updateHighlight();
      this.scrollToHighlighted();
    } else if (e.key === 'End') {
      e.preventDefault();
      this.highlightedIndex = optionsToRender.length - 1;
      this.updateHighlight();
      this.scrollToHighlighted();
    } else if (e.key === 'Tab') {
      // Allow tab to close and move to next element
      this.close();
    }
  }

  updateHighlight() {
    const options = this.optionsList.querySelectorAll('.searchable-select-option');
    options.forEach((opt, index) => {
      if (index === this.highlightedIndex) {
        opt.classList.add('highlighted');
      } else {
        opt.classList.remove('highlighted');
      }
    });
  }

  scrollToHighlighted() {
    if (this.highlightedIndex < 0) return;

    const highlightedElement = this.optionsList.querySelector('.highlighted');
    if (highlightedElement) {
      highlightedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }

  getSelectedText() {
    const selected = this.options.find(opt => opt.value === this.selectedValue);
    return selected ? selected.text : '';
  }

  setValue(value) {
    this.selectedValue = value;
    this.originalSelect.value = value;
    const selectedText = this.getSelectedText();
    if (selectedText) {
      this.selectedDisplay.textContent = selectedText;

      // Re-add arrow
      const arrow = document.createElement('span');
      arrow.className = 'searchable-select-arrow';
      arrow.textContent = '▼';
      this.selectedDisplay.appendChild(arrow);
    }
  }

  getValue() {
    return this.selectedValue;
  }

  disable() {
    this.originalSelect.disabled = true;
    this.container.classList.add('disabled');
    this.selectedDisplay.style.opacity = '0.5';
    this.selectedDisplay.style.cursor = 'not-allowed';
    this.selectedDisplay.style.pointerEvents = 'none';
  }

  enable() {
    this.originalSelect.disabled = false;
    this.container.classList.remove('disabled');
    this.selectedDisplay.style.opacity = '1';
    this.selectedDisplay.style.cursor = 'pointer';
    this.selectedDisplay.style.pointerEvents = 'auto';
  }

  destroy() {
    this.container.remove();
    this.originalSelect.style.display = '';
  }
}
