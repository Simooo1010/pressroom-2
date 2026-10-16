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
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp/server.js';
import { getFile } from './mcp/files.js';
import crypto from 'crypto';

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

// ─── MCP endpoint (remote, stateless Streamable HTTP) ────────────
// Enabled only when MCP_SECRET is set. URL: /mcp/<MCP_SECRET>
// (also accepts "Authorization: Bearer <MCP_SECRET>" on /mcp).

const MCP_SECRET = process.env.MCP_SECRET || '';
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const baseUrlOf = (req) => (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

if (MCP_SECRET) {
  if (MCP_SECRET.length < 24) console.warn('[mcp] MCP_SECRET is short; use at least 24 random chars.');
  const mcpHandler = async (req, res) => {
    const given = req.params.secret ?? (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!safeEq(given, MCP_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.method !== 'POST') {
      return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    }
    const server = createMcpServer({ baseUrl: baseUrlOf(req) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] Error:', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
  app.all('/mcp/:secret', mcpHandler);
  app.all('/mcp', mcpHandler);

  // Temporary PDF downloads (unguessable 192-bit id, expires)
  app.get('/files/:id/:name?', (req, res) => {
    const f = getFile(req.params.id);
    if (!f) return res.status(404).send('Expired or not found.');
    res.set({ 'Content-Type': f.mime, 'Content-Length': f.buffer.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'Cache-Control': 'private, no-store' });
    res.send(f.buffer);
  });
}

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
