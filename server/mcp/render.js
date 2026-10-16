// ─── Render by driving the real Pressroom UI ─────────────────────
// Guarantees PDFs identical to the app: the same front-end code
// (parse → render → paginate → print CSS) runs in headless Chromium.
// ──────────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer';
import { assertPublicUrl } from '../urlGuard.js';
import { normalizeOptions } from './options.js';

const MAX_CONCURRENT = Number(process.env.MCP_MAX_CONCURRENT || 2);
const JOB_TIMEOUT_MS = Number(process.env.MCP_JOB_TIMEOUT_MS || 90_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browserPromise = null;
let active = 0;
const waiting = [];

function getBrowser() {
  if (!browserPromise) {
    const p = puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    }).then((b) => {
      // Crash / close → next job relaunches (only reset if this browser is still the current one).
      b.on('disconnected', () => { if (browserPromise === p) browserPromise = null; });
      return b;
    }, (e) => {
      if (browserPromise === p) browserPromise = null;
      throw new Error(`Could not start the PDF renderer (Chromium): ${e.message}`);
    });
    browserPromise = p;
  }
  return browserPromise;
}

async function acquire() {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active--;
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close().catch(() => {}); }
}

/** Debug/health info: running + queued jobs and open browser tabs. */
export async function renderStats() {
  const b = browserPromise ? await browserPromise.catch(() => null) : null;
  return { active, queued: waiting.length, pages: b ? (await b.pages()).length : 0 };
}

/**
 * Wait until a (re)pagination has finished and the result is stable:
 * no stale pages left (see markStale), content visible (renderPreview fades to 0),
 * images loaded, page count/text/images unchanged for several polls, fonts ready.
 */
async function settle(page, timeout = 30_000) {
  await page.waitForFunction(() => {
    const c = document.getElementById('preview-content');
    const pages = c.querySelectorAll('.preview-page');
    if (!pages.length || c.querySelector('.preview-page[data-mcp-stale]') || c.style.opacity === '0') { window.__settle = null; return false; }
    const w = (window.__settle ||= { sig: '', n: 0, t: 0 });
    const imgs = [...c.querySelectorAll('img')];
    const loaded = imgs.every((i) => i.complete);
    const sig = pages.length + ':' + c.innerText.length + ':' + imgs.length;
    const now = performance.now();
    if (now - w.t < 200) return false;
    w.t = now;
    w.n = loaded && sig === w.sig ? w.n + 1 : 0;
    w.sig = sig;
    return w.n >= 3;
  }, { timeout, polling: 50 });
  await page.evaluate(() => document.fonts.ready);
}

/** Mark the current pages so settle() waits for a fresh pagination to replace them. */
const markStale = (page) => page.evaluate(() => {
  window.__settle = null;
  document.querySelectorAll('#preview-content .preview-page').forEach((p) => p.setAttribute('data-mcp-stale', ''));
});

const clickFormat = (page, format) => page.evaluate((f) => document.querySelector(`.format-btn[data-format="${f}"]`).click(), format);

/**
 * Removable images, format-independent: hero first, then body images in document order,
 * de-duplicated by resolved URL (the app removes every occurrence of a URL at once).
 * `shown` = whether the image appears in the current format (book/scientific have no hero).
 */
async function collectImages(page, article) {
  if (!article) {
    // Fallback: images the UI makes removable in the current DOM.
    return page.evaluate(() => {
      const seen = new Map();
      document.querySelectorAll('#preview-content figure img, #preview-content img.hero-image, #preview-content .monospace-image img').forEach((img) => {
        if (!img.src) return;
        if (seen.has(img.src)) { seen.get(img.src).occurrences++; return; }
        seen.set(img.src, { id: seen.size, src: img.src, alt: img.alt || '', caption: '', width: img.naturalWidth, height: img.naturalHeight, occurrences: 1, shown: true });
      });
      return [...seen.values()];
    });
  }
  const raw = [];
  if (article.heroImage) raw.push({ src: article.heroImage, alt: '', caption: '', hero: true });
  for (const el of article.elements || []) if (el.type === 'image' && el.src) raw.push({ src: el.src, alt: el.alt || '', caption: el.caption || '' });
  return page.evaluate((raw) => {
    const dom = [...document.querySelectorAll('#preview-content img')];
    const byUrl = new Map();
    for (const r of raw) {
      let src;
      try { src = new URL(r.src, location.href).href; } catch { continue; }
      if (byUrl.has(src)) { byUrl.get(src).occurrences++; continue; }
      const img = dom.find((i) => i.src === src);
      byUrl.set(src, {
        id: byUrl.size, src, alt: r.alt, caption: r.caption, ...(r.hero ? { hero: true } : {}),
        width: img?.naturalWidth || null, height: img?.naturalHeight || null, occurrences: 1, shown: !!img,
      });
    }
    return [...byUrl.values()];
  }, raw);
}

/**
 * Remove images exactly like a user does: click the "Remove image" overlay.
 * The overlay exists for <figure> and img.hero-image, so removals are applied in the
 * "default" format (which shows every image, hero included); the app keeps the removed
 * set across format switches, so the target format then re-paginates without them.
 */
async function removeImages(page, srcs) {
  await markStale(page);
  const clicked = await page.evaluate((srcs) => {
    let n = 0;
    document.querySelectorAll('#preview-content .image-remove-wrapper').forEach((w) => {
      const img = w.querySelector('img');
      if (img && srcs.includes(img.src)) { w.querySelector('.image-remove-overlay').click(); n++; }
    });
    return n;
  }, srcs);
  if (!clicked) { await page.evaluate(() => document.querySelectorAll('[data-mcp-stale]').forEach((p) => p.removeAttribute('data-mcp-stale'))); return; }
  // 350 ms fade, then a 300 ms debounced re-pagination replaces the (stale) pages.
  await settle(page);
}

/**
 * Open the UI, apply options, fetch the article, then run `fn(page, ctx)`.
 * @param {{url:string, options?:object, removeImages?:number[]}} job
 */
export async function withRenderedApp(job, fn) {
  const opts = normalizeOptions(job.options);
  await assertPublicUrl(job.url);
  await acquire();
  let page;
  let timedOut = false;
  const timer = { id: null };
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    const killer = new Promise((_, rej) => {
      timer.id = setTimeout(() => { timedOut = true; rej(new Error(`Rendering timed out after ${Math.round(JOB_TIMEOUT_MS / 1000)} s.`)); }, JOB_TIMEOUT_MS);
    });
    const work = (async () => {
      await page.setViewport({ width: 1280, height: 900 });
      const appOrigin = `http://127.0.0.1:${process.env.PORT || 3001}`;
      let parseBody = null;
      page.on('response', (res) => {
        if (new URL(res.url()).pathname === '/api/parse' && res.request().method() === 'POST') parseBody = res.json().catch(() => null);
      });
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        try {
          const u = new URL(req.url());
          if (u.origin === appOrigin || u.protocol === 'data:' || u.protocol === 'blob:') return await req.continue();
          await assertPublicUrl(req.url()); // block SSRF from page subresources
          await req.continue();
        } catch { req.abort('blockedbyclient').catch(() => {}); }
      });
      await page.goto(appOrigin + '/', { waitUntil: 'load', timeout: 30_000 });
      await page.waitForSelector('#url-input');
      // Web fonts load lazily; if the first pagination measures with a fallback font, text
      // reflows afterwards and overflows (gets clipped by) the fixed-size pages. Preload the
      // Latin subsets of every face now (cached by the browser across jobs).
      await page.evaluate(() => Promise.race([
        Promise.all([...document.fonts].filter((f) => /^U\+0-FF\b/i.test(f.unicodeRange)).map((f) => f.load().catch(() => {}))),
        new Promise((r) => setTimeout(r, 10_000)),
      ]));
      const fontsLoaded = () => page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length);
      const fontsBefore = await fontsLoaded();

      // Removals are applied in "default" (see removeImages), then we switch to the target format.
      const wantRemove = !!job.removeImages?.length;
      const firstFormat = wantRemove ? 'default' : opts.format;
      // Options first (same events the real controls fire), then format, then fetch.
      await page.evaluate((o, f) => {
        const set = (id, v, ev) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event(ev, { bubbles: true })); };
        set('font-select', o.font, 'change');
        set('size-slider', o.fontSize, 'input');
        set('line-spacing-slider', o.lineSpacing, 'input');
        set('margin-slider', o.margin, 'input');
        const cb = document.getElementById('exclude-embeds');
        cb.checked = o.excludeEmbeds; cb.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector(`.format-btn[data-format="${f}"]`).click();
      }, opts, firstFormat);
      // Let the sliders' 300 ms debounced re-pagination fire (no-op without an article) so it
      // cannot race the pagination triggered by the fetch.
      await sleep(350);
      await page.$eval('#url-input', (el, v) => { el.value = v; }, job.url);
      await page.click('#submit-btn');
      await page.mouse.move(0, 0); // no hover state (e.g. "Remove image" overlay) in screenshots
      await page.waitForFunction(() => {
        const e = document.getElementById('error-message');
        return document.querySelector('#preview-content .preview-page') || (e && !e.classList.contains('hidden') && e.textContent.trim());
      }, { timeout: 60_000 });
      const err = await page.evaluate(() => { const e = document.getElementById('error-message'); return e && !e.classList.contains('hidden') ? e.textContent.trim() : ''; });
      if (err) throw new Error(`Could not load the article: ${err}`);
      await settle(page);
      // Content needed more faces (e.g. latin-ext / cyrillic subsets) than were preloaded: they
      // arrived after measurement, so paginate again with the final fonts (same as re-clicking the format).
      if (await fontsLoaded() > fontsBefore) { await markStale(page); await clickFormat(page, firstFormat); await settle(page); }
      const article = (await (parseBody || null))?.articles?.[0] || null;

      let images = await collectImages(page, article);
      if (wantRemove) {
        const ids = [...new Set(job.removeImages)];
        const bad = ids.filter((i) => !images[i]);
        if (bad.length) {
          throw new Error(`Unknown image id(s): ${bad.join(', ')}. ` + (images.length ? `Valid ids: 0..${images.length - 1} (call inspect_article to list them).` : 'This article has no removable images.'));
        }
        const srcs = ids.map((i) => images[i].src);
        await removeImages(page, srcs);
        if (opts.format !== 'default') { await markStale(page); await clickFormat(page, opts.format); await settle(page); }
        const left = await page.evaluate((srcs) => [...document.querySelectorAll('#preview-content img')].filter((i) => srcs.includes(i.src)).length, srcs);
        if (left) throw new Error('Could not remove the requested image(s); please try again.');
        images = images.map((im) => ({ ...im, removed: srcs.includes(im.src), shown: im.shown && !srcs.includes(im.src) }));
      }
      page.__pressroomImages = images;
      return fn(page, { options: opts, images, article });
    })();
    return await Promise.race([work, killer]);
  } catch (e) {
    if (!timedOut && /Target closed|Session closed|Protocol error|browser has disconnected|Connection closed/i.test(e.message || '')) {
      throw new Error('The PDF renderer crashed while processing this article; please try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer.id);
    if (page) {
      const closed = await Promise.race([page.close().then(() => true, () => true), sleep(5_000).then(() => false)]);
      if (!closed) { // hung renderer: drop the whole browser, the next job relaunches it
        const b = await browserPromise?.catch(() => null);
        browserPromise = null;
        b?.process()?.kill('SIGKILL');
      }
    }
    release();
  }
}

/** Removable images (id, src, alt, caption, size, occurrences, shown) — ids are what removeImages expects. */
export async function listImages(page) {
  return page.__pressroomImages || collectImages(page, null);
}

export async function makePdf(page, article) {
  const title = (article?.title || '').replace(/[\\/:*?"<>|]/g, '').trim();
  // Same document title the app sets before window.print() (becomes the PDF Title metadata).
  if (title) await page.evaluate((t) => { document.title = t; }, title);
  await page.emulateMediaType('print');
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.emulateMediaType('screen');
  return { pdf: Buffer.from(buf), title };
}

/** PNG of page 1 as the user sees it in the app, without the sticky action bar or hover overlays. */
export async function firstPagePng(page) {
  const style = await page.addStyleTag({ content: '.action-bar,.image-remove-overlay,.loading-overlay{display:none!important}' });
  try {
    const el = await page.$('.preview-page');
    return Buffer.from(await el.screenshot({ type: 'png' }));
  } finally {
    await style.evaluate((s) => s.remove()).catch(() => {});
  }
}

export async function pageCount(page) {
  return page.evaluate(() => document.querySelectorAll('.preview-page').length);
}
