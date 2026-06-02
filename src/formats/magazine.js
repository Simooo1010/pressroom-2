/**
 * magazine.js — Editorial magazine format renderer for Pressroom.
 *
 * Produces a visually rich layout with a full-bleed hero image,
 * alternating image sizes, large pull-quotes, uppercase section
 * headings, and generous whitespace. Wrapped in
 * <div class="format-magazine">.
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
 * Render a single element.
 *
 * @param {Object}          el        – element from the article
 * @param {{value: number}} imgCount  – mutable image counter for alt layouts
 * @returns {string}
 */
function renderElement(el, imgCount) {
  switch (el.type) {
    case 'paragraph':
      return `<p>${el.content}</p>`;

    case 'heading': {
      const level = Math.min(Math.max(el.level || 2, 1), 6);
      const tag = `h${level}`;
      return `<${tag} class="magazine-section">${el.content}</${tag}>`;
    }

    case 'blockquote':
      return `<blockquote>${el.content}</blockquote>`;

    case 'pullquote':
      return `<aside class="magazine-pullquote">${el.content}</aside>`;

    case 'image': {
      imgCount.value++;
      // Odd images → full-width, even images → floated with text wrap
      const layoutClass = imgCount.value % 2 === 1
        ? 'magazine-img-full'
        : 'magazine-img-float';
      return [
        `<figure class="${layoutClass}">`,
        `  <img src="${escAttr(el.src)}" alt="${escAttr(el.alt || el.caption || '')}">`,
        el.caption ? `  <figcaption>${el.caption}</figcaption>` : '',
        '</figure>',
      ].filter(Boolean).join('\n');
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
      return el.html || '';

    default:
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the editorial magazine format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderMagazine(articles) {
  const list = ensureArray(articles);
  const parts = [];

  list.forEach((article, idx) => {
    if (idx > 0) {
      parts.push('<div class="page-break"></div>');
    }

    parts.push('<article class="magazine-article">');

    // ── Title area ──────────────────────────────────────────────
    parts.push('<header class="magazine-header">');
    if (article.title) {
      parts.push(`  <h1 class="magazine-title">${article.title}</h1>`);
    }

    // Styled byline: author in caps, date
    const bylineParts = [];
    if (article.author) {
      bylineParts.push(`<span class="magazine-author">${article.author.toUpperCase()}</span>`);
    }
    if (article.date) {
      bylineParts.push(`<span class="magazine-date">${article.date}</span>`);
    }
    if (bylineParts.length) {
      parts.push(`  <p class="magazine-byline">${bylineParts.join(' · ')}</p>`);
    }
    parts.push('</header>');

    // Hero image — full-bleed
    if (article.heroImage) {
      parts.push([
        '<figure class="magazine-hero">',
        `  <img src="${escAttr(article.heroImage)}" alt="">`,
        '</figure>',
      ].join('\n'));
    }

    // ── Body elements (in order) ────────────────────────────────
    parts.push('<div class="magazine-body">');
    const imgCount = { value: 0 };

    if (article.elements && article.elements.length) {
      article.elements.forEach(el => {
        parts.push(renderElement(el, imgCount));
      });
    }
    parts.push('</div>');

    parts.push('</article>');
  });

  return `<div class="format-magazine">\n${parts.join('\n')}\n</div>`;
}

export default renderMagazine;
