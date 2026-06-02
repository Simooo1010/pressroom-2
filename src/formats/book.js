/**
 * book.js — Book / novel format renderer for Pressroom.
 *
 * Produces a title-page followed by chapter-style content with
 * indented paragraphs, plate-numbered images, and chapter-heading
 * markers. Wrapped in <div class="format-book">.
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
 * Merges consecutive paragraph elements into a single paragraph element.
 */
function mergeParagraphs(elements) {
  if (!elements || !elements.length) return [];
  const merged = [];
  let currentPara = null;

  for (const el of elements) {
    if (el.type === 'paragraph') {
      if (currentPara) {
        currentPara.content += ' ' + el.content;
      } else {
        currentPara = { ...el };
      }
    } else {
      if (currentPara) {
        merged.push(currentPara);
        currentPara = null;
      }
      merged.push(el);
    }
  }
  if (currentPara) {
    merged.push(currentPara);
  }
  return merged;
}

/**
 * Render a single element.
 *
 * @param {Object}           el              – element from the article
 * @param {{value: number}}  plateCount      – mutable plate counter
 * @param {{value: boolean}} afterHeading    – tracks whether the previous
 *                                             element was a heading
 * @returns {string}
 */
function renderElement(el, plateCount, afterHeading) {
  switch (el.type) {
    case 'paragraph': {
      // First paragraph after a heading: no indent
      const cls = afterHeading.value ? 'book-first-paragraph' : 'book-paragraph';
      afterHeading.value = false;
      return `<p class="${cls}">${el.content}</p>`;
    }

    case 'heading': {
      afterHeading.value = true;
      const level = Math.min(Math.max(el.level || 2, 1), 6);
      const tag = `h${level}`;
      return `<${tag} class="book-chapter">${el.content}</${tag}>`;
    }

    case 'blockquote':
      afterHeading.value = false;
      return `<blockquote>${el.content}</blockquote>`;

    case 'pullquote':
      afterHeading.value = false;
      return `<aside class="pullquote">${el.content}</aside>`;

    case 'image': {
      afterHeading.value = false;
      plateCount.value++;
      const caption = el.caption
        ? `Plate ${plateCount.value}: ${el.caption}`
        : `Plate ${plateCount.value}`;
      return [
        '<figure class="book-plate">',
        `  <img src="${escAttr(el.src)}" alt="${escAttr(el.alt || el.caption || '')}">`,
        `  <figcaption>${caption}</figcaption>`,
        '</figure>',
      ].join('\n');
    }

    case 'list': {
      afterHeading.value = false;
      const tag = el.ordered ? 'ol' : 'ul';
      const items = (el.items || []).map(i => `  <li>${i}</li>`).join('\n');
      return `<${tag}>\n${items}\n</${tag}>`;
    }

    case 'code': {
      afterHeading.value = false;
      const langClass = el.language ? ` class="language-${escAttr(el.language)}"` : '';
      return `<pre><code${langClass}>${el.content}</code></pre>`;
    }

    case 'separator':
      afterHeading.value = false;
      return '<hr class="book-separator">';

    case 'embed': {
      afterHeading.value = false;
      if (el.html) return `<div class="embed">${el.html}</div>`;
      if (el.url) return `<div class="embed"><a href="${escAttr(el.url)}" target="_blank">${el.url}</a></div>`;
      return '';
    }

    case 'table':
      afterHeading.value = false;
      return el.html || '';

    default:
      return `<!-- unknown element type: ${el.type} -->`;
  }
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render articles in the book / novel format.
 *
 * @param {Object|Object[]} articles
 * @returns {string} HTML string
 */
export function renderBook(articles) {
  const list = ensureArray(articles);
  const parts = [];

  // ── Title page (uses first article's metadata) ────────────────
  const first = list[0];

  parts.push('<div class="book-title-page">');
  if (first.title) {
    parts.push(`  <h1 class="book-main-title">${first.title}</h1>`);
  }
  if (first.author) {
    parts.push(`  <p class="book-author">${first.author}</p>`);
  }
  if (first.date) {
    parts.push(`  <p class="book-date">${first.date}</p>`);
  }
  parts.push('</div>');

  // ── Articles / chapters ───────────────────────────────────────
  const plateCount = { value: 0 };

  list.forEach((article, idx) => {
    parts.push(`<section class="book-content">`);

    // For subsequent articles, show an additional chapter heading
    if (idx > 0 && article.title) {
      parts.push(`<h2 class="book-chapter">${article.title}</h2>`);
    }

    const afterHeading = { value: false };

    if (article.elements && article.elements.length) {
      const mergedElements = mergeParagraphs(article.elements);
      mergedElements.forEach(el => {
        parts.push(renderElement(el, plateCount, afterHeading));
      });
    }

    parts.push('</section>');
  });

  return `<div class="format-book">\n${parts.join('\n')}\n</div>`;
}

export default renderBook;
