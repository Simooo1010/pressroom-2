/**
 * newspaper.js — Traditional newspaper format renderer for Pressroom.
 *
 * Produces a multi-column layout with a masthead, drop-cap first paragraph,
 * ruled sections and pull-quote boxes, all wrapped in
 * <div class="format-newspaper">.
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
 * Format a date string for the masthead dateline.
 * Tries to produce something like "Monday, June 1, 2026".
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Apply a drop-cap to a paragraph's innerHTML.
 * Wraps the first visible letter in <span class="drop-cap">.
 */
function applyDropCap(html) {
  // Match leading whitespace / tags, then first letter
  return html.replace(
    /^(\s*(?:<[^>]+>\s*)*)(\w)/,
    '$1<span class="drop-cap">$2</span>'
  );
}

/**
 * Render a single element. `isFirstParagraph` controls drop-cap behaviour.
 */
function renderElement(el, isFirstParagraph) {
  switch (el.type) {
    case 'paragraph': {
      const inner = isFirstParagraph ? applyDropCap(el.content) : el.content;
      return `<p>${inner}</p>`;
    }

    case 'heading': {
      const tag = `h${Math.min(Math.max(el.level || 2, 1), 6)}`;
      return `<${tag}>${el.content}</${tag}>`;
    }

    case 'blockquote':
      return `<blockquote>${el.content}</blockquote>`;

    case 'pullquote':
      return `<aside class="pullquote newspaper-pullquote">${el.content}</aside>`;

    case 'image':
      return [
        '<figure class="newspaper-figure">',
        `  <img src="${escAttr(el.src)}" alt="${escAttr(el.alt || el.caption || '')}">`,
        el.caption ? `  <figcaption>${el.caption}</figcaption>` : '',
        '</figure>',
      ].filter(Boolean).join('\n');

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
      return '<hr class="newspaper-rule">';

    case 'embed':
      if (el.html) return `<div class="embed">${el.html}</div>`;
      if (el.url) return `<div class="embed"><a href="${escAttr(el.url)}" target="_blank">${el.url}</a></div>`;
      return '';

    case 'table':
      return el.html || '';

    default:
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the traditional newspaper format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderNewspaper(articles) {
  const list = ensureArray(articles);
  const parts = [];

  // ── Masthead (uses first article's metadata) ──────────────────
  const first = list[0];
  const pubName = (first.publicationName || 'THE PRESS').toUpperCase();
  const dateFormatted = formatDate(first.date);

  parts.push('<header class="newspaper-masthead">');
  parts.push('  <hr class="masthead-rule">');
  parts.push(`  <div class="masthead-meta">VOL. 1 &bull; ${pubName} &bull; ${dateFormatted}</div>`);
  parts.push(`  <h1 class="masthead-title">${pubName}</h1>`);
  parts.push('  <hr class="masthead-rule">');
  parts.push('</header>');

  // ── Articles ──────────────────────────────────────────────────
  list.forEach((article, idx) => {
    // Subsequent articles get a section rule
    if (idx > 0) {
      parts.push('<hr class="newspaper-section-rule">');
    }

    // Headline
    if (article.title) {
      const headlineClass = idx === 0 ? 'newspaper-headline-main' : 'newspaper-headline';
      parts.push(`<h2 class="${headlineClass}">${article.title}</h2>`);
    }

    if (article.subtitle) {
      parts.push(`<p class="newspaper-subtitle">${article.subtitle}</p>`);
    }

    // Byline
    const bylineParts = [];
    if (article.author) bylineParts.push(`By ${article.author}`);
    if (article.date) bylineParts.push(dateFormatted || article.date);
    if (bylineParts.length) {
      parts.push(`<p class="newspaper-byline">${bylineParts.join(' | ')}</p>`);
    }

    // Hero image (within column flow)
    if (article.heroImage) {
      parts.push([
        '<figure class="newspaper-figure">',
        `  <img src="${escAttr(article.heroImage)}" alt="">`,
        '</figure>',
      ].join('\n'));
    }

    // Body wrapped in column container
    parts.push('<div class="newspaper-columns">');

    let firstParagraphSeen = false;

    if (article.elements && article.elements.length) {
      article.elements.forEach(el => {
        const isFirst = el.type === 'paragraph' && !firstParagraphSeen;
        if (isFirst) firstParagraphSeen = true;
        parts.push(renderElement(el, isFirst));
      });
    }

    parts.push('</div>'); // .newspaper-columns
  });

  return `<div class="format-newspaper">\n${parts.join('\n')}\n</div>`;
}

export default renderNewspaper;
