# Pressroom MCP server

Lets Claude / ChatGPT turn a Substack article or Note into the same PDF the Pressroom web app produces
(the server drives the real UI in headless Chromium, so layout/pagination are identical).

## Tools
| Tool | Purpose |
|---|---|
| `list_options` | formats, fonts, ranges, defaults |
| `inspect_article` | page count + image list (ids) for removal |
| `preview_article` | PNG of page 1 |
| `generate_pdf` | PDF: temporary link (30 min) + file attached when the client supports it |

Common options: `format` (default, newspaper, scientific, book, monospace, magazine), `font` (default, sans, serif, times, mono),
`fontSize` 8–36, `lineSpacing` 1.0–3.0, `margin` 0–80 mm, `excludeEmbeds`, `removeImages` (ids from `inspect_article`).
Tool descriptions instruct the assistant to ask the user for any option not stated, using its native question UI.

## Run
```
npm ci && npm run build
MCP_SECRET=<long random> NODE_ENV=production PUBLIC_BASE_URL=https://your-host node server/index.js
```
Endpoint: `https://your-host/mcp/<MCP_SECRET>` (or `/mcp` with `Authorization: Bearer <MCP_SECRET>`).
Generate a secret: `openssl rand -hex 32`. Rotate by changing the variable.

Env: `MCP_SECRET` (enables MCP), `PUBLIC_BASE_URL`, `MCP_EXTRA_HOSTS` (custom Substack domains, comma-separated; `substack.com` always allowed),
`MCP_MAX_CONCURRENT` (default 2), `MCP_JOB_TIMEOUT_MS`, `MCP_FILE_TTL_MS`, `PUPPETEER_EXECUTABLE_PATH`.

## Deploy
Any Docker host (Railway / Render / Fly): build from the `Dockerfile`, set the env vars above, expose port 3001 over HTTPS.
Not suitable for Vercel serverless (needs Chromium).

## Connect
- **Claude.ai / Desktop**: Settings → Connectors → Add custom connector → URL `https://your-host/mcp/<secret>`.
- **ChatGPT**: Settings → Connectors → Developer mode → create connector with the same URL, no auth.
- **Claude Code**: `claude mcp add --transport http pressroom https://your-host/mcp/<secret>`.

## Security notes
Only `*.substack.com` + `MCP_EXTRA_HOSTS` are accepted by the tools; private/loopback IPs are blocked (also across redirects and for page subresources).
The web app and `/api/parse` remain publicly reachable on the same host.
Paywalled posts: only the publicly served part is rendered.

## Tests
`npm run build`, start the server with `PRESSROOM_ALLOW_PRIVATE=1 MCP_EXTRA_HOSTS=127.0.0.1 MCP_SECRET=...`, then `node test/mcp-e2e.mjs` (uses a local fixture article).
