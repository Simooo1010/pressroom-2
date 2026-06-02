// ─── Substack Article Parser ──────────────────────────────────────
// Fetches a Substack post URL, loads it into Cheerio, and returns a
// structured JSON representation of every content element in exact
// document order.  Designed for 100 % content fidelity.
// ──────────────────────────────────────────────────────────────────

import * as cheerio from 'cheerio';

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

// ─── Main Exports ────────────────────────────────────────────────

/**
 * Parse a full Substack article URL and return structured JSON.
 *
 * @param {string} url – the full URL of the Substack post
 * @returns {Promise<Object>} – structured article object
 */
export async function parseArticle(url) {
  try {
    const response = await fetch(url, {
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
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch note: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Notes have a simpler structure
    const author =
      $('meta[name="author"]').attr('content')?.trim() ||
      $('.note-author, .pencraft[data-testid="AuthorName"]').first().text().trim() ||
      '';

    const publicationName =
      $('meta[property="og:site_name"]').attr('content')?.trim() ||
      '';

    const date =
      $('time[datetime]').first().attr('datetime') ||
      $('meta[property="article:published_time"]').attr('content') ||
      '';

    // The Note body lives in .note-body, .note-content, or a similar container
    const bodyContainer =
      $('.note-body').first().length
        ? $('.note-body').first()
        : $('.note-content').first().length
          ? $('.note-content').first()
          : $('.available-content').first().length
            ? $('.available-content').first()
            : $('article').first();

    const elements = walkChildren($, bodyContainer);

    // Notes don't normally have a title — derive one from the first paragraph
    const firstText = elements.find((e) => e.type === 'paragraph' || e.type === 'heading');
    const title = firstText
      ? (firstText.content || '').replace(/<[^>]+>/g, '').slice(0, 120)
      : 'Substack Note';

    return {
      url,
      title,
      subtitle: '',
      author,
      publicationName,
      date,
      heroImage: '',
      elements,
    };
  } catch (err) {
    console.error(`[parser] Error parsing note at ${url}:`, err);
    throw err;
  }
}
