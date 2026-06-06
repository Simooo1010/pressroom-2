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
    lineSpacing: 1.6,
    excludeEmbeds: false,
    removedImages: new Set(),
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
  lineSpacingSlider: document.getElementById('line-spacing-slider'),
  lineSpacingVal: document.getElementById('line-spacing-val'),
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

// ─── Utilities ──────────────────────────────────────────
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function updateAllPageDivs(updateFn) {
  const pages = dom.previewContent.querySelectorAll('.preview-page');
  pages.forEach(updateFn);
}

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
    state.options.removedImages = new Set(); // Reset removals for new document

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

// ─── MM to PX Conversion ────────────────────────────────
function getMmToPx() {
  const ref = document.createElement('div');
  ref.style.cssText = 'width:100mm;height:0;position:absolute;visibility:hidden;';
  document.body.appendChild(ref);
  const ratio = ref.offsetWidth / 100;
  document.body.removeChild(ref);
  return ratio;
}

// ─── Block Extraction ───────────────────────────────────
// Walks the rendered HTML tree and extracts a flat list of
// paginatable blocks, regardless of format structure.
//
// Block types:
//   'cover'          — a title/cover page element (gets its own page)
//   'block'          — a regular block element
//   'column-content' — a child of a column wrapper (e.g. newspaper-columns)
//   'break'          — forced page break between articles
//
// Known wrappers that contain body content:
//   newspaper-columns, magazine-body, book-content (section)
//
// Known cover/title elements:
//   cover-page, book-title-page
//
function extractBlocks(formatDiv) {
  const blocks = [];

  // Column-wrapper classes whose children should be individually paginated
  const COLUMN_WRAPPERS = ['newspaper-columns'];

  // Cover/title-page classes (always get their own page)
  const COVER_CLASSES = ['cover-page', 'book-title-page'];

  // Body-wrapper classes whose children are regular blocks (NOT columns)
  const BODY_WRAPPERS = ['magazine-body', 'book-content'];

  let isFirstTopLevelElement = true;

  function processElement(el) {
    const classList = el.classList;

    // Page-break divs
    if (classList.contains('page-break')) {
      blocks.push({ type: 'break' });
      return;
    }

    // Article separators / section rules
    if (classList.contains('article-separator') ||
        classList.contains('newspaper-section-rule')) {
      blocks.push({ type: 'break' });
      return;
    }

    // Cover / title page
    for (const cls of COVER_CLASSES) {
      if (classList.contains(cls)) {
        blocks.push({ type: 'cover', el });
        return;
      }
    }

    // Column wrappers — flatten children as column-content
    for (const cls of COLUMN_WRAPPERS) {
      if (classList.contains(cls)) {
        Array.from(el.children).forEach(child => {
          blocks.push({
            type: 'column-content',
            el: child,
            wrapperClass: cls,
          });
        });
        return;
      }
    }

    // Body wrappers — recurse into children as regular blocks
    for (const cls of BODY_WRAPPERS) {
      if (classList.contains(cls) || (el.tagName === 'SECTION' && classList.contains(cls))) {
        Array.from(el.children).forEach(child => processElement(child));
        return;
      }
    }

    // Article elements — recurse into children
    if (el.tagName === 'ARTICLE') {
      if (!isFirstTopLevelElement && blocks.length > 0 && blocks[blocks.length - 1].type !== 'break') {
        blocks.push({ type: 'break' });
      }
      isFirstTopLevelElement = false;
      Array.from(el.children).forEach(child => processElement(child));
      return;
    }

    // Section elements (like book-content) — recurse
    if (el.tagName === 'SECTION') {
      Array.from(el.children).forEach(child => processElement(child));
      return;
    }

    // Regular block element
    blocks.push({ type: 'block', el });
  }

  Array.from(formatDiv.children).forEach(child => {
    processElement(child);
    isFirstTopLevelElement = false;
  });

  return blocks;
}

// ─── Pagination Engine ──────────────────────────────────
function isKeepWithNext(b) {
  if (!b || !b.el || b.type === 'break' || b.type === 'cover') return false;
  
  if (/^H[1-6]$/.test(b.el.tagName)) return true;
  
  const classList = b.el.classList;
  if (!classList) return false;
  
  if (classList.contains('magazine-header') || 
      classList.contains('scientific-header') ||
      classList.contains('newspaper-masthead') ||
      classList.contains('newspaper-headline') ||
      classList.contains('newspaper-headline-main') ||
      classList.contains('newspaper-subtitle') ||
      classList.contains('newspaper-byline') ||
      classList.contains('scientific-abstract') ||
      classList.contains('monospace-meta')) {
    return true;
  }
  return false;
}

async function paginatePreview(html) {
  const marginMm = parseFloat(state.options.margin);
  
  // Parse HTML into temp container
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const formatDiv = temp.firstElementChild;
  if (!formatDiv) return;

  // --- Apply saved removals before pagination ---
  if (state.options.removedImages && state.options.removedImages.size > 0) {
    const imagesToProcess = formatDiv.querySelectorAll('figure, img.hero-image, .monospace-image');
    imagesToProcess.forEach(target => {
      const img = target.tagName === 'IMG' ? target : target.querySelector('img');
      if (img && state.options.removedImages.has(img.src)) {
        target.remove();
      }
    });
  }

  const formatClassName = formatDiv.className;

  // Use a prober to get exact pixel dimensions of the content area
  const pageProber = document.createElement('div');
  pageProber.className = `preview-page ${formatClassName}`;
  pageProber.style.padding = `${marginMm}mm`;
  pageProber.style.visibility = 'hidden';
  pageProber.style.position = 'absolute';
  dom.previewContent.appendChild(pageProber);
  
  const proberStyle = window.getComputedStyle(pageProber);
  const pt = parseFloat(proberStyle.paddingTop) || 0;
  const pb = parseFloat(proberStyle.paddingBottom) || 0;
  const pl = parseFloat(proberStyle.paddingLeft) || 0;
  const pr = parseFloat(proberStyle.paddingRight) || 0;
  
  const proberRect = pageProber.getBoundingClientRect();
  const contentWidthPx = proberRect.width - pl - pr;
  const contentHeightPx = proberRect.height - pt - pb;
  dom.previewContent.removeChild(pageProber);

  const PAGE_NUM_RESERVE = 40; // px reserved for page number
  const availableHeightPx = contentHeightPx - PAGE_NUM_RESERVE - 10; // 10px safety buffer

  // Extract blocks from the format tree
  const blocks = extractBlocks(formatDiv);
  const elemBlocks = blocks.filter(b => b.el);

  if (elemBlocks.length === 0) return;

  // ── Measurement pass ──────────────────────────────────
  // Place all block elements in a hidden measurer at the correct content width.
  // Use offsetTop deltas between consecutive elements to get effective heights
  // (this correctly accounts for margin collapsing).
  const measurer = document.createElement('div');
  measurer.className = `preview-page ${formatClassName}`;
  measurer.dataset.font = state.options.font;
  measurer.dataset.fontSize = state.options.fontSize;
  measurer.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
  measurer.style.setProperty('--line-spacing', state.options.lineSpacing);
  measurer.style.padding = `${marginMm}mm`;
  Object.assign(measurer.style, {
    position: 'absolute',
    left: '-9999px',
    top: '0',
    height: 'auto',
    overflow: 'visible',
    visibility: 'hidden',
    boxSizing: 'border-box',
  });
  dom.previewContent.appendChild(measurer);

  // Wait for all fonts to be ready to avoid text reflows changing heights
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  // Insert all elements into measurer
  elemBlocks.forEach(b => measurer.appendChild(b.el));

  // Wait for all images to load so we get accurate heights
  const imgs = Array.from(measurer.querySelectorAll('img')).filter(img => img.src);
  await Promise.all(imgs.map(img => new Promise(resolve => {
    if (img.complete) return resolve();
    let isResolved = false;
    const done = () => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);
      resolve();
    };
    img.onload = done;
    img.onerror = done;
    const timer = setTimeout(done, 5000); // 5 second timeout per image
  })));

  void measurer.offsetHeight; // force layout

  // Record effective heights using exact fractional pixels
  for (let i = 0; i < elemBlocks.length; i++) {
    const computed = window.getComputedStyle(elemBlocks[i].el);
    elemBlocks[i].marginTop = parseFloat(computed.marginTop) || 0;

    const currentRect = elemBlocks[i].el.getBoundingClientRect();
    if (i < elemBlocks.length - 1) {
      const nextRect = elemBlocks[i + 1].el.getBoundingClientRect();
      elemBlocks[i].effectiveHeight = nextRect.top - currentRect.top;
    } else {
      // For the last element, use its actual height plus its bottom margin
      const lastMarginBottom = parseFloat(computed.marginBottom) || 0;
      elemBlocks[i].effectiveHeight = currentRect.height + lastMarginBottom;
    }
  }

  dom.previewContent.removeChild(measurer);

  // ── Distribution pass ─────────────────────────────────
  const pages = [];
  let currentPage = [];
  let currentH = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    
    // Forced page break
    if (b.type === 'break') {
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentH = 0;
      }
      continue;
    }

    // Cover pages always get their own page
    if (b.type === 'cover') {
      if (currentPage.length > 0) pages.push(currentPage);
      pages.push([b]);
      currentPage = [];
      currentH = 0;
      continue;
    }

    // Would this block overflow the current page?
    let h = b.effectiveHeight || 0;
    let addedMarginTop = 0;
    
    // First element on a page retains its top margin because of the page padding
    if (currentPage.length === 0 && b.marginTop) {
      addedMarginTop = b.marginTop;
      h += addedMarginTop;
    }

    if (currentH + h > availableHeightPx && currentPage.length > 0) {
      
      // We need to break before this block.
      // Pull back any orphaned headings from the end of currentPage.
      const pulledBackBlocks = [];
      while (currentPage.length > 0 && isKeepWithNext(currentPage[currentPage.length - 1])) {
        const popped = currentPage.pop();
        pulledBackBlocks.unshift(popped);
      }
      
      // If we pulled back everything (page was only headings) just put them back
      // so we don't loop endlessly or leave an empty page.
      if (currentPage.length === 0) {
        currentPage.push(...pulledBackBlocks);
        pulledBackBlocks.length = 0;
      }
      
      if (currentPage.length > 0) {
        pages.push(currentPage);
      }
      
      // Start new page with the pulled back blocks (if any) plus the current block
      currentPage = pulledBackBlocks;
      currentH = 0;
      if (currentPage.length > 0) {
        currentH += currentPage[0].marginTop || 0;
        currentH += currentPage.reduce((sum, blk) => sum + (blk.effectiveHeight || 0), 0);
      }
      
      // Recalculate h for the current block since it might now be the first element
      h = b.effectiveHeight || 0;
      if (currentPage.length === 0 && b.marginTop) {
        h += b.marginTop;
      }
    }

    currentPage.push(b);
    currentH += h;
  }

  if (currentPage.length > 0) pages.push(currentPage);

  // ── Build DOM ─────────────────────────────────────────
  dom.previewContent.innerHTML = '';

  pages.forEach((pageBlocks, pageIdx) => {
    const page = document.createElement('div');
    page.className = `preview-page ${formatClassName}`;
    page.dataset.font = state.options.font;
    page.dataset.fontSize = state.options.fontSize;
    page.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
    page.style.setProperty('--line-spacing', state.options.lineSpacing);
    page.style.padding = `${marginMm}mm`;

    // Check if this is a cover page
    const isCover = pageBlocks.length === 1 && pageBlocks[0].type === 'cover';
    if (isCover) page.classList.add('cover-page-container');

    // Append content, wrapping consecutive column-content in their wrapper
    let currentColWrapper = null;

    pageBlocks.forEach(b => {
      if (b.type === 'column-content') {
        if (!currentColWrapper) {
          currentColWrapper = document.createElement('div');
          currentColWrapper.className = b.wrapperClass;
          page.appendChild(currentColWrapper);
        }
        currentColWrapper.appendChild(b.el);
      } else {
        currentColWrapper = null;
        page.appendChild(b.el);
      }
    });

    // Page number (skip on standalone cover pages)
    if (!isCover) {
      const numEl = document.createElement('div');
      numEl.className = 'page-number';
      numEl.textContent = pageIdx + 1;
      page.appendChild(numEl);
    }

    dom.previewContent.appendChild(page);
  });

  // Attach image hover-to-remove handlers
  attachImageRemoveHandlers();
}

// ─── Render Preview ─────────────────────────────────────
async function renderPreview() {
  if (!state.articles) return;

  const html = render(state.articles, state.activeFormat, {
    excludeEmbeds: state.options.excludeEmbeds
  });

  // Fade transition
  dom.previewContent.style.opacity = '0';
  
  // Wait briefly for transition, then paginate
  setTimeout(async () => {
    await paginatePreview(html);
    dom.previewContent.style.opacity = '1';
  }, 150);
}

// Debounced re-pagination for slider changes
const debouncedRepaginate = debounce(() => {
  if (state.articles) renderPreview();
}, 300);

// ─── Image Hover-to-Remove ──────────────────────────────
function attachImageRemoveHandlers() {
  const figures = dom.previewContent.querySelectorAll('figure, img.hero-image');
  figures.forEach(target => {
    // Skip if already wired
    if (target.dataset.removable) return;
    target.dataset.removable = 'true';

    // Wrap standalone <img> in a container for positioning
    const wrapper = document.createElement('div');
    wrapper.className = 'image-remove-wrapper';

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'image-remove-overlay';
    overlay.innerHTML = '<span class="image-remove-icon">✕ Remove image</span>';

    // Insert wrapper around the target element
    target.parentNode.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    wrapper.appendChild(overlay);

    // Click to remove
    overlay.addEventListener('click', () => {
      // Save the removed state
      const img = target.tagName === 'IMG' ? target : target.querySelector('img');
      if (img && img.src) {
        state.options.removedImages.add(img.src);
      }

      wrapper.style.transition = 'opacity 0.25s ease, max-height 0.35s ease';
      wrapper.style.opacity = '0';
      wrapper.style.maxHeight = wrapper.offsetHeight + 'px';
      requestAnimationFrame(() => {
        wrapper.style.maxHeight = '0';
        wrapper.style.overflow = 'hidden';
      });
      setTimeout(() => {
        wrapper.remove();
        debouncedRepaginate(); // Reflow text across all pages
      }, 350);
    });
  });
}

// ─── Print PDF ──────────────────────────────────────────
function printPDF() {
  const originalTitle = document.title;
  let articleTitle = '';
  
  if (state.articles && state.articles.length > 0) {
    if (state.articles.length === 1) {
      articleTitle = state.articles[0].title;
    } else {
      const pubName = state.articles[0].publicationName;
      if (pubName) {
        articleTitle = `${pubName} - Latest Posts`;
      } else {
        articleTitle = `${state.articles[0].title} and others`;
      }
    }
  }
  
  if (articleTitle) {
    // Strip illegal characters for filenames
    document.title = articleTitle.replace(/[\\/:*?"<>|]/g, '').trim();
  }
  
  window.print();
  
  // Restore the original title shortly after
  setTimeout(() => {
    document.title = originalTitle;
  }, 100);
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

  // Customization controls — instant visual update + debounced re-pagination
  dom.fontSelect.addEventListener('change', (e) => {
    state.options.font = e.target.value;
    updateAllPageDivs(page => { page.dataset.font = state.options.font; });
    debouncedRepaginate();
  });

  dom.sizeSlider.addEventListener('input', (e) => {
    state.options.fontSize = e.target.value;
    dom.sizeVal.textContent = state.options.fontSize;
    updateAllPageDivs(page => {
      page.dataset.fontSize = state.options.fontSize;
      page.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
    });
    debouncedRepaginate();
  });

  dom.lineSpacingSlider.addEventListener('input', (e) => {
    state.options.lineSpacing = e.target.value;
    dom.lineSpacingVal.textContent = state.options.lineSpacing;
    updateAllPageDivs(page => {
      page.style.setProperty('--line-spacing', state.options.lineSpacing);
    });
    debouncedRepaginate();
  });

  dom.marginSlider.addEventListener('input', (e) => {
    state.options.margin = e.target.value;
    dom.marginVal.textContent = state.options.margin;
    updateAllPageDivs(page => {
      page.style.padding = `${state.options.margin}mm`;
    });
    debouncedRepaginate();
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
