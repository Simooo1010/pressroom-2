/**
 * default.js — Clean, readable default format renderer for Pressroom.
 *
 * Produces semantic HTML wrapped in <div class="format-default">.
 * Handles single article objects and arrays transparently.
 */

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Normalize input to an array of articles.
 * @param {Object|Object[]} articles
 * @returns {Object[]}
 */
function ensureArray(articles) {
  return Array.isArray(articles) ? articles : [articles];
}

/**
 * Escape text for safe insertion into HTML attributes.
 */
function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Render a single element object to an HTML string.
 */
function renderElement(el) {
  switch (el.type) {
    case 'paragraph':
      return `<p>${el.content}</p>`;

    case 'heading': {
      const tag = `h${Math.min(Math.max(el.level || 2, 1), 6)}`;
      return `<${tag}>${el.content}</${tag}>`;
    }

    case 'blockquote':
      return `<blockquote>${el.content}</blockquote>`;

    case 'pullquote':
      return `<aside class="pullquote">${el.content}</aside>`;

    case 'image':
      return [
        '<figure>',
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
      return '<hr>';

    case 'embed':
      if (el.html) return `<div class="embed">${el.html}</div>`;
      if (el.url) return `<div class="embed"><a href="${escAttr(el.url)}" target="_blank">${el.url}</a></div>`;
      return '';

    case 'table':
      return el.html || '';

    default:
      // Unknown element types are silently passed through as comments.
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the default clean format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderDefault(articles) {
  const list = ensureArray(articles);
  const parts = [];

  list.forEach((article, idx) => {
    // Page break between articles (not before the first one)
    if (idx > 0) {
      parts.push('<div class="page-break"></div>');
    }

    // ── Header ──────────────────────────────────────────────────
    parts.push('<article>');
    parts.push('  <div class="cover-page">');

    if (article.title) {
      parts.push(`    <h1>${article.title}</h1>`);
    }

    if (article.subtitle) {
      parts.push(`    <p class="subtitle">${article.subtitle}</p>`);
    }

    // Byline: author + date
    const bylineParts = [];
    if (article.author) bylineParts.push(article.author);
    if (article.date) bylineParts.push(article.date);
    if (bylineParts.length) {
      parts.push(`    <p class="byline">${bylineParts.join(' · ')}</p>`);
    }

    // Hero image
    if (article.heroImage) {
      parts.push(`    <img class="hero-image" src="${escAttr(article.heroImage)}" alt="">`);
    }
    
    parts.push('  </div>');

    // ── Body elements (in order) ────────────────────────────────
    if (article.elements && article.elements.length) {
      const processedElements = [];
      let pendingParagraphs = [];
      
      const flushPending = () => {
        if (pendingParagraphs.length > 0) {
          if (pendingParagraphs.length === 1) {
            processedElements.push(pendingParagraphs[0]);
          } else {
            const unifiedContent = pendingParagraphs.map(p => p.content.trim()).join(' ');
            processedElements.push({ type: 'paragraph', content: unifiedContent });
          }
          pendingParagraphs = [];
        }
      };

      article.elements.forEach(el => {
        if (el.type === 'paragraph') {
          const textLength = el.content.replace(/<[^>]*>?/gm, '').length;
          if (textLength < 150) {
            pendingParagraphs.push(el);
          } else {
            flushPending();
            processedElements.push(el);
          }
        } else {
          flushPending();
          processedElements.push(el);
        }
      });
      flushPending();

      processedElements.forEach(el => {
        parts.push(`  ${renderElement(el)}`);
      });
    }

    parts.push('</article>');
  });

  return `<div class="format-default">\n${parts.join('\n')}\n</div>`;
}

export default renderDefault;
