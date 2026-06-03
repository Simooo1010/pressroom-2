/**
 * renderer.js — Central dispatcher for Pressroom format renderers.
 *
 * Imports all six format renderers and exposes two public helpers:
 *   • render(articles, format)  → full HTML string
 *   • getFormatCSS(format)      → CSS class name for the active format
 */

import { renderDefault } from './formats/default.js';
import { renderNewspaper } from './formats/newspaper.js';
import { renderScientific } from './formats/scientific.js';
import { renderBook } from './formats/book.js';
import { renderMonospace } from './formats/monospace.js';
import { renderMagazine } from './formats/magazine.js';

// ── Format registry ────────────────────────────────────────────────
// Maps a format key to its renderer function and root CSS class.
const FORMAT_REGISTRY = {
  default:    { renderer: renderDefault,    css: 'format-default' },
  newspaper:  { renderer: renderNewspaper,  css: 'format-newspaper' },
  scientific: { renderer: renderScientific, css: 'format-scientific' },
  book:       { renderer: renderBook,       css: 'format-book' },
  monospace:  { renderer: renderMonospace,  css: 'format-monospace' },
  magazine:   { renderer: renderMagazine,   css: 'format-magazine' },
};

/**
 * Render one or more articles using the specified format.
 *
 * @param {Object|Object[]} articles  – A single article object or an array.
 * @param {string}          format    – One of the registered format keys.
 * @returns {string} Complete HTML string produced by the chosen renderer.
 */
function unifyShortParagraphs(elements) {
  if (!elements || elements.length === 0) return [];
  const result = [];
  let currentGroup = [];

  const isMergeable = (el) => {
    if (!el || el.type !== 'paragraph') return false;
    const content = (el.content || '').trim();
    if (content.length === 0) return false;
    if (content.length >= 160) return false; // threshold for a very short paragraph

    // Check if it ends with a colon (indicates introductory text for list/quote)
    if (content.endsWith(':')) return false;

    // Check if it starts with a list marker (numbers, alphabet, bullets)
    if (/^\s*\d+[\.\)]\s+/.test(content)) return false;
    if (/^\s*[a-zA-Z][\.\)]\s+/.test(content)) return false;
    if (/^\s*[\-\*\u2022\u25E6\u25AA]\s+/.test(content)) return false;

    return true;
  };

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (isMergeable(el)) {
      currentGroup.push(el);
    } else {
      if (currentGroup.length > 0) {
        if (currentGroup.length >= 2) {
          const mergedContent = currentGroup.map(p => p.content.trim()).join(' ');
          result.push({ type: 'paragraph', content: mergedContent });
        } else {
          result.push(currentGroup[0]);
        }
        currentGroup = [];
      }
      result.push(el);
    }
  }

  if (currentGroup.length > 0) {
    if (currentGroup.length >= 2) {
      const mergedContent = currentGroup.map(p => p.content.trim()).join(' ');
      result.push({ type: 'paragraph', content: mergedContent });
    } else {
      result.push(currentGroup[0]);
    }
  }

  return result;
}

export function render(articles, format = 'default', options = {}) {
  const entry = FORMAT_REGISTRY[format];

  let processArticles = Array.isArray(articles) ? articles : [articles];

  // Process elements for each article
  processArticles = processArticles.map(article => {
    let elements = article.elements ? [...article.elements] : [];

    if (options.excludeEmbeds) {
      elements = elements.filter(el => el.type !== 'embed');
    }

    elements = unifyShortParagraphs(elements);

    return {
      ...article,
      elements
    };
  });

  let html;
  if (!entry) {
    console.warn(
      `[Pressroom] Unknown format "${format}". Falling back to "default".`
    );
    html = FORMAT_REGISTRY.default.renderer(processArticles);
  } else {
    html = entry.renderer(processArticles);
  }

  // Tag paragraphs ending with a colon with class "no-break-after" to prevent print page break splits
  html = html.replace(/<p>((?:(?!<\/p>).)*:[ \t\r\n]*<\/p>)/g, '<p class="no-break-after">$1');

  return html;
}

/**
 * Return the CSS class name associated with a given format.
 *
 * @param {string} format – One of the registered format keys.
 * @returns {string} CSS class name (e.g. 'format-newspaper').
 */
export function getFormatCSS(format = 'default') {
  const entry = FORMAT_REGISTRY[format];
  return entry ? entry.css : FORMAT_REGISTRY.default.css;
}

export default render;
