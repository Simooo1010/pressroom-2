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

Page counts reported by `inspect_article`, `preview_article` ("page 1 of N") and `generate_pdf` are always counted
from an actual printed PDF of the same state (page objects in the PDF), so they match the file exactly.

Notes (`…/note/c-<id>`): Substack serves Notes as a client-rendered shell, so the parser reads the note from the
`window._preloads` JSON embedded in the page (`feedData.feedItem.comment`): author name, `@handle`, primary publication,
date, the ProseMirror `body_json` (paragraphs, headings, bold/italic/code/strike/links, hard breaks, bullet/ordered lists,
quotes, code blocks, rules, images) plus image/link/post attachments. It falls back to the plain `body` text, then to the
old DOM selectors. The title is the note's first sentence.

## Run
```
npm ci && npm run build
MCP_SECRET=$(openssl rand -hex 32) NODE_ENV=production PUBLIC_BASE_URL=https://your-host node server/index.js
```
Endpoint: `https://your-host/mcp/<MCP_SECRET>` (or `/mcp` with `Authorization: Bearer <MCP_SECRET>`).
`MCP_SECRET` must be at least 24 characters, otherwise MCP stays disabled. Rotate by changing the variable and restarting.
`NODE_ENV=production` is required: the renderer drives the built UI served by this same process.

Env:
| Variable | Meaning |
|---|---|
| `MCP_SECRET` | enables `/mcp` and `/files` (both return 404 when unset) |
| `PUBLIC_BASE_URL` | base for download links, e.g. `https://your-host`. If unset, links use the request's Host + `X-Forwarded-Proto` |
| `TRUST_PROXY` | Express `trust proxy` (default `1` in production = one reverse proxy in front; `false` if exposed directly) |
| `MCP_EXTRA_HOSTS` | custom Substack domains, comma-separated (`substack.com` + subdomains always allowed) |
| `MCP_MAX_CONCURRENT` | parallel renders (default 2); `MCP_JOB_TIMEOUT_MS` per-render timeout (default 90000) |
| `MCP_QUEUE_TIMEOUT_MS` | max wait for a free render slot (default 120000); after that the call fails with "The PDF renderer is busy … try again" (the job never starts) |
| `MCP_FILE_TTL_MS` | download link lifetime (default 30 min); `MCP_MAX_FILES` (50) and `MCP_FILE_STORE_MB` (200) cap the in-memory store, oldest evicted first |
| `PRESSROOM_ENABLE_API_PDF=1` | re-enable the legacy `POST /api/pdf` (off in production / when MCP is on; the web app doesn't use it) |
| `PUPPETEER_EXECUTABLE_PATH` | custom Chrome binary (not needed with the Dockerfile) |

## Deploy
Any Docker host (Railway / Render / Fly / a VM): build from the `Dockerfile`, set the env vars above, expose port 3001 (or the host's `PORT`) over HTTPS.
Health check: `GET /healthz` → `200 {"ok":true}` (also wired as Docker `HEALTHCHECK`).
The image runs as the unprivileged `pptruser` under `tini`, using the Chrome bundled in `ghcr.io/puppeteer/puppeteer:23.11.1`
(the lockfile pins puppeteer 23.11.1; the build fails early if Chrome is missing). Give it ≥1 GB RAM.
Run a **single instance** (or sticky sessions): generated files live in process memory, so a link only works on the instance that made it.
Not suitable for Vercel serverless (needs Chromium).

## Connect
- **Claude.ai / Desktop**: Settings → Connectors → Add custom connector → URL `https://your-host/mcp/<secret>`.
- **ChatGPT**: Settings → Connectors → Developer mode → create connector with the same URL, no auth.
- **Claude Code**: `claude mcp add --transport http pressroom https://your-host/mcp/<secret>`
  (or `--header "Authorization: Bearer <secret>"` with `https://your-host/mcp`).

Protocol: stateless Streamable HTTP. `POST` only; `GET`/`DELETE` answer `405` (no server-initiated stream, no sessions).
Wrong/missing secret → `401`. Tools are annotated read-only.

## Security notes
- Auth: constant-time comparison (SHA-256 digests), checked before the request body is parsed. The secret is never logged by the app,
  but a secret **in the URL** will appear in reverse-proxy / platform access logs; prefer the Bearer form where the client supports it.
- SSRF: the tools accept only `*.substack.com` + `MCP_EXTRA_HOSTS` (no credentials in URL, http(s) only). Every server-side fetch
  (`/api/parse`, RSS feeds, each redirect hop) rejects loopback/private/link-local/reserved IPv4 and IPv6 targets, including
  IPv4-mapped (`::ffff:127.0.0.1`), NAT64/6to4 forms, decimal/hex/octal IPv4 spellings and `localhost`/`.internal`/`.local`/single-label names.
  The validated IP is pinned at connect time (no DNS-rebinding window). Page subresources in the headless renderer are filtered the same way.
- The app's HTML is served with a CSP (`script-src 'self'`, `connect-src 'self'`), so scripts/event handlers in scraped article HTML
  don't run and the page can't open WebSockets/fetches to other hosts (Chromium request interception does not cover WebSockets).
- The web app and `/api/parse` remain publicly reachable on the same host (guarded as above). `/api/pdf` (arbitrary HTML → Chromium) is disabled.
- Chrome runs with `--no-sandbox` (normal in containers); the container user is non-root.
- Paywalled posts: only the publicly served part is rendered.

## Tests
`npm run build`, start the server with `NODE_ENV=production PRESSROOM_ALLOW_PRIVATE=1 MCP_EXTRA_HOSTS=127.0.0.1 MCP_SECRET=<24+ chars>`, then `node test/mcp-e2e.mjs` (uses local fixtures from `test/fixture-server.mjs`: articles, the real Note page `note.html`
and a synthetic rich Note built from `preloads_parsed.json`). Set `PORT` / `FIXTURE_PORT` to match your server and a free port.
