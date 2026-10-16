// Local Substack-like article for offline tests: http://127.0.0.1:4100/p/test-article
import http from 'http';
import zlib from 'zlib';

const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="${c}"/></svg>`;
const para = (i) => `<p>Paragraph ${i}. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(4)}</p>`;
const body = Array.from({ length: 30 }, (_, i) => (i === 5 ? `<div class="captioned-image-container"><figure><img src="http://127.0.0.1:4100/img/a.svg" alt="A"><figcaption>Image A</figcaption></figure></div>` : i === 14 ? `<div class="captioned-image-container"><figure><img src="http://127.0.0.1:4100/img/b.svg" alt="B"><figcaption>Image B</figcaption></figure></div>` : i % 7 === 0 ? `<h2>Section ${i}</h2>` : '') + para(i)).join('\n');
const page = `<!doctype html><html><head><meta property="og:site_name" content="Fixture Weekly"><meta property="og:image" content="http://127.0.0.1:4100/img/a.svg"></head><body><h1 class="post-title">Fixture Article Title</h1><h3 class="subtitle">A subtitle</h3><div class="available-content"><div class="body markup">${body}</div></div></body></html>`;

export function startFixture(port = 4100) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/img/')) { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(svg(req.url.includes('a') ? '#c44' : '#48c')); }
      res.setHeader('Content-Type', 'text/html'); res.end(page);
    }).listen(port, '127.0.0.1', () => resolve(s));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) startFixture().then(() => console.log('fixture on 4100'));
