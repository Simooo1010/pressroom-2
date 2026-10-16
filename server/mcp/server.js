// ─── Pressroom MCP server ────────────────────────────────────────
// Tools let an AI assistant turn a Substack article/note into a PDF
// with the exact same output as the Pressroom web app.
// ──────────────────────────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FORMATS, FONTS, RANGES } from './options.js';
import { withRenderedApp, listImages, makePdf, firstPagePng, pageCount } from './render.js';
import { assertAllowedHost } from '../urlGuard.js';
import { saveFile } from './files.js';

const ASK = ' If the user has not explicitly specified formatting preferences (format, font, font size, line spacing, margins, video embeds), ASK THEM with your native question UI before calling this tool; offer the choices from list_options. Never silently invent preferences.';

const optionShape = {
  format: z.enum(FORMATS).optional().describe('Layout: ' + FORMATS.join(', ') + ' (default: default)'),
  font: z.enum(Object.keys(FONTS)).optional().describe('Font: ' + Object.entries(FONTS).map(([k, v]) => `${k}=${v}`).join('; ')),
  fontSize: z.number().min(RANGES.fontSize.min).max(RANGES.fontSize.max).optional().describe('Font size in pt, 8-36 (default 12)'),
  lineSpacing: z.number().min(RANGES.lineSpacing.min).max(RANGES.lineSpacing.max).optional().describe('Line spacing 1.0-3.0 (default 1.6)'),
  margin: z.number().min(RANGES.margin.min).max(RANGES.margin.max).optional().describe('Page margin in mm, 0-80 (default 25)'),
  excludeEmbeds: z.boolean().optional().describe('Exclude video embeds (default false)'),
};
const urlShape = z.string().url().describe('URL of a Substack article (https://x.substack.com/p/slug) or Note (…/note/…)');
const removeShape = z.array(z.number().int().min(0)).max(100).optional().describe('Image ids (from inspect_article) to remove from the document');

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });
const split = (a) => ({ url: a.url, removeImages: a.removeImages, options: { format: a.format, font: a.font, fontSize: a.fontSize, lineSpacing: a.lineSpacing, margin: a.margin, excludeEmbeds: a.excludeEmbeds } });

export function createMcpServer({ baseUrl }) {
  const server = new McpServer({ name: 'pressroom', version: '1.0.0' });

  server.registerTool('list_options', {
    description: 'List every formatting option Pressroom supports (formats, fonts, ranges, defaults). Call this before asking the user for their preferences.',
    inputSchema: {},
  }, async () => text(JSON.stringify({ formats: FORMATS, fonts: FONTS, ranges: RANGES, excludeEmbeds: 'boolean, default false', note: 'Paywalled posts: only the publicly visible part is included.' }, null, 2)));

  server.registerTool('inspect_article', {
    description: 'Fetch a Substack article/note and list its images (id, URL, size) and page count with the given options, so the user can choose images to remove. Does not create a PDF.' + ASK,
    inputSchema: { url: urlShape, ...optionShape },
  }, async (a) => {
    try {
      assertAllowedHost(a.url);
      const r = await withRenderedApp(split(a), async (page, ctx) => ({
        title: ctx.article?.title, author: ctx.article?.author, pages: await pageCount(page), images: await listImages(page),
      }));
      return text(JSON.stringify(r, null, 2));
    } catch (e) { return fail(e); }
  });

  server.registerTool('preview_article', {
    description: 'Render the FIRST page as a PNG image so the user can check the look (format, font, margins) before the final PDF.' + ASK,
    inputSchema: { url: urlShape, removeImages: removeShape, ...optionShape },
  }, async (a) => {
    try {
      assertAllowedHost(a.url);
      const r = await withRenderedApp(split(a), async (page, ctx) => ({ png: await firstPagePng(page), pages: await pageCount(page), title: ctx.article?.title }));
      return { content: [
        { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `Preview of page 1 of ${r.pages} — "${r.title || ''}".` },
      ] };
    } catch (e) { return fail(e); }
  });

  server.registerTool('generate_pdf', {
    description: 'Generate the final PDF of a Substack article/note, identical to what the Pressroom web app produces. Returns a temporary download link (valid ~30 min) and, when supported, the PDF file itself.' + ASK,
    inputSchema: { url: urlShape, removeImages: removeShape, ...optionShape },
  }, async (a) => {
    try {
      assertAllowedHost(a.url);
      const r = await withRenderedApp(split(a), async (page, ctx) => {
        const { pdf, title } = await makePdf(page, ctx.article);
        return { pdf, title, pages: await pageCount(page), options: ctx.options };
      });
      const filename = `${r.title || 'pressroom-article'}.pdf`;
      const { id, expiresAt } = saveFile(r.pdf, filename);
      const link = `${baseUrl}/files/${id}/${encodeURIComponent(filename)}`;
      const content = [{ type: 'text', text: `PDF ready: ${filename} — ${r.pages} pages, ${(r.pdf.length / 1024).toFixed(0)} KB.\nDownload (expires ${expiresAt}): ${link}\nOptions used: ${JSON.stringify(r.options)}` }];
      if (r.pdf.length <= 8 * 1024 * 1024) {
        content.push({ type: 'resource', resource: { uri: `pressroom://pdf/${id}`, mimeType: 'application/pdf', blob: r.pdf.toString('base64') } });
      }
      return { content };
    } catch (e) { return fail(e); }
  });

  return server;
}
