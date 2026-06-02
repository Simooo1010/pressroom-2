// ─── Pressroom Server ─────────────────────────────────────────────
// Express entry point – handles article parsing requests and PDF generation.
// Run with: node server/index.js
// ──────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseArticle, parseNote } from './parser.js';
import { fetchLatestPosts } from './rss.js';
import { generatePDF } from './pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' })); // large limit for PDF HTML payloads

// ─── In production, serve the built Vite front-end ───────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
}

// ─── POST /api/parse ─────────────────────────────────────────────
// Accepts EITHER:
//   { url: "https://example.substack.com/p/article-slug" }   → single article
//   { publication: "example", count: 5 }                     → latest N posts
// Returns: { articles: [ ...structuredArticleJSON ] }

app.post('/api/parse', async (req, res) => {
  try {
    const { url, publication, count } = req.body;

    // ── Single article mode ──
    if (url) {
      // Detect whether the URL points to a Substack Note
      const isNote = url.includes('/note/');
      const article = isNote
        ? await parseNote(url)
        : await parseArticle(url);

      return res.json({ articles: [article] });
    }

    // ── Publication / batch mode ──
    if (publication) {
      const postCount = Math.min(Number(count) || 5, 50); // cap at 50
      const posts = await fetchLatestPosts(publication, postCount);

      // Parse every article URL returned by the feed
      const articles = await Promise.all(
        posts.map((post) => parseArticle(post.url))
      );

      return res.json({ articles });
    }

    return res.status(400).json({
      error: 'Provide either { url } for a single article or { publication, count } for batch mode.',
    });
  } catch (err) {
    console.error('[/api/parse] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to parse article(s).' });
  }
});

// ─── POST /api/pdf ───────────────────────────────────────────────
// Accepts: { html: string, css: string, format?: string }
// Returns: application/pdf binary

app.post('/api/pdf', async (req, res) => {
  try {
    const { html, css, format } = req.body;

    if (!html) {
      return res.status(400).json({ error: 'Missing required field: html' });
    }

    const pdfBuffer = await generatePDF(html, css || '', { format: format || 'A4' });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="pressroom-article.pdf"',
      'Content-Length': pdfBuffer.length,
    });

    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[/api/pdf] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate PDF.' });
  }
});

// ─── Catch-all: serve index.html in production (SPA routing) ────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Start ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  🗞️  Pressroom server running at http://localhost:${PORT}\n`);
});
