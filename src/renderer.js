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
export function render(articles, format = 'default', options = {}) {
  const entry = FORMAT_REGISTRY[format];

  let processArticles = Array.isArray(articles) ? articles : [articles];

  if (options.excludeEmbeds) {
    // Clone and filter elements to remove embeds
    processArticles = processArticles.map(a => ({
      ...a,
      elements: a.elements ? a.elements.filter(el => el.type !== 'embed') : []
    }));
  }

  if (!entry) {
    console.warn(
      `[Pressroom] Unknown format "${format}". Falling back to "default".`
    );
    return FORMAT_REGISTRY.default.renderer(processArticles);
  }

  return entry.renderer(processArticles);
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
