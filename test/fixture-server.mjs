// Local Substack-like pages for offline tests (port is configurable: startFixture(port) or FIXTURE_PORT).
//   /p/test-article  long article, og:image hero == body image A (duplicate src)
//   /p/rich          distinct hero (.post-hero), duplicate body image, YouTube embed, list/quote/code
//   /p/missing       404
//   /p/slow?ms=N     responds after N ms (timeout tests)
//   /note/...        repo-root note.html (real Substack Note page)
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';

const NOTE_FILE = fileURLToPath(new URL('../note.html', import.meta.url));
const COLORS = { a: '#c44', b: '#48c', c: '#4a4', h: '#a4a' };
const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="${c}"/></svg>`;
const para = (i) => `<p>Paragraph ${i}. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(4)}</p>`;
const fig = (src, cap) => `<div class="captioned-image-container"><figure><img src="${src}" alt="${cap}"><figcaption>${cap}</figcaption></figure></div>`;
const doc = (head, inner) => `<!doctype html><html><head><meta property="og:site_name" content="Fixture Weekly">${head}</head><body>${inner}</body></html>`;

function pages(origin) {
  const img = (n) => `${origin}/img/${n}.svg`;
  const testBody = Array.from({ length: 30 }, (_, i) => (i === 5 ? fig(img('a'), 'Image A') : i === 14 ? fig(img('b'), 'Image B') : i % 7 === 0 ? `<h2>Section ${i}</h2>` : '') + para(i)).join('\n');
  const richBody = [
    para(1), fig(img('a'), 'Image A'), para(2),
    '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>',
    para(3), fig(`${img('b')}?w=1456,c_limit&q=80`, 'Image B (query)'), para(4),
    '<ul><li>First item</li><li>Second item</li></ul>', '<blockquote><p>A quoted passage.</p></blockquote>',
    para(5), fig(img('c'), 'Image C'), para(6), fig(img('c'), 'Image C again'), para(7),
    '<pre><code class="language-js">const x = 1;</code></pre>', para(8),
  ].join('\n');
  return {
    '/p/test-article': doc(`<meta property="og:image" content="${img('a')}">`,
      `<h1 class="post-title">Fixture Article Title</h1><h3 class="subtitle">A subtitle</h3><div class="available-content"><div class="body markup">${testBody}</div></div>`),
    '/p/rich': doc('<meta name="author" content="Ada Fixture"><meta property="article:published_time" content="2026-01-02">',
      `<div class="post-header"><h1 class="post-title">Rich Fixture</h1><h3 class="subtitle">Hero, duplicates, embeds</h3></div><div class="post-hero"><img src="${img('h')}"></div><div class="available-content"><div class="body markup">${richBody}</div></div>`),
  };
}

export function startFixture(port = Number(process.env.FIXTURE_PORT) || 4100) {
  const origin = `http://127.0.0.1:${port}`;
  const html = pages(origin);
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, origin);
      if (u.pathname.startsWith('/img/')) {
        const c = COLORS[u.pathname.slice(5, 6)] || '#888';
        res.setHeader('Content-Type', 'image/svg+xml'); return res.end(svg(c));
      }
      if (u.pathname.startsWith('/note/')) { res.setHeader('Content-Type', 'text/html'); return fs.createReadStream(NOTE_FILE).pipe(res); }
      if (u.pathname === '/p/slow') { const t = setTimeout(() => { res.setHeader('Content-Type', 'text/html'); res.end(html['/p/test-article']); }, Number(u.searchParams.get('ms')) || 5000); res.on('close', () => clearTimeout(t)); return; }
      if (html[u.pathname]) { res.setHeader('Content-Type', 'text/html'); return res.end(html[u.pathname]); }
      res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); res.end('<h1>Not found</h1>');
    });
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) startFixture().then((s) => console.log('fixture on', s.address().port));
