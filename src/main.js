/**
 * Pressroom — Main Application Entry
 * "Press Sheet" interface: front page → proof desk.
 * Handles UI state, API calls and pagination. render(), paginatePreview()
 * and the format CSS that produce the printed pages are unchanged.
 */

import { render } from './renderer.js';

const FORMAT_NAMES = {
  default: 'Default', newspaper: 'Newspaper', scientific: 'Scientific',
  book: 'Book', monospace: 'Monospace', magazine: 'Magazine',
};
const FONT_NAMES = {
  default: 'Stock default', sans: 'Modern Sans', serif: 'Classic Serif', times: 'Times New Roman', mono: 'Typewriter',
};
const SHEET_PX = 210 * (96 / 25.4); // A4 width at 96dpi

// ─── State ──────────────────────────────────────────────
const state = {
  articles: null,        // Parsed article data (array)
  activeFormat: 'default',
  fetchMode: 'single',   // 'single' or 'publication'
  isLoading: false,
  view: 'front',         // 'front' | 'proof'
  dirty: false,          // proof needs re-render when shown
  pageCount: 0,
  spreadStart: 0,
  lastInput: '',
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
const $ = (id) => document.getElementById(id);
const dom = {
  front: $('front'),
  proof: $('proof'),
  datelineDate: $('dateline-date'),
  themeToggle: $('theme-toggle'),
  fetchForm: $('fetch-form'),
  urlInput: $('url-input'),
  submitBtn: $('submit-btn'),
  modeOptions: document.querySelectorAll('.mode-option'),
  postCountWrapper: $('post-count-wrapper'),
  postCountInput: $('post-count'),
  stockCards: document.querySelectorAll('.stock-card'),
  stockMinis: document.querySelectorAll('.stock-mini'),
  fontSelect: $('font-select'),
  sizeSlider: $('size-slider'),
  sizeVal: $('size-val'),
  lineSpacingSlider: $('line-spacing-slider'),
  lineSpacingVal: $('line-spacing-val'),
  marginSlider: $('margin-slider'),
  marginVal: $('margin-val'),
  excludeEmbeds: $('exclude-embeds'),
  errorMessage: $('error-message'),
  errorText: $('error-text'),
  errorRetry: $('error-retry'),
  desk: $('desk'),
  previewContent: $('preview-content'),
  btnPrint: $('btn-print'),
  wordmark: $('wordmark'),
  slugSource: $('slug-source'),
  slugSummary: $('slug-summary'),
  pubTabs: $('pub-tabs'),
  spreadPrev: $('spread-prev'),
  spreadNext: $('spread-next'),
  spreadLabel: $('spread-label'),
  rail: $('rail'),
  drawerHandle: $('drawer-handle'),
  printOverlay: $('print-overlay'),
  edStock: $('ed-stock'),
  edType: $('ed-type'),
  edMargins: $('ed-margins'),
  edEmbeds: $('ed-embeds'),
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

// ─── Theme ("Night edition") ────────────────────────────
function storedTheme() {
  try { return localStorage.getItem('pressroom-theme'); } catch { return null; }
}

function initTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(storedTheme() || (prefersDark ? 'dark' : 'light'), false);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!storedTheme()) setTheme(e.matches ? 'dark' : 'light', false);
  });
}

function setTheme(theme, persist = true) {
  document.documentElement.setAttribute('data-theme', theme);
  dom.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  dom.themeToggle.textContent = theme === 'dark' ? 'Day edition (light)' : 'Night edition (dark)';
  if (persist) {
    try { localStorage.setItem('pressroom-theme', theme); } catch { /* storage unavailable */ }
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── Edition list (front page) ──────────────────────────
function updateEdition() {
  dom.edStock.textContent = FORMAT_NAMES[state.activeFormat];
  dom.edType.textContent = state.options.font === 'default'
    ? 'Stock default'
    : `${FONT_NAMES[state.options.font]} ${state.options.fontSize} pt`;
  dom.edMargins.textContent = `${state.options.margin} mm`;
  dom.edEmbeds.textContent = state.options.excludeEmbeds ? 'Left out' : 'Kept';
}

function updateDateline() {
  const d = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  dom.datelineDate.textContent = `Vol. 2 · ${d}`;
}

// ─── Views ──────────────────────────────────────────────
function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  dom.front.hidden = false;
  dom.front.classList.remove('leaving');
  dom.proof.hidden = view !== 'proof';
  window.scrollTo(0, 0);
  if (view === 'proof') {
    dom.slugSource.textContent = state.lastInput;
    if (state.dirty) renderPreview();
  } else {
    dom.urlInput.focus({ preventScroll: true });
  }
}

function enterProof() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { setView('proof'); return; }
  // The front page collapses upward into the slug bar (0.5 s)
  dom.front.classList.add('leaving');
  setTimeout(() => setView('proof'), 480);
}

// ─── Mode Toggle ────────────────────────────────────────
function setFetchMode(mode) {
  state.fetchMode = mode;

  dom.modeOptions.forEach(opt => {
    const isActive = opt.dataset.mode === mode;
    opt.classList.toggle('is-selected', isActive);
    opt.setAttribute('aria-pressed', String(isActive));
  });

  if (mode === 'publication') {
    dom.postCountWrapper.hidden = false;
    dom.urlInput.placeholder = 'example.substack.com';
  } else {
    dom.postCountWrapper.hidden = true;
    dom.urlInput.placeholder = 'https://example.substack.com/p/article-slug';
  }
}

// ─── Stock selection ────────────────────────────────────
function setActiveFormat(format) {
  state.activeFormat = format;

  [...dom.stockCards, ...dom.stockMinis].forEach(btn => {
    const on = btn.dataset.format === format;
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  updateEdition();

  if (state.articles) renderPreview();
}

// ─── Loading State ──────────────────────────────────────
function setLoading(isLoading) {
  state.isLoading = isLoading;
  dom.front.classList.toggle('is-loading', isLoading);
  $('double-rule').setAttribute('aria-hidden', String(!isLoading));
  dom.submitBtn.disabled = isLoading;
  dom.urlInput.readOnly = isLoading;
  if (isLoading) hideError();
}

// ─── Error Display ──────────────────────────────────────
function showError(message) {
  dom.errorText.textContent = message;
  dom.errorMessage.classList.remove('hidden');
  dom.front.classList.add('has-error');
}

function hideError() {
  dom.errorMessage.classList.add('hidden');
  dom.front.classList.remove('has-error');
}

// ─── Fetch Article(s) ───────────────────────────────────
async function fetchArticles(input) {
  setLoading(true);
  hideError();
  state.lastInput = input;

  try {
    let body;

    if (state.fetchMode === 'single') {
      body = { url: input };
    } else {
      const count = Math.min(20, Math.max(1, parseInt(dom.postCountInput.value, 10) || 3));
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

    if (articlesArray.length === 0) {
      throw new Error('No articles found. Check the link or publication name and try again.');
    }

    // Paywalled / empty posts: say what was and was not fetched
    const withBody = articlesArray.filter(a => a.elements && a.elements.length > 0);
    if (withBody.length === 0) {
      const titles = articlesArray.map(a => a.title).filter(Boolean).join('; ');
      throw new Error(`Fetched the title${titles ? ` (“${titles}”)` : ''} but no body text. The post may be paywalled or members-only.`);
    }

    state.articles = withBody;
    state.options.removedImages = new Set(); // Reset removals for new document
    state.spreadStart = 0;
    state.dirty = true;

    setLoading(false);
    setView('proof'); // collapses straight into the proof desk
  } catch (err) {
    console.error('Fetch error:', err);
    showError(err.message || 'Failed to fetch article. Please check the URL and try again.');
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
  dom.previewContent.classList.add('measuring');
  try {
    await paginateInner(html);
  } finally {
    dom.previewContent.classList.remove('measuring');
  }
}

async function paginateInner(html) {
  const marginMm = parseFloat(state.options.margin);
  
  // Parse HTML into temp container
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const formatDiv = temp.firstElementChild;
  if (!formatDiv) return;

  // --- Replace removed images with a hatched "left out" box (undo-able) ---
  if (state.options.removedImages && state.options.removedImages.size > 0) {
    const imagesToProcess = formatDiv.querySelectorAll('figure, img.hero-image, .monospace-image');
    imagesToProcess.forEach(target => {
      const img = target.tagName === 'IMG' ? target : target.querySelector('img');
      if (img && state.options.removedImages.has(img.src)) {
        const box = document.createElement('div');
        box.className = 'image-left-out';
        box.dataset.src = img.src;
        box.innerHTML = '<span>Image left out</span><button type="button" class="image-undo-btn">Undo</button>';
        target.replaceWith(box);
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

  if (elemBlocks.length === 0) {
    dom.previewContent.innerHTML = '';
    state.pageCount = 0;
    return;
  }

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

  // Attach image removal handlers and crop marks
  attachImageRemoveHandlers();
  addCropMarks();
  state.pageCount = pages.length;
}

// ─── Render Preview ─────────────────────────────────────
async function renderPreview() {
  if (!state.articles) return;
  if (state.view !== 'proof') { state.dirty = true; return; }
  state.dirty = false;

  const token = ++renderToken;
  dom.proof.classList.add('is-paginating');

  const html = render(state.articles, state.activeFormat, {
    excludeEmbeds: state.options.excludeEmbeds
  });

  // Fade transition, then paginate
  dom.previewContent.style.opacity = '0';
  await new Promise(r => setTimeout(r, 150));
  if (token !== renderToken) return; // a newer render superseded this one

  await paginatePreview(html);
  if (token !== renderToken) return;

  dom.previewContent.style.opacity = '1';
  dom.proof.classList.remove('is-paginating');
  buildPubTabs();
  showSpread(state.spreadStart, true);
}
let renderToken = 0;

// Debounced re-pagination for slider changes
const debouncedRepaginate = debounce(() => {
  if (state.articles) renderPreview();
}, 300);

// ─── Crop marks ─────────────────────────────────────────
function addCropMarks() {
  updateAllPageDivs(page => {
    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
      const c = document.createElement('span');
      c.className = `crop crop-${pos}`;
      c.setAttribute('aria-hidden', 'true');
      page.appendChild(c);
    });
  });
}

// ─── Spreads (two sheets wide, one on narrow) ───────────
function perSpread() {
  return window.innerWidth >= 1100 ? 2 : 1;
}

function fitSheets() {
  const n = perSpread();
  const style = window.getComputedStyle(dom.desk);
  const avail = dom.desk.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const gap = 32;
  const zoom = Math.min(1, Math.max(0.2, (avail - gap * (n - 1)) / (SHEET_PX * n)));
  dom.previewContent.style.setProperty('--sheet-zoom', zoom.toFixed(3));
}

function showSpread(start, animate = false) {
  const pages = [...dom.previewContent.querySelectorAll('.preview-page')];
  const n = perSpread();
  const total = pages.length;
  if (total === 0) {
    dom.spreadLabel.textContent = 'No sheets';
    dom.slugSummary.textContent = '0 sheets';
    dom.spreadPrev.disabled = dom.spreadNext.disabled = true;
    return;
  }
  start = Math.max(0, Math.min(start, total - 1));
  start -= start % n; // snap to spread boundary
  state.spreadStart = start;
  fitSheets();

  pages.forEach((p, i) => {
    const visible = i >= start && i < start + n;
    p.classList.toggle('off-spread', !visible);
    p.classList.remove('drop');
    if (visible && animate) {
      p.style.animationDelay = `${(i - start) * 120}ms`;
      void p.offsetWidth;
      p.classList.add('drop');
    }
  });

  if (animate === 'turn') {
    dom.previewContent.classList.remove('turn');
    void dom.previewContent.offsetWidth;
    dom.previewContent.classList.add('turn');
  }

  const last = Math.min(start + n, total);
  const range = last - start > 1 ? `${start + 1}–${last}` : `${start + 1}`;
  let label = `Sheets ${range} of ${total}`;
  if (n === 1) label = `Sheet ${start + 1} of ${total}`;
  if (state.articles.length > 1) {
    const post = currentPostIndex();
    label = `Sheet ${start + 1} of ${total} · post ${post + 1} of ${state.articles.length}`;
    [...dom.pubTabs.children].forEach((t, i) => t.setAttribute('aria-selected', String(i === post)));
  }
  dom.spreadLabel.textContent = label;
  dom.slugSummary.textContent = `${total} sheet${total === 1 ? '' : 's'} · A4 · ${FORMAT_NAMES[state.activeFormat]}`;
  dom.spreadPrev.disabled = start === 0;
  dom.spreadNext.disabled = start + n >= total;
}

function turnSpread(dir) {
  const n = perSpread();
  const next = state.spreadStart + dir * n;
  if (next < 0 || next >= state.pageCount) return;
  showSpread(next, 'turn');
}

// ─── Publication tabs ───────────────────────────────────
let postStarts = [];

function computePostStarts() {
  const pages = [...dom.previewContent.querySelectorAll('.preview-page')];
  const texts = pages.map(p => (p.textContent || '').replace(/\s+/g, ' ').toLowerCase());
  postStarts = [];
  let from = 0;
  state.articles.forEach((a, idx) => {
    const t = (a.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let found = t ? texts.findIndex((tx, i) => i >= from && tx.includes(t)) : -1;
    if (found < 0) found = idx === 0 ? 0 : Math.min(from, pages.length - 1);
    postStarts.push(found);
    from = found + (idx === 0 ? 1 : 1);
  });
}

function currentPostIndex() {
  let cur = 0;
  postStarts.forEach((s, i) => { if (state.spreadStart + perSpread() - 1 >= s) cur = i; });
  // prefer the post that owns the first visible sheet
  let first = 0;
  postStarts.forEach((s, i) => { if (state.spreadStart >= s) first = i; });
  return first <= cur ? first : cur;
}

function buildPubTabs() {
  dom.pubTabs.innerHTML = '';
  if (!state.articles || state.articles.length < 2) {
    dom.pubTabs.classList.add('hidden');
    postStarts = [];
    return;
  }
  computePostStarts();
  state.articles.forEach((a, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'pub-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.textContent = `${String(i + 1).padStart(2, '0')} ${a.title || 'Untitled'}`;
    tab.title = a.title || '';
    tab.addEventListener('click', () => showSpread(postStarts[i] ?? 0, 'turn'));
    dom.pubTabs.appendChild(tab);
  });
  dom.pubTabs.classList.remove('hidden');
}

// ─── Per-image removal (44 px ✕ button) with undo ───────
function attachImageRemoveHandlers() {
  const figures = dom.previewContent.querySelectorAll('figure, img.hero-image');
  figures.forEach(target => {
    if (target.dataset.removable) return;
    target.dataset.removable = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'image-remove-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'image-remove-btn';
    btn.setAttribute('aria-label', 'Remove this image');
    btn.textContent = '×';

    target.parentNode.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      const img = target.tagName === 'IMG' ? target : target.querySelector('img');
      if (img && img.src) state.options.removedImages.add(img.src);
      renderPreview(); // Reflow text across all sheets
    });
  });

  dom.previewContent.querySelectorAll('.image-undo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.options.removedImages.delete(btn.closest('.image-left-out').dataset.src);
      renderPreview();
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

  // "Off to the printer": 400 ms overlay before the dialog opens
  dom.printOverlay.classList.add('show');
  setTimeout(() => {
    dom.printOverlay.classList.remove('show');
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 100);
  }, 400);
}

// ─── Mobile drawer ──────────────────────────────────────
function setDrawer(open) {
  dom.rail.classList.toggle('open', open);
  dom.drawerHandle.setAttribute('aria-expanded', String(open));
}

// ─── Event Listeners ────────────────────────────────────
function init() {
  initTheme();
  updateDateline();
  updateEdition();
  dom.themeToggle.addEventListener('click', toggleTheme);

  // Form submission
  dom.fetchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = dom.urlInput.value.trim();
    if (!input) {
      showError('Write today’s headline first: paste a Substack link.');
      dom.urlInput.focus();
      return;
    }
    fetchArticles(input);
  });
  dom.urlInput.addEventListener('input', () => { if (!state.isLoading) hideError(); });
  dom.errorRetry.addEventListener('click', () => dom.fetchForm.requestSubmit());

  // Mode switch
  dom.modeOptions.forEach(opt => {
    opt.addEventListener('click', () => setFetchMode(opt.dataset.mode));
  });

  // Stock selection (front cards + rail grid)
  [...dom.stockCards, ...dom.stockMinis].forEach(btn => {
    btn.addEventListener('click', () => setActiveFormat(btn.dataset.format));
  });

  dom.wordmark.addEventListener('click', () => setView('front'));
  dom.btnPrint.addEventListener('click', printPDF);

  // Rail controls — instant visual update + debounced re-pagination
  dom.fontSelect.addEventListener('change', (e) => {
    state.options.font = e.target.value;
    updateAllPageDivs(page => { page.dataset.font = state.options.font; });
    updateEdition();
    debouncedRepaginate();
  });

  dom.sizeSlider.addEventListener('input', (e) => {
    state.options.fontSize = e.target.value;
    dom.sizeVal.textContent = state.options.fontSize;
    updateAllPageDivs(page => {
      page.dataset.fontSize = state.options.fontSize;
      page.style.setProperty('--base-font-size', `${state.options.fontSize}pt`);
    });
    updateEdition();
    debouncedRepaginate();
  });

  dom.lineSpacingSlider.addEventListener('input', (e) => {
    state.options.lineSpacing = e.target.value;
    dom.lineSpacingVal.textContent = Number(state.options.lineSpacing).toFixed(1);
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
    updateEdition();
    debouncedRepaginate();
  });

  dom.excludeEmbeds.addEventListener('change', (e) => {
    state.options.excludeEmbeds = e.target.checked;
    updateEdition();
    renderPreview();
  });

  // Spread navigation
  dom.spreadPrev.addEventListener('click', () => turnSpread(-1));
  dom.spreadNext.addEventListener('click', () => turnSpread(1));
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'proof') return;
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') turnSpread(-1);
    if (e.key === 'ArrowRight') turnSpread(1);
  });

  // Swipe between sheets (narrow screens)
  let touchX = null;
  dom.desk.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  dom.desk.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) turnSpread(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Drawer
  dom.drawerHandle.addEventListener('click', () => setDrawer(!dom.rail.classList.contains('open')));

  // Resize: refit the sheets, one or two at a time
  window.addEventListener('resize', debounce(() => {
    if (state.view === 'proof' && state.pageCount) showSpread(state.spreadStart);
  }, 120));

  setView('front');
}

// ─── Start ──────────────────────────────────────────────
init();
