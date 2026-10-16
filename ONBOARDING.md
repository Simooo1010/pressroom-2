# ONBOARDING.md
Last updated: 2026-10-16 by Claude Code (read-only pass; nothing was executed)

## Stack
- JavaScript (ES modules, `"type": "module"`), no TypeScript, no framework on the front end (vanilla DOM).
- Backend: Node + Express 4, `cheerio` (HTML parsing), `rss-parser`, `puppeteer` 23 (PDF), `cors`.
- Frontend tooling: Vite 6 (dev server on :3000, proxies `/api` to :3001), `concurrently` for `npm run dev`.
- Package manager: npm (`package-lock.json` present).
- Product: turns Substack posts/notes into printable documents in 6 layouts (default, newspaper, scientific, book, monospace, magazine).

## Entry points
- Server: `server/index.js` (`npm start` / `npm run server`), port `PORT` env or 3001.
- Frontend: `index.html` loads `src/main.js` as a module. `npm run dev` runs server + Vite together; `npm run build` outputs `dist/`.
- In production (`NODE_ENV=production`) the Express server also serves `dist/` and falls back to `index.html`.
- Ad-hoc scripts (not part of the app): `test-api.mjs`, `test-dankoe.mjs` (hit a running server with `fetch`), `screenshot.mjs` (Puppeteer UI driver).

## Configuration
- Minimal. Only env vars seen: `PORT`, `NODE_ENV`. `.gitignore` lists `.env`, but no code reads dotenv `[unverified: none found]`.
- `vite.config.js`: root `.`, port 3000, `/api` proxy to `http://localhost:3001`, `outDir: dist`.
- No lint, formatter, or test runner config. No CI config (no `.github/`). No README.
- Client-side persisted state: `localStorage['pressroom-theme']` only.
- Hardcoded: Google Fonts list in `index.html` and `server/pdf.js`; browser-like User-Agent in `parser.js` and `rss.js`.

## Architecture (traced flow)
Flow traced: user pastes a Substack URL → previews it → saves as PDF.

1. `index.html` form `#fetch-form`; `src/main.js` `init()` submit handler calls `fetchArticles(input)` (`main.js:157`). State lives in a module-level `state` object (articles, activeFormat, fetchMode, options incl. `removedImages` Set).
2. `fetchArticles` POSTs `/api/parse` with `{url}` (single mode) or `{publication, count}` (publication mode).
3. `server/index.js` `POST /api/parse`:
   - `url` containing `/note/` → `parseNote`, otherwise `parseArticle` (`server/parser.js`).
   - `publication` → `fetchLatestPosts` (`server/rss.js`, builds `<sub>.substack.com/feed`, count capped at 50), then `Promise.all(parseArticle)` over each post URL.
   - Returns `{ articles: [...] }`; errors return 500 `{error}`.
4. `parser.js`: server-side `fetch` with a browser UA, `cheerio.load`, extracts metadata (title, subtitle, author, publicationName, date, heroImage) via fallback selector chains, picks a body container (`.available-content`, `.body.markup`, ...), then `walkChildren` recursively converts DOM to an ordered `elements[]` of typed objects: `paragraph, heading, image, blockquote, pullquote, list, code, table, embed, separator`. Substack CTA/subscribe widgets are skipped by class.
5. Back in the browser: `renderPreview()` (`main.js:591`) → `render()` in `src/renderer.js`. The renderer drops embeds if requested, merges runs of short paragraphs (`unifyShortParagraphs`, <160 chars), dispatches via `FORMAT_REGISTRY` to `src/formats/<format>.js` (each returns an HTML string wrapped in `.format-<name>`), then regex-tags paragraphs ending with `:` as `no-break-after`.
6. `paginatePreview(html)` (`main.js:347`) builds DOM from the HTML, applies image removals, and splits content into fixed-size page divs by measuring blocks (`extractBlocks`, `isKeepWithNext`, mm→px conversion). This is the most complex client code.
7. Output: `printPDF()` sets `document.title` to the article title and calls `window.print()`; the user saves as PDF via the browser. Styles for print are in `src/styles/print-common.css` plus `format-*.css`.

Notable: **`POST /api/pdf` (`server/pdf.js`, Puppeteer) exists but nothing in `src/` or `index.html` calls it** (grep confirmed). It appears to be a leftover from an earlier design.

## Conventions
- Naming: camelCase functions/vars, kebab-case CSS classes and file names, one `format-<name>` CSS class per layout; `FORMAT_REGISTRY` key = format name = `data-format` on `.format-btn`.
- Adding a layout means: new `src/formats/x.js`, register in `renderer.js`, add `src/styles/format-x.css` and a `<link>` in `index.html`, add a `.format-btn` `[unverified: button markup not inspected]`.
- Style: banner-comment headers (`// ─── ... ───`), JSDoc on exported functions, section dividers, generous comments.
- Errors: server routes use try/catch → `console.error` + JSON `{error}` with 500 (400 for missing input); `rss.js` maps common failures to friendly messages; client shows via `showError`.
- Tests: none. Only manual scripts against a live server and a live Substack URL.
- Commit history is all "Add files via upload" (GitHub web uploads); no meaningful history to learn from.

## Open questions / unverified
- Security: renderers interpolate scraped `el.content` / `figcaption` straight into HTML and `main.js` uses `innerHTML` with it. Any script in a fetched page's content that survives parsing would run in the app origin `[unverified: not exploited, but no sanitization is visible]`. `/api/parse` fetches arbitrary user-supplied URLs server-side (SSRF risk; no host allowlist seen). `cors()` is fully open. `/api/pdf` renders arbitrary HTML in Puppeteer with `--no-sandbox`.
- `/api/pdf` is dead code from the client's view; confirm with the owner whether to remove or revive it.
- `screenshot.mjs` has a hardcoded Windows path (`C:\Users\Utente\.gemini\...`), so it will not work as-is elsewhere.
- `preloads_parsed.json` (27 KB) and `note.html` (113 KB) are saved Substack page dumps, referenced by no code. They contain Substack's public site keys (not user secrets, but still noise). Likely fixtures or scratch files `[unverified]`.
- Paywalled posts: parser only reads whatever HTML is publicly served; behavior for paywalled content is untested `[unverified]`.
- Whether `.format-btn` markup and the full `init()` event wiring match what `screenshot.mjs` expects was not fully checked.
- Nothing was run, so dependency installs, builds, and actual behavior are unverified.

## Changelog
- 2026-10-16: Initial ONBOARDING.md created from a read-only pass (no prior version existed).
