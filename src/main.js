/**
 * Pressroom — Main Application Entry
 * Handles UI interactions, state management, API calls, and rendering.
 */

import { render, getFormatCSS } from './renderer.js';

// ─── State ──────────────────────────────────────────────
const state = {
  articles: null,        // Parsed article data (array)
  activeFormat: 'default',
  fetchMode: 'single',   // 'single' or 'publication'
  isLoading: false,
  options: {
    font: 'default',
    margin: 25,
    fontSize: 12,
    excludeEmbeds: false,
  }
};

// ─── DOM Elements ───────────────────────────────────────
const dom = {
  themeToggle: document.getElementById('theme-toggle'),
  themeIcon: document.getElementById('theme-toggle-icon'),
  fetchForm: document.getElementById('fetch-form'),
  urlInput: document.getElementById('url-input'),
  submitBtn: document.getElementById('submit-btn'),
  modeToggle: document.getElementById('mode-toggle'),
  modeOptions: document.querySelectorAll('.mode-option'),
  postCountWrapper: document.getElementById('post-count-wrapper'),
  postCountInput: document.getElementById('post-count'),
  formatSelector: document.getElementById('format-selector'),
  formatBtns: document.querySelectorAll('.format-btn'),
  fontSelect: document.getElementById('font-select'),
  sizeSlider: document.getElementById('size-slider'),
  sizeVal: document.getElementById('size-val'),
  marginSlider: document.getElementById('margin-slider'),
  marginVal: document.getElementById('margin-val'),
  excludeEmbeds: document.getElementById('exclude-embeds'),
  errorMessage: document.getElementById('error-message'),
  previewContainer: document.getElementById('preview-container'),
  previewEmpty: document.getElementById('preview-empty'),
  previewContent: document.getElementById('preview-content'),
  loadingOverlay: document.getElementById('loading-overlay'),
  actionBar: document.getElementById('action-bar'),
  btnPrint: document.getElementById('btn-print'),

};

// ─── Theme Toggle ───────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('pressroom-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  setTheme(theme);

  // Listen for system theme changes if user hasn't explicitly saved a preference
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('pressroom-theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pressroom-theme', theme);
  dom.themeIcon.textContent = theme === 'dark' ? '☾' : '☀';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = current === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  // Explicitly save user's manual override
  localStorage.setItem('pressroom-theme', newTheme);
}

// ─── Mode Toggle ────────────────────────────────────────
function setFetchMode(mode) {
  state.fetchMode = mode;

  dom.modeOptions.forEach(opt => {
    const isActive = opt.dataset.mode === mode;
    opt.classList.toggle('active', isActive);
    opt.querySelector('input').checked = isActive;
  });

  if (mode === 'publication') {
    dom.postCountWrapper.classList.remove('hidden');
    dom.urlInput.placeholder = 'example.substack.com';
  } else {
    dom.postCountWrapper.classList.add('hidden');
    dom.urlInput.placeholder = 'https://example.substack.com/p/article-slug';
  }
}

// ─── Format Selector ────────────────────────────────────
function setActiveFormat(format) {
  state.activeFormat = format;

  dom.formatBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === format);
  });

  // Re-render if we have data
  if (state.articles) {
    renderPreview();
  }
}

// ─── Loading State ──────────────────────────────────────
function setLoading(isLoading) {
  state.isLoading = isLoading;

  if (isLoading) {
    dom.loadingOverlay.classList.remove('hidden');
    dom.submitBtn.disabled = true;
    dom.submitBtn.textContent = '…';
    dom.errorMessage.classList.add('hidden');
  } else {
    dom.loadingOverlay.classList.add('hidden');
    dom.submitBtn.disabled = false;
    dom.submitBtn.textContent = 'Go';
  }
}

// ─── Error Display ──────────────────────────────────────
function showError(message) {
  dom.errorMessage.textContent = message;
  dom.errorMessage.classList.remove('hidden');
}

function hideError() {
  dom.errorMessage.classList.add('hidden');
}

// ─── Fetch Article(s) ───────────────────────────────────
async function fetchArticles(input) {
  setLoading(true);
  hideError();

  try {
    let body;

    if (state.fetchMode === 'single') {
      // Single article URL
      body = { url: input };
    } else {
      // Publication name — get latest N
      const count = parseInt(dom.postCountInput.value, 10) || 3;
      body = { publication: input, count };
    }

    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error (${response.status})`);
    }

    const data = await response.json();

    // Server returns { articles: [...] }
    const articlesArray = data.articles || (Array.isArray(data) ? data : [data]);
    state.articles = articlesArray;

    if (state.articles.length === 0) {
      throw new Error('No articles found.');
    }

    renderPreview();
    dom.actionBar.classList.remove('hidden');
    dom.previewEmpty.classList.add('hidden');

  } catch (err) {
    console.error('Fetch error:', err);
    showError(err.message || 'Failed to fetch article. Please check the URL and try again.');
    state.articles = null;
    dom.actionBar.classList.add('hidden');
    dom.previewEmpty.classList.remove('hidden');
  } finally {
    setLoading(false);
  }
}

// ─── Render Preview ─────────────────────────────────────
function renderPreview() {
  if (!state.articles) return;

  const html = render(state.articles, state.activeFormat, {
    excludeEmbeds: state.options.excludeEmbeds
  });

  // Fade transition
  dom.previewContent.style.opacity = '0';
  setTimeout(() => {
    dom.previewContent.innerHTML = html;
    
    // Apply customizations to the generated format wrapper
    const formatDiv = dom.previewContent.firstElementChild;
    if (formatDiv) {
      formatDiv.dataset.font = state.options.font;
      formatDiv.dataset.fontSize = state.options.fontSize;
      formatDiv.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
      formatDiv.style.padding = `${state.options.margin}mm`;
    }

    dom.previewContent.style.opacity = '1';
  }, 150);
}

// ─── Print PDF ──────────────────────────────────────────
function printPDF() {
  window.print();
}


// ─── Event Listeners ────────────────────────────────────
function init() {
  // Theme
  initTheme();
  dom.themeToggle.addEventListener('click', toggleTheme);

  // Form submission
  dom.fetchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = dom.urlInput.value.trim();
    if (!input) return;
    fetchArticles(input);
  });

  // Mode toggle
  dom.modeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      setFetchMode(opt.dataset.mode);
    });
  });

  // Format selector
  dom.formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveFormat(btn.dataset.format);
    });
  });

  // Action buttons
  dom.btnPrint.addEventListener('click', printPDF);


  // Customization controls
  dom.fontSelect.addEventListener('change', (e) => {
    state.options.font = e.target.value;
    const formatDiv = dom.previewContent.firstElementChild;
    if (formatDiv) formatDiv.dataset.font = state.options.font;
  });

  dom.sizeSlider.addEventListener('input', (e) => {
    state.options.fontSize = e.target.value;
    dom.sizeVal.textContent = state.options.fontSize;
    const formatDiv = dom.previewContent.firstElementChild;
    if (formatDiv) {
      formatDiv.dataset.fontSize = state.options.fontSize;
      formatDiv.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
    }
  });

  dom.marginSlider.addEventListener('input', (e) => {
    state.options.margin = e.target.value;
    dom.marginVal.textContent = state.options.margin;
    const formatDiv = dom.previewContent.firstElementChild;
    if (formatDiv) formatDiv.style.padding = `${state.options.margin}mm`;
  });

  dom.excludeEmbeds.addEventListener('change', (e) => {
    state.options.excludeEmbeds = e.target.checked;
    renderPreview();
  });

  // Smooth transitions on preview content
  dom.previewContent.style.transition = 'opacity 0.15s ease';
}

// ─── Start ──────────────────────────────────────────────
init();
