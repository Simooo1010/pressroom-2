/**
 * scientific.js — Scientific / academic paper format renderer for Pressroom.
 *
 * Produces a single-column layout with auto-numbered headings, numbered
 * figures, and an abstract section. Wrapped in <div class="format-scientific">.
 */

// ── Helpers ────────────────────────────────────────────────────────

function ensureArray(articles) {
  return Array.isArray(articles) ? articles : [articles];
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Heading numbering tracker.
 *
 * Maintains a counter array so that:
 *   h2 → "1", "2", "3", …
 *   h3 → "1.1", "1.2", "2.1", …
 *   h4 → "1.1.1", …
 *
 * Only h2–h6 are numbered; h1 is reserved for the paper title.
 */
class HeadingNumberer {
  constructor() {
    // counters[0] → h2, counters[1] → h3, etc.
    this.counters = [0, 0, 0, 0, 0];
  }

  /**
   * Advance the counter for the given heading level and return
   * the formatted section number string.
   * @param {number} level – heading level (2–6)
   * @returns {string}
   */
  next(level) {
    const idx = Math.min(Math.max(level, 2), 6) - 2; // 0-based index

    // Increment the current level
    this.counters[idx]++;

    // Reset all deeper levels
    for (let i = idx + 1; i < this.counters.length; i++) {
      this.counters[i] = 0;
    }

    // Build the dotted number from h2 down to the current level
    return this.counters.slice(0, idx + 1).join('.');
  }
}

// ── Element renderer ───────────────────────────────────────────────

/**
 * Render a single element.
 *
 * @param {Object}          el        – element from the article
 * @param {HeadingNumberer} numberer  – shared heading counter
 * @param {{value: number}} figCount  – mutable figure counter object
 * @returns {string}
 */
function renderElement(el, numberer, figCount) {
  switch (el.type) {
    case 'paragraph':
      return `<p>${el.content}</p>`;

    case 'heading': {
      const level = Math.min(Math.max(el.level || 2, 2), 6);
      const tag = `h${level}`;
      const num = numberer.next(level);
      return `<${tag}><span class="heading-number">${num}</span> ${el.content}</${tag}>`;
    }

    case 'blockquote':
      return `<blockquote>${el.content}</blockquote>`;

    case 'pullquote':
      return `<aside class="pullquote">${el.content}</aside>`;

    case 'image': {
      figCount.value++;
      const caption = el.caption
        ? `Figure ${figCount.value}: ${el.caption}`
        : `Figure ${figCount.value}`;
      return [
        '<figure class="scientific-figure">',
        `  <img src="${escAttr(el.src)}" alt="${escAttr(el.alt || el.caption || '')}">`,
        `  <figcaption>${caption}</figcaption>`,
        '</figure>',
      ].join('\n');
    }

    case 'list': {
      const tag = el.ordered ? 'ol' : 'ul';
      const items = (el.items || []).map(i => `  <li>${i}</li>`).join('\n');
      return `<${tag}>\n${items}\n</${tag}>`;
    }

    case 'code': {
      const langClass = el.language ? ` class="language-${escAttr(el.language)}"` : '';
      return `<pre><code${langClass}>${el.content}</code></pre>`;
    }

    case 'separator':
      return '<hr>';

    case 'embed':
      if (el.html) return `<div class="embed">${el.html}</div>`;
      if (el.url) return `<div class="embed"><a href="${escAttr(el.url)}" target="_blank">${el.url}</a></div>`;
      return '';

    case 'table':
      return `<div class="scientific-table">${el.html || ''}</div>`;

    default:
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the scientific / academic paper format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderScientific(articles) {
  const list = ensureArray(articles);
  const parts = [];

  list.forEach((article, idx) => {
    // Page break between articles
    if (idx > 0) {
      parts.push('<div class="page-break"></div>');
    }

    // ── Title block ─────────────────────────────────────────────
    parts.push('<header class="scientific-header">');

    if (article.title) {
      parts.push(`  <h1 class="scientific-title">${article.title}</h1>`);
    }
    if (article.author) {
      parts.push(`  <p class="scientific-author">${article.author}</p>`);
    }
    if (article.date) {
      parts.push(`  <p class="scientific-date">${article.date}</p>`);
    }

    parts.push('</header>');

    // ── Abstract ────────────────────────────────────────────────
    // Use the subtitle if available; otherwise pull the first paragraph.
    const elements = article.elements || [];
    let abstractContent = '';
    let bodyStartIndex = 0;

    if (article.subtitle) {
      abstractContent = article.subtitle;
    } else if (elements.length && elements[0].type === 'paragraph') {
      abstractContent = elements[0].content;
      bodyStartIndex = 1; // skip the paragraph we consumed
    }

    if (abstractContent) {
      parts.push('<section class="scientific-abstract">');
      parts.push('  <p><strong>Abstract</strong></p>');
      parts.push(`  <p>${abstractContent}</p>`);
      parts.push('</section>');
    }

    // ── Body ────────────────────────────────────────────────────
    const numberer = new HeadingNumberer();
    const figCount = { value: 0 };

    for (let i = bodyStartIndex; i < elements.length; i++) {
      parts.push(renderElement(elements[i], numberer, figCount));
    }
  });

  return `<div class="format-scientific">\n${parts.join('\n')}\n</div>`;
}

export default renderScientific;
