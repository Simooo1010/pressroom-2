// ─── Substack Article Parser ──────────────────────────────────────
// Fetches a Substack post URL, loads it into Cheerio, and returns a
// structured JSON representation of every content element in exact
// document order.  Designed for 100 % content fidelity.
// ──────────────────────────────────────────────────────────────────

import * as cheerio from 'cheerio';
import { safeFetch } from './urlGuard.js';

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Pick the highest-resolution URL from a `srcset` attribute.
 * Falls back to the plain `src` when srcset isn't available.
 */
function getBestImageSrc($img) {
  const srcset = $img.attr('srcset');
  if (srcset) {
    // Substack URLs can contain commas (e.g. w_1456,c_limit)
    // We use a regex to safely extract the URL and width descriptor
    const regex = /(\S+)\s+(\d+)w/g;
    let match;
    let best = '';
    let bestWidth = 0;
    
    while ((match = regex.exec(srcset)) !== null) {
      const w = parseInt(match[2], 10);
      if (w > bestWidth) {
        bestWidth = w;
        best = match[1];
      }
    }
    if (best) return best;
  }

  return $img.attr('src') || '';
}

/**
 * Recursively walk a container element's direct children and build
 * an ordered elements array.  This is the heart of the parser.
 */
function walkChildren($, container) {
  const elements = [];

  container.children().each((_i, child) => {
    const $el = $(child);
    const tag = (child.tagName || '').toLowerCase();

    // Skip hidden elements, script/style tags, and empty text nodes
    if (['script', 'style', 'noscript'].includes(tag)) return;

    // Skip Substack CTA / subscription elements
    if (
      $el.hasClass('subscription-widget-wrap') ||
      $el.hasClass('subscribe-widget') ||
      $el.hasClass('paywall-jump') ||
      $el.hasClass('footer-wrap') ||
      $el.hasClass('post-footer') ||
      $el.hasClass('share-dialog') ||
      $el.hasClass('like-button-container') ||
      $el.hasClass('custom-theme-background')
    ) {
      return;
    }

    // Skip form elements
    if (tag === 'form') return;

    // ── Captioned image container (Substack wraps images + captions) ──
    if (
      $el.hasClass('captioned-image-container') ||
      $el.hasClass('image-container') ||
      $el.hasClass('captioned-image-wrap')
    ) {
      const $img = $el.find('img').first();
      const captionEl = $el.find('.image-caption, figcaption').first();

      if ($img.length) {
        elements.push({
          type: 'image',
          src: getBestImageSrc($img),
          caption: captionEl.length ? captionEl.text().trim() : '',
          alt: $img.attr('alt') || '',
        });
      }
      return; // already consumed the children
    }

    // ── Figure (may contain img + figcaption) ──
    if (tag === 'figure') {
      const $img = $el.find('img').first();
      const $caption = $el.find('figcaption').first();

      if ($img.length) {
        elements.push({
          type: 'image',
          src: getBestImageSrc($img),
          caption: $caption.length ? $caption.text().trim() : '',
          alt: $img.attr('alt') || '',
        });
        return;
      }

      // Figure might wrap other content (e.g. an embed) — fall through
    }

    // ── Headings ──
    if (/^h[1-6]$/.test(tag)) {
      elements.push({
        type: 'heading',
        level: parseInt(tag[1], 10),
        content: $el.text().trim(),
      });
      return;
    }

    // ── Horizontal rule ──
    if (tag === 'hr') {
      elements.push({ type: 'separator' });
      return;
    }

    // ── Blockquote / pull-quote ──
    if (tag === 'blockquote') {
      if ($el.hasClass('pullquote')) {
        elements.push({ type: 'pullquote', content: $el.text().trim() });
      } else {
        elements.push({ type: 'blockquote', content: $el.html().trim() });
      }
      return;
    }

    // ── Pull-quote (class on a div/p) ──
    if ($el.hasClass('pullquote')) {
      elements.push({ type: 'pullquote', content: $el.text().trim() });
      return;
    }

    // ── Ordered / unordered lists ──
    if (tag === 'ul' || tag === 'ol') {
      const items = [];
      $el.children('li').each((_j, li) => {
        items.push($(li).html().trim());
      });
      elements.push({
        type: 'list',
        ordered: tag === 'ol',
        items,
      });
      return;
    }

    // ── Code blocks (pre > code) ──
    if (tag === 'pre') {
      const $code = $el.find('code').first();
      const language =
        ($code.attr('class') || '')
          .split(/\s+/)
          .find((c) => c.startsWith('language-'))
          ?.replace('language-', '') || '';

      elements.push({
        type: 'code',
        language,
        content: ($code.length ? $code.text() : $el.text()).trim(),
      });
      return;
    }

    // ── Tables ──
    if (tag === 'table') {
      elements.push({
        type: 'table',
        html: $.html($el).trim(),
      });
      return;
    }

    // ── Standalone images (not inside a captioned container) ──
    if (tag === 'img') {
      const src = getBestImageSrc($el);
      if (src) {
        elements.push({
          type: 'image',
          src,
          caption: '',
          alt: $el.attr('alt') || '',
        });
      }
      return;
    }

    // ── Embeds: iframes (YouTube, etc.) ──
    if (tag === 'iframe') {
      elements.push({
        type: 'embed',
        provider: detectEmbedProvider($el.attr('src') || ''),
        url: $el.attr('src') || '',
        html: $.html($el).trim(),
      });
      return;
    }

    // ── Embeds: Twitter / tweet containers ──
    if (
      $el.hasClass('tweet') ||
      $el.hasClass('twitter-tweet') ||
      $el.find('.twitter-tweet, .tweet').length
    ) {
      elements.push({
        type: 'embed',
        provider: 'twitter',
        url: $el.find('a[href*="twitter.com"], a[href*="x.com"]').last().attr('href') || '',
        html: $.html($el).trim(),
      });
      return;
    }

    // ── Embeds: generic embed containers ──
    if (
      $el.hasClass('embed-wrapper') ||
      $el.hasClass('embedded-post-wrap') ||
      tag === 'embed' ||
      tag === 'object'
    ) {
      const iframeSrc = $el.find('iframe').first().attr('src') || '';
      elements.push({
        type: 'embed',
        provider: detectEmbedProvider(iframeSrc),
        url: iframeSrc,
        html: $.html($el).trim(),
      });
      return;
    }

    // ── Paragraphs ──
    if (tag === 'p') {
      const inner = $el.html()?.trim();
      // Skip truly empty paragraphs
      if (inner && inner !== '') {
        // Check if this paragraph only contains an image
        const $pImg = $el.find('img');
        if ($pImg.length === 1 && $el.text().trim() === '') {
          elements.push({
            type: 'image',
            src: getBestImageSrc($pImg),
            caption: '',
            alt: $pImg.attr('alt') || '',
          });
        } else {
          elements.push({ type: 'paragraph', content: inner });
        }
      }
      return;
    }

    // ── Divs & sections — recurse into them to find nested content ──
    if (['div', 'section', 'article', 'aside', 'main', 'span', 'a'].includes(tag)) {
      const nested = walkChildren($, $el);
      elements.push(...nested);
      return;
    }

    // ── Fallback: any other element with meaningful text → paragraph ──
    const text = $el.text().trim();
    if (text) {
      elements.push({ type: 'paragraph', content: $el.html()?.trim() || text });
    }
  });

  return elements;
}

/**
 * Detect the embed provider from a URL string.
 */
function detectEmbedProvider(url) {
  if (!url) return 'unknown';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('spotify.com')) return 'spotify';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  if (url.includes('substack.com')) return 'substack';
  return 'unknown';
}

// ─── Substack Notes: window._preloads JSON ──────────────────────
// A Note page is a client-rendered shell: the note itself only exists in
// `window._preloads = JSON.parse("…")` (feedData.feedItem.comment), whose
// `body_json` is a ProseMirror document. We convert it to the same element
// schema walkChildren() produces.

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttrHtml = (s) => escHtml(s).replace(/"/g, '&quot;');
const SAFE_HREF = /^(https?:|mailto:)/i;

/** Read a JS string literal starting at s[i] (the opening quote); returns its decoded value. */
function readJsString(s, i) {
  const q = s[i];
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === q) return { value: out, end: j + 1 };
    if (c !== '\\') { out += c; continue; }
    const n = s[++j];
    switch (n) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case 'x': out += String.fromCharCode(parseInt(s.substr(j + 1, 2), 16)); j += 2; break;
      case 'u':
        if (s[j + 1] === '{') { const k = s.indexOf('}', j); out += String.fromCodePoint(parseInt(s.slice(j + 2, k), 16)); j = k; }
        else { out += String.fromCharCode(parseInt(s.substr(j + 1, 4), 16)); j += 4; }
        break;
      case '\r': if (s[j + 1] === '\n') j++; break; // line continuation
      case '\n': case ' ': case ' ': break;
      default: out += n; // \" \' \\ \/ and any other escaped char
    }
  }
  throw new Error('unterminated string literal');
}

/** Read a JSON object literal starting at s[i] ('{'), balancing braces outside strings. */
function readJsonObject(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"') { j = readJsString(s, j).end - 1; continue; }
    if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return JSON.parse(s.slice(i, j + 1));
  }
  throw new Error('unterminated object literal');
}

/** Extract window._preloads from a page's inline scripts (JSON.parse("…") or a plain object literal). */
export function extractPreloads(html) {
  const re = /window\._preloads\s*=\s*/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      let i = m.index + m[0].length;
      const jp = /^JSON\.parse\(\s*/.exec(html.slice(i, i + 32));
      if (jp) {
        i += jp[0].length;
        if (!`"'\``.includes(html[i])) continue;
        return JSON.parse(readJsString(html, i).value);
      }
      if (html[i] === '{') return readJsonObject(html, i);
    } catch (err) {
      console.warn('[parser] could not decode window._preloads:', err.message);
    }
  }
  return null;
}

/** Depth-first search for the first object matching `pred` (bounded, cycle-safe). */
function findDeep(root, pred, limit = 20000) {
  const stack = [root];
  const seen = new Set();
  while (stack.length && limit-- > 0) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (!Array.isArray(v) && pred(v)) return v;
    const vals = Array.isArray(v) ? v : Object.values(v);
    for (let k = vals.length - 1; k >= 0; k--) stack.push(vals[k]);
  }
  return null;
}

/** Locate the note (a "comment" object) inside _preloads, preferring the id from the URL (…/note/c-123). */
function findNote(preloads, url) {
  if (!preloads) return null;
  const isNote = (o) => (o.body_json && typeof o.body_json === 'object') || (typeof o.body === 'string' && ('handle' in o || 'user_id' in o));
  const id = Number((/\/note\/c-(\d+)/.exec(url || '') || [])[1]) || null;
  const direct = preloads.feedData?.feedItem?.comment || preloads.comment || preloads.note?.comment || null;
  if (direct && isNote(direct) && (!id || direct.id === id)) return direct;
  return (id && findDeep(preloads, (o) => o.id === id && isNote(o))) || (direct && isNote(direct) ? direct : null) || findDeep(preloads, isNote);
}

function marksHtml(text, marks = []) {
  let h = escHtml(text);
  for (const mk of marks) {
    const t = mk?.type;
    if (t === 'bold' || t === 'strong') h = `<strong>${h}</strong>`;
    else if (t === 'italic' || t === 'em') h = `<em>${h}</em>`;
    else if (t === 'code') h = `<code>${h}</code>`;
    else if (t === 'strike' || t === 'strikethrough') h = `<s>${h}</s>`;
    else if (t === 'underline') h = `<u>${h}</u>`;
    else if (t === 'superscript') h = `<sup>${h}</sup>`;
    else if (t === 'subscript') h = `<sub>${h}</sub>`;
    else if (t === 'link' && SAFE_HREF.test(mk.attrs?.href || '')) h = `<a href="${escAttrHtml(mk.attrs.href)}">${h}</a>`;
  }
  return h;
}

/** Inline ProseMirror content → HTML string. */
function inlineHtml(nodes = []) {
  return nodes.map((n) => {
    if (!n) return '';
    if (n.type === 'text') return marksHtml(n.text || '', n.marks);
    if (n.type === 'hardBreak' || n.type === 'hard_break') return '<br>';
    if (n.type === 'mention') {
      const label = n.attrs?.label || n.attrs?.name || n.attrs?.handle || '';
      return label ? escHtml(label.startsWith('@') ? label : '@' + label) : '';
    }
    if (n.type === 'emoji') return escHtml(n.attrs?.emoji || n.attrs?.name || '');
    if (n.content) return inlineHtml(n.content);
    return n.text ? escHtml(n.text) : '';
  }).join('');
}

/** Block nodes rendered as HTML (used inside list items and blockquotes). */
function blocksHtml(nodes = []) {
  return pmToElements(nodes).map((el) => {
    switch (el.type) {
      case 'paragraph': return `<p>${el.content}</p>`;
      case 'heading': return `<p><strong>${el.content}</strong></p>`;
      case 'list': { const t = el.ordered ? 'ol' : 'ul'; return `<${t}>${el.items.map((i) => `<li>${i}</li>`).join('')}</${t}>`; }
      case 'blockquote': return `<blockquote>${el.content}</blockquote>`;
      case 'code': return `<pre><code>${escHtml(el.content)}</code></pre>`;
      case 'image': return `<img src="${escAttrHtml(el.src)}" alt="${escAttrHtml(el.alt)}">`;
      case 'separator': return '<hr>';
      default: return '';
    }
  }).join('');
}

/** Block-level ProseMirror nodes → parser elements (paragraph/heading/list/blockquote/code/image/separator). */
function pmToElements(nodes = []) {
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const t = n.type;
    if (t === 'paragraph') {
      const content = inlineHtml(n.content).trim();
      if (content.replace(/<br>/g, '').trim()) out.push({ type: 'paragraph', content });
    } else if (t === 'heading') {
      const content = inlineHtml(n.content).trim();
      if (content) out.push({ type: 'heading', level: Math.min(Math.max(Number(n.attrs?.level) || 2, 1), 6), content });
    } else if (t === 'bulletList' || t === 'bullet_list' || t === 'orderedList' || t === 'ordered_list') {
      const items = (n.content || []).map((li) => blocksHtml(li.content || []).replace(/^<p>([\s\S]*)<\/p>$/, (m, inner) => (inner.includes('<p>') ? m : inner)));
      if (items.length) out.push({ type: 'list', ordered: t.startsWith('ordered'), items });
    } else if (t === 'blockquote') {
      const content = blocksHtml(n.content);
      if (content) out.push({ type: 'blockquote', content });
    } else if (t === 'codeBlock' || t === 'code_block') {
      out.push({ type: 'code', language: n.attrs?.language || '', content: (n.content || []).map((c) => c.text || '').join('') }); // raw text, like parseArticle
    } else if (t === 'horizontalRule' || t === 'horizontal_rule') {
      out.push({ type: 'separator' });
    } else if (t === 'image' || t === 'image2' || t === 'captionedImage') {
      const img = t === 'captionedImage' ? (n.content || []).find((c) => /image/i.test(c.type)) : n;
      const caption = t === 'captionedImage' ? inlineHtml((n.content || []).find((c) => c.type === 'caption')?.content) : '';
      const src = img?.attrs?.src || img?.attrs?.url;
      if (src) out.push({ type: 'image', src, caption, alt: img.attrs.alt || img.attrs.title || '' });
    } else if (Array.isArray(n.content)) {
      // Unknown container: keep inline text as a paragraph, otherwise recurse.
      if (n.content.every((c) => c.type === 'text' || c.type === 'hardBreak' || c.type === 'hard_break' || c.type === 'mention')) {
        const content = inlineHtml(n.content).trim();
        if (content) out.push({ type: 'paragraph', content });
      } else out.push(...pmToElements(n.content));
    } else if (n.text) {
      out.push({ type: 'paragraph', content: escHtml(n.text) });
    }
  }
  return out;
}

/** Plain `body` string → paragraphs (used when body_json is missing). */
function plainBodyToElements(body) {
  return String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({
    type: 'paragraph',
    content: escHtml(p).replace(/\n/g, '<br>').replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}">${u}</a>`),
  }));
}

/** Note attachments (images, linked posts, link cards) → elements appended after the text. */
function attachmentElements(attachments = []) {
  const out = [];
  for (const a of Array.isArray(attachments) ? attachments : []) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'image' || a.imageUrl) {
      const src = a.imageUrl || a.url || a.image?.url;
      if (src) out.push({ type: 'image', src, caption: '', alt: a.alt || a.caption || '' });
    } else if (a.type === 'post' && a.postRow?.post) {
      const p = a.postRow.post;
      const href = p.canonical_url || '';
      const title = escHtml(p.title || href);
      out.push({ type: 'blockquote', content: `<p><strong>${SAFE_HREF.test(href) ? `<a href="${escAttrHtml(href)}">${title}</a>` : title}</strong></p>` + (p.subtitle ? `<p>${escHtml(p.subtitle)}</p>` : '') });
    } else if (a.type === 'link' && a.linkMetadata) {
      const l = a.linkMetadata;
      const href = l.url || l.original_url || '';
      if (!SAFE_HREF.test(href)) continue;
      out.push({ type: 'blockquote', content: `<p><strong><a href="${escAttrHtml(href)}">${escHtml(l.title || href)}</a></strong></p>` + (l.description ? `<p>${escHtml(l.description)}</p>` : '') });
    }
  }
  return out;
}

/** Plain-text title for a note: its first sentence (≤ 100 chars, cut on a word boundary). */
function noteTitle(elements) {
  const first = elements.find((e) => e.type === 'paragraph' || e.type === 'heading');
  if (!first) return '';
  const text = cheerio.load(`<div>${first.content}</div>`)('div').text().replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();
  const sentence = (/^.{20,}?[.!?…](?=\s|$)/.exec(text) || [text])[0];
  // A trailing full stop reads oddly in a title (and yields "….pdf" file names); keep ?/!/….
  if (sentence.length <= 100) return sentence.replace(/\.$/, '');
  const cut = sentence.slice(0, 100);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 100).replace(/[\s,;:.-]+$/, '') + '…';
}

/**
 * Parse a Substack Note page's HTML (exported for tests).
 * Prefers the window._preloads JSON; falls back to DOM containers.
 */
export function parseNoteHtml(html, url) {
  const $ = cheerio.load(html);
  const note = findNote(extractPreloads(html), url);

  let elements = [];
  if (note) {
    elements = note.body_json?.content ? pmToElements(note.body_json.content) : [];
    if (!elements.length && note.body) elements = plainBodyToElements(note.body);
    elements.push(...attachmentElements(note.attachments));
  }
  if (!elements.length) {
    // DOM fallback: the Note body lives in .note-body, .note-content, or a similar container
    const bodyContainer =
      $('.note-body').first().length
        ? $('.note-body').first()
        : $('.note-content').first().length
          ? $('.note-content').first()
          : $('.available-content').first().length
            ? $('.available-content').first()
            : $('article').first();
    elements = walkChildren($, bodyContainer);
  }

  const pub = note?.user_primary_publication;
  const handle = note?.handle || '';
  const author =
    (note?.name || '').trim() ||
    $('.note-author, .pencraft[data-testid="AuthorName"]').first().text().trim() ||
    // meta[name=author] is just "Substack" on note pages, so only use it as a last resort
    $('meta[name="author"]').attr('content')?.trim() ||
    '';

  const publicationName =
    (pub?.name || '').trim() ||
    (handle ? `@${handle}` : '') ||
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    '';

  const date =
    note?.date ||
    $('time[datetime]').first().attr('datetime') ||
    $('meta[property="article:published_time"]').attr('content') ||
    '';

  return {
    url,
    // Notes don't have a title — derive one from the first sentence
    title: noteTitle(elements) || (author ? `Note by ${author}` : 'Substack Note'),
    subtitle: '',
    author,
    ...(handle ? { handle } : {}),
    publicationName,
    date,
    heroImage: '',
    elements,
  };
}

// ─── Main Exports ────────────────────────────────────────────────

/**
 * Parse a full Substack article URL and return structured JSON.
 *
 * @param {string} url – the full URL of the Substack post
 * @returns {Promise<Object>} – structured article object
 */
export async function parseArticle(url) {
  try {
    const response = await safeFetch(url, {
      headers: {
        // Pretend to be a browser so Substack doesn't block us
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch article: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // ── Metadata ───────────────────────────────────────────────
    const title =
      $('.post-title').first().text().trim() ||
      $('h1.post-title').first().text().trim() ||
      $('title').first().text().trim() ||
      '';

    const subtitle =
      $('.subtitle').first().text().trim() ||
      $('.post-subtitle').first().text().trim() ||
      '';

    const author =
      $('meta[name="author"]').attr('content')?.trim() ||
      $('.pencraft[data-testid="AuthorName"]').first().text().trim() ||
      $('.author-name').first().text().trim() ||
      $('.pencraft').filter(function () {
        return $(this).closest('.post-header').length > 0;
      }).first().text().trim() ||
      '';

    const publicationName =
      $('meta[property="og:site_name"]').attr('content')?.trim() ||
      $('.publication-name').first().text().trim() ||
      // Try extracting from title: "Article Name - Publication Name"
      ($('title').text().includes(' - ') ? $('title').text().split(' - ').pop().trim() : '') ||
      '';

    const date =
      $('time[datetime]').first().attr('datetime') ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      // Try parsing from visible date text near the post header
      $('.post-date').first().text().trim() ||
      '';

    const heroImage =
      $('.post-hero img').first().attr('src') ||
      $('meta[property="og:image"]').attr('content') ||
      '';

    // ── Body content ───────────────────────────────────────────
    const bodyContainer =
      $('.available-content').first().length
        ? $('.available-content').first()
        : $('.body.markup').first().length
          ? $('.body.markup').first()
          : $('article .body').first().length
            ? $('article .body').first()
            : $('.post-content').first().length
              ? $('.post-content').first()
              : $('article').first();

    const elements = walkChildren($, bodyContainer);

    return {
      url,
      title,
      subtitle,
      author,
      publicationName,
      date,
      heroImage,
      elements,
    };
  } catch (err) {
    console.error(`[parser] Error parsing article at ${url}:`, err);
    throw err;
  }
}

/**
 * Parse a Substack Note (shorter format, different DOM structure).
 *
 * @param {string} url – the full URL of the Substack Note
 * @returns {Promise<Object>} – structured note object
 */
export async function parseNote(url) {
  try {
    const response = await safeFetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch note: HTTP ${response.status} ${response.statusText}`);
    }

    return parseNoteHtml(await response.text(), url);
  } catch (err) {
    console.error(`[parser] Error parsing note at ${url}:`, err);
    throw err;
  }
}
