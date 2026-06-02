/**
 * monospace.js — Monospace / draft format renderer for Pressroom.
 *
 * Produces a plain-text–inspired layout using monospace styling,
 * ASCII-style markers for headings, blockquotes and separators,
 * and both text placeholders AND real <img> tags for images (users
 * can toggle image visibility via CSS). Wrapped in
 * <div class="format-monospace">.
 */

// ── Helpers ────────────────────────────────────────────────────────

function ensureArray(articles) {
  return Array.isArray(articles) ? articles : [articles];
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Prefix every line of `html` with the given prefix string.
 * Operates on the raw HTML, so the prefix becomes visible rendered text.
 */
function prefixLines(html, prefix) {
  // Split on <br> / <br/> / newlines to handle multi-line inner HTML
  return html
    .split(/\n|<br\s*\/?>/)
    .map(line => `${prefix}${line}`)
    .join('<br>');
}

/**
 * Render a single element to monospace-flavoured HTML.
 */
function renderElement(el) {
  switch (el.type) {
    case 'paragraph':
      return `<p>${el.content}</p>`;

    case 'heading': {
      const level = Math.min(Math.max(el.level || 2, 1), 6);
      const hashes = '#'.repeat(level);
      const tag = `h${level}`;
      return `<${tag}>${hashes} ${el.content}</${tag}>`;
    }

    case 'blockquote':
      return `<blockquote>${prefixLines(el.content, '&gt; ')}</blockquote>`;

    case 'pullquote':
      return `<aside class="pullquote">&gt; ${el.content}</aside>`;

    case 'image': {
      const captionText = el.caption || el.alt || 'untitled';
      return [
        '<div class="monospace-image">',
        `  <p class="monospace-image-placeholder">[Image: ${escHtml(captionText)}]</p>`,
        `  <img class="monospace-image-actual" src="${escAttr(el.src)}" alt="${escAttr(el.alt || el.caption || '')}">`,
        '</div>',
      ].join('\n');
    }

    case 'list': {
      const items = (el.items || []).map((item, i) => {
        const marker = el.ordered ? `${i + 1}.` : '-';
        return `  <li>${marker} ${item}</li>`;
      }).join('\n');
      const tag = el.ordered ? 'ol' : 'ul';
      return `<${tag} class="monospace-list">\n${items}\n</${tag}>`;
    }

    case 'code': {
      const fence = '```' + (el.language || '');
      return `<pre class="monospace-code">${escHtml(fence)}\n${escHtml(el.content)}\n${escHtml('```')}</pre>`;
    }

    case 'separator':
      return '<p class="monospace-separator">---</p>';

    case 'embed':
      if (el.url) {
        const label = el.provider ? `[${el.provider}]` : '[Embed]';
        return `<p class="monospace-embed">${label}(<a href="${escAttr(el.url)}" target="_blank">${el.url}</a>)</p>`;
      }
      if (el.html) return `<div class="embed">${el.html}</div>`;
      return '';

    case 'table':
      return el.html || '';

    default:
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the monospace / draft format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderMonospace(articles) {
  const list = ensureArray(articles);
  const parts = [];

  list.forEach((article, idx) => {
    if (idx > 0) {
      parts.push('<div class="page-break"></div>');
    }

    parts.push('<article class="monospace-article">');

    // ── Header ──────────────────────────────────────────────────
    if (article.title) {
      const bar = '='.repeat(Math.min(article.title.length + 2, 60));
      parts.push(`<h1>${bar}<br>${article.title}<br>${bar}</h1>`);
    }

    if (article.author) {
      parts.push(`<p class="monospace-meta">Author: ${escHtml(article.author)}</p>`);
    }
    if (article.date) {
      parts.push(`<p class="monospace-meta">Date:   ${escHtml(article.date)}</p>`);
    }

    // Hero image
    if (article.heroImage) {
      parts.push([
        '<div class="monospace-image">',
        '  <p class="monospace-image-placeholder">[Image: hero]</p>',
        `  <img class="monospace-image-actual" src="${escAttr(article.heroImage)}" alt="">`,
        '</div>',
      ].join('\n'));
    }

    // ── Body elements (in order) ────────────────────────────────
    if (article.elements && article.elements.length) {
      article.elements.forEach(el => {
        parts.push(renderElement(el));
      });
    }

    parts.push('</article>');
  });

  return `<div class="format-monospace">\n${parts.join('\n')}\n</div>`;
}

export default renderMonospace;
