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
import { closeBrowser } from './mcp/render.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';
const MCP_SECRET = process.env.MCP_SECRET || '';
const MCP_ENABLED = MCP_SECRET.length >= 24;
if (MCP_SECRET && !MCP_ENABLED) {
  console.error('[mcp] MCP_SECRET is shorter than 24 characters: MCP endpoint DISABLED. Use e.g. `openssl rand -hex 32`.');
}

// /api/pdf renders arbitrary caller-supplied HTML in Chromium (--no-sandbox, no
// request filtering): a full-read SSRF primitive. The web app never calls it
// (it prints client-side), so it is off on public deployments unless opted in.
const API_PDF_ENABLED = process.env.PRESSROOM_ENABLE_API_PDF === '1' || (!IS_PROD && !MCP_SECRET);

// Behind a TLS-terminating proxy (Railway/Render/Fly/nginx) trust X-Forwarded-Proto
// so generated download links use https. TRUST_PROXY overrides (express syntax:
// "true", "false", hop count, or comma-separated subnets).
const TRUST_PROXY = process.env.TRUST_PROXY;
app.set('trust proxy',
  TRUST_PROXY === undefined ? (IS_PROD ? 1 : false)
    : TRUST_PROXY === 'true' ? true
    : TRUST_PROXY === 'false' ? false
    : /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY)
    : TRUST_PROXY);
app.disable('x-powered-by');

// ─── Health check (for container hosts / load balancers) ─────────

app.get('/healthz', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true }));

// No OAuth here (auth = secret URL / bearer). Answer discovery probes with a
// clean 404 instead of the SPA's index.html, so MCP clients don't misparse it.
app.all('/.well-known/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Middleware ───────────────────────────────────────────────────

app.use(cors());

// ─── MCP endpoint (remote, stateless Streamable HTTP) ────────────
// Enabled only when MCP_SECRET (>= 24 chars) is set. URL: /mcp/<MCP_SECRET>
// (also accepts "Authorization: Bearer <MCP_SECRET>" on /mcp).
// Registered before the body parser so unauthenticated requests are
// rejected without reading/parsing their body.

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
const SECRET_DIGEST = digest(MCP_SECRET);
const safeEq = (given) => crypto.timingSafeEqual(digest(given), SECRET_DIGEST); // constant-time, length-independent

function publicBaseUrl(req) {
  const fixed = (process.env.PUBLIC_BASE_URL || '').trim();
  if (fixed) return fixed.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
if (process.env.PUBLIC_BASE_URL && !/^https?:\/\/[^/\s]+/i.test(process.env.PUBLIC_BASE_URL.trim())) {
  console.warn('[mcp] PUBLIC_BASE_URL should look like https://your-host (no path).');
}

if (MCP_ENABLED) {
  const mcpAuth = (req, res, next) => {
    const bearer = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const given = req.params.secret !== undefined ? req.params.secret : bearer;
    if (given === undefined || !safeEq(given)) {
      res.set('WWW-Authenticate', 'Bearer realm="pressroom-mcp"');
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream (GET) and no sessions to DELETE.
      res.set('Allow', 'POST');
      return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    }
    next();
  };
  const mcpHandler = async (req, res) => {
    const server = createMcpServer({ baseUrl: publicBaseUrl(req) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] Error:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
  const mcpJson = express.json({ limit: '1mb' });
  const mcpBodyError = (err, _req, res, _next) => {
    res.status(err.status || 400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  };
  app.all('/mcp/:secret', mcpAuth, mcpJson, mcpHandler, mcpBodyError);
  app.all('/mcp', mcpAuth, mcpJson, mcpHandler, mcpBodyError);

  // Temporary PDF downloads (unguessable 192-bit id, expires)
  app.get('/files/:id/:name?', (req, res) => {
    const f = getFile(req.params.id);
    if (!f) return res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Expired or not found.');
    const ascii = f.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.set({
      'Content-Type': f.mime,
      'Content-Length': f.buffer.length,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(f.buffer);
  });
}
// Anything else under these prefixes (or everything, when MCP is off) is a
// plain 404 — never the SPA's index.html.
app.all(['/mcp', '/mcp/*', '/files', '/files/*'], (_req, res) => res.status(404).json({ error: 'Not found' }));

// Small JSON bodies everywhere except /api/pdf (HTML payloads, parsed on its own route).
const smallJson = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/pdf' ? next() : smallJson(req, res, next)));

// ─── In production, serve the built Vite front-end ───────────────

// CSP for the app's HTML: scraped article HTML is injected with innerHTML, so
// forbid inline/event-handler scripts and restrict fetch/WebSocket to same-origin.
// (Also protects the headless renderer used by MCP: Chromium request interception
// does not see WebSocket traffic.) Images, media and embeds may come from anywhere.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'frame-src *',
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const setHtmlHeaders = (res) => {
  res.set('Content-Security-Policy', APP_CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
};

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) setHtmlHeaders(res); },
  }));
}

// ─── POST /api/parse ─────────────────────────────────────────────
// Accepts EITHER:
//   { url: "https://example.substack.com/p/article-slug" }   → single article
//   { publication: "example", count: 5 }                     → latest N posts
// Returns: { articles: [ ...structuredArticleJSON ] }

app.post('/api/parse', async (req, res) => {
  try {
    const { url, publication, count } = req.body || {};
    if ((url !== undefined && typeof url !== 'string') || (publication !== undefined && typeof publication !== 'string')) {
      return res.status(400).json({ error: '`url` and `publication` must be strings.' });
    }

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

app.post('/api/pdf', (req, res, next) => (API_PDF_ENABLED ? next() : res.status(404).json({ error: 'Not found' })),
  express.json({ limit: '10mb' }), async (req, res) => {
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
    setHtmlHeaders(res);
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Start ───────────────────────────────────────────────────────

const httpServer = app.listen(PORT, () => {
  console.log(`\n  🗞️  Pressroom server running at http://localhost:${PORT}\n`);
  console.log(`  MCP: ${MCP_ENABLED ? 'enabled (/mcp/<secret>)' : 'disabled'} · /api/pdf: ${API_PDF_ENABLED ? 'enabled' : 'disabled'}\n`);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    httpServer.close();
    closeBrowser().catch(() => {}).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
