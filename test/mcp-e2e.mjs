// End-to-end: MCP client → server → headless UI → PDF. Needs `npm run build` first and a running server:
//   PORT=3001 NODE_ENV=production MCP_SECRET=... PRESSROOM_ALLOW_PRIVATE=1 MCP_EXTRA_HOSTS=127.0.0.1 node server/index.js
//   PORT=3001 MCP_SECRET=... [FIXTURE_PORT=4100] [FORMATS=default,book] [OUT=/tmp] node test/mcp-e2e.mjs
// Starts the local fixture (unless NO_FIXTURE=1) and exits non-zero if any check fails.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startFixture } from './fixture-server.mjs';
import fs from 'fs';

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;
const SECRET = process.env.MCP_SECRET;
const FPORT = Number(process.env.FIXTURE_PORT) || 4100;
const F = `http://127.0.0.1:${FPORT}`;
const FORMATS = (process.env.FORMATS || 'default,newspaper,scientific,book,monospace,magazine').split(',');
const out = process.env.OUT || '/tmp';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const pdfOf = (r) => { const c = r.content.find((x) => x.type === 'resource'); return c && Buffer.from(c.resource.blob, 'base64'); };
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
const reported = (r) => Number(textOf(r).match(/(\d+) pages/)?.[1]);

const fixture = process.env.NO_FIXTURE ? null : await startFixture(FPORT);
const connect = async () => { const c = new Client({ name: 't', version: '1' }); await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${SECRET}`))); return c; };
const client = await connect();
const call = (name, args, c = client) => c.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });

const tools = (await client.listTools()).tools.map((t) => t.name);
check(['list_options', 'inspect_article', 'preview_article', 'generate_pdf'].every((t) => tools.includes(t)), `tools: ${tools.join(', ')}`);

// Image ids: hero first, de-duplicated by URL (hero == body image A here), same ids in every format.
const url = `${F}/p/test-article`;
const ins = JSON.parse(textOf(await call('inspect_article', { url })));
check(ins.images.length === 2 && ins.images[0].hero && ins.images[0].occurrences === 2, `inspect: ${ins.pages} pages, ${ins.images.length} images (hero x${ins.images[0]?.occurrences})`);
const insBook = JSON.parse(textOf(await call('inspect_article', { url: `${F}/p/rich`, format: 'book' })));
check(insBook.images.length === 4 && insBook.images[0].hero && insBook.images[0].shown === false && insBook.images[3].occurrences === 2, 'inspect (book): hero listed but not shown, duplicate counted once');

// Every format with non-default options: PDF page count == UI page count.
for (const format of FORMATS) {
  const r = await call('generate_pdf', { url, format, font: 'serif', fontSize: 14, lineSpacing: 1.8, margin: 10, excludeEmbeds: true });
  const pdf = pdfOf(r);
  check(!r.isError && pdf && pdfPages(pdf) === reported(r), `${format}: ${reported(r)} reported pages, ${pdf ? pdfPages(pdf) : "-"} PDF pages`);
  if (pdf) fs.writeFileSync(`${out}/${format}.pdf`, pdf);
}

// Removing images reflows; works in monospace (no hover overlay there) too.
for (const format of ['default', 'monospace']) {
  const a = await call('generate_pdf', { url: `${F}/p/rich`, format });
  const b = await call('generate_pdf', { url: `${F}/p/rich`, format, removeImages: [0, 1, 3] });
  check(!b.isError && reported(b) < reported(a), `${format}: removeImages [0,1,3] → ${reported(a)} → ${reported(b)} pages`);
}
const bad = await call('generate_pdf', { url, removeImages: [9] });
check(bad.isError && /Unknown image id/.test(textOf(bad)), `invalid id → ${textOf(bad)}`);
const missing = await call('generate_pdf', { url: `${F}/p/missing` });
check(missing.isError && /404/.test(textOf(missing)), `404 → ${textOf(missing)}`);

// Notes: content comes only from window._preloads (real note.html + a rich synthetic note with an image).
const note = JSON.parse(textOf(await call('inspect_article', { url: `${F}/note/c-269399383` })));
check(note.author === 'Physics Gene' && /^Every photo on your phone/.test(note.title || '') && note.pages >= 1, `note: "${note.title}" by ${note.author}, ${note.pages} pages`);
const richNote = JSON.parse(textOf(await call('inspect_article', { url: `${F}/note/rich`, format: 'monospace' })));
check(richNote.images.length === 1 && richNote.images[0].shown, `rich note: ${richNote.pages} pages, ${richNote.images.length} image(s)`);
for (const format of ['newspaper', 'book']) {
  const r = await call('generate_pdf', { url: `${F}/note/rich`, format });
  const pdf = pdfOf(r);
  check(!r.isError && pdf && pdfPages(pdf) === reported(r), `note ${format}: ${reported(r)} pages`);
  if (pdf) fs.writeFileSync(`${out}/note-${format}.pdf`, pdf);
}

const pv = await call('preview_article', { url, format: 'magazine' });
check(pv.content[0]?.type === 'image', `preview: ${textOf(pv)}`);
if (pv.content[0]?.data) fs.writeFileSync(`${out}/preview.png`, Buffer.from(pv.content[0].data, 'base64'));

// 4 concurrent generate_pdf calls (separate MCP connections).
const t0 = Date.now();
const par = await Promise.all(['default', 'book', 'monospace', 'magazine'].map(async (format) => {
  const c = await connect(); try { return await call('generate_pdf', { url, format, removeImages: [1] }, c); } finally { await c.close(); }
}));
check(par.every((r) => !r.isError && pdfOf(r) && pdfPages(pdfOf(r)) === reported(r)), `4 parallel generate_pdf in ${Date.now() - t0} ms: ${par.map(reported).join(', ')} pages`);

await client.close();
fixture?.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
