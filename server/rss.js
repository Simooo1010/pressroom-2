// ─── RSS Feed Fetcher ─────────────────────────────────────────────
// Retrieves the latest posts from a Substack publication via its
// public RSS feed.  Accepts either a bare subdomain ("rawandferal")
// or a full URL ("https://rawandferal.substack.com").
// ──────────────────────────────────────────────────────────────────

import Parser from 'rss-parser';

const rssParser = new Parser({
  // Substack feeds sometimes include non-standard fields
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
  // A browser-like UA to avoid blocks
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  },
  timeout: 15_000, // 15 s timeout
});

/**
 * Normalise a publication identifier into an RSS feed URL.
 *
 * Accepted inputs:
 *   "rawandferal"                              → https://rawandferal.substack.com/feed
 *   "https://rawandferal.substack.com"         → https://rawandferal.substack.com/feed
 *   "https://rawandferal.substack.com/feed"    → kept as-is
 *   "https://custom-domain.com"                → https://custom-domain.com/feed
 */
function normalizeFeedUrl(publication) {
  let base = publication.trim();

  // Already a full feed URL
  if (/^https?:\/\/.+\/feed\/?$/i.test(base)) {
    return base.replace(/\/$/, ''); // strip trailing slash
  }

  // Full URL but without /feed
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/\/+$/, '') + '/feed';
  }

  // Bare subdomain
  return `https://${base}.substack.com/feed`;
}

/**
 * Fetch the latest `count` posts from a Substack publication.
 *
 * @param {string} publication – subdomain or full URL
 * @param {number} [count=5]  – how many posts to return (max 50)
 * @returns {Promise<Array<{url, title, date, author, summary}>>}
 */
export async function fetchLatestPosts(publication, count = 5) {
  const feedUrl = normalizeFeedUrl(publication);
  const safeCount = Math.min(Math.max(1, count), 50);

  try {
    const feed = await rssParser.parseURL(feedUrl);

    const items = (feed.items || []).slice(0, safeCount).map((item) => ({
      url: item.link || '',
      title: item.title || '',
      date: item.isoDate || item.pubDate || '',
      author: item.creator || item['dc:creator'] || feed.title || '',
      summary: (item.contentSnippet || '').slice(0, 280),
    }));

    return items;
  } catch (err) {
    // Provide friendly messages for common failure modes
    if (err.message?.includes('404') || err.message?.includes('Not Found')) {
      throw new Error(
        `RSS feed not found for "${publication}". Make sure the publication subdomain or URL is correct.`
      );
    }
    if (err.message?.includes('403') || err.message?.includes('Forbidden')) {
      throw new Error(
        `Access denied for "${publication}". The publication may be private or require authentication.`
      );
    }
    if (err.code === 'ENOTFOUND') {
      throw new Error(
        `Could not resolve host for "${publication}". Check the publication name or URL.`
      );
    }

    console.error(`[rss] Error fetching feed from ${feedUrl}:`, err);
    throw new Error(`Failed to fetch RSS feed: ${err.message}`);
  }
}
