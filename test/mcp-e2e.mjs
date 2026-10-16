// End-to-end: MCP client → server → headless UI → PDF. Needs `npm run build` first.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startFixture } from './fixture-server.mjs';
import fs from 'fs';

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;
const SECRET = process.env.MCP_SECRET;
if (!process.env.NO_FIXTURE) await startFixture();
const client = new Client({ name: 't', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${SECRET}`)));
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const url = 'http://127.0.0.1:4100/p/test-article';
const show = (r) => r.content.map((c) => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
const ins = await client.callTool({ name: 'inspect_article', arguments: { url } }); console.log(show(ins));
const out = process.env.OUT || '/tmp';
for (const format of (process.env.FORMATS || 'default').split(',')) {
  const r = await client.callTool({ name: 'generate_pdf', arguments: { url, format, fontSize: 11, margin: 20, removeImages: process.env.RM ? [0] : [] } });
  console.log(format, show(r).split('\n').slice(0, 2).join(' | '));
  const res = r.content.find((c) => c.type === 'resource');
  if (res) fs.writeFileSync(`${out}/${format}.pdf`, Buffer.from(res.resource.blob, 'base64'));
}
const pv = await client.callTool({ name: 'preview_article', arguments: { url, format: 'magazine' } });
fs.writeFileSync(`${out}/preview.png`, Buffer.from(pv.content[0].data, 'base64')); console.log(show(pv));
await client.close();
