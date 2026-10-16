// ─── Render by driving the real Pressroom UI ─────────────────────
// Guarantees PDFs identical to the app: the same front-end code
// (parse → render → paginate → print CSS) runs in headless Chromium.
// ──────────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer';
import { assertPublicUrl } from '../urlGuard.js';
import { normalizeOptions } from './options.js';

const MAX_CONCURRENT = Number(process.env.MCP_MAX_CONCURRENT || 2);
const JOB_TIMEOUT_MS = Number(process.env.MCP_JOB_TIMEOUT_MS || 90_000);
let browserPromise = null;
let active = 0;
const waiting = [];

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    }).catch((e) => { browserPromise = null; throw e; });
    browserPromise.then((b) => b.on('disconnected', () => { browserPromise = null; }));
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
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}

/** Poll until page count, text length and image loading are stable. */
async function settle(page, timeout = 30_000) {
  await page.waitForFunction(() => document.querySelector('.preview-page'), { timeout });
  await page.waitForFunction(() => {
    const w = (window.__settle ||= { sig: '', n: 0, t: 0 });
    const imgs = [...document.querySelectorAll('#preview-content img')];
    const loaded = imgs.every((i) => i.complete);
    const sig = document.querySelectorAll('.preview-page').length + ':' + document.getElementById('preview-content').innerText.length + ':' + imgs.length;
    const now = performance.now();
    if (now - w.t < 250) return false;
    w.t = now;
    w.n = loaded && sig === w.sig ? w.n + 1 : 0;
    w.sig = sig;
    return w.n >= 3;
  }, { timeout, polling: 100 });
  await page.evaluate(() => document.fonts.ready);
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
  const timer = { id: null };
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    const killer = new Promise((_, rej) => { timer.id = setTimeout(() => rej(new Error('Rendering timed out.')), JOB_TIMEOUT_MS); });
    const work = (async () => {
      await page.setViewport({ width: 1280, height: 900 });
      const appOrigin = `http://127.0.0.1:${process.env.PORT || 3001}`;
      const parsed = { article: null };
      page.on('response', async (res) => {
        if (res.url().endsWith('/api/parse') && res.ok()) {
          try { parsed.article = (await res.json()).articles?.[0] || null; } catch {}
        }
      });
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        try {
          const u = new URL(req.url());
          if (u.origin === appOrigin || u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
          await assertPublicUrl(req.url()); // block SSRF from page subresources
          req.continue();
        } catch { req.abort('blockedbyclient').catch(() => {}); }
      });
      await page.goto(appOrigin + '/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('#url-input');

      // Options first (same events the real controls fire), then format, then fetch.
      await page.evaluate((o) => {
        const set = (id, v, ev) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event(ev, { bubbles: true })); };
        set('font-select', o.font, 'change');
        set('size-slider', o.fontSize, 'input');
        set('line-spacing-slider', o.lineSpacing, 'input');
        set('margin-slider', o.margin, 'input');
        const cb = document.getElementById('exclude-embeds');
        cb.checked = o.excludeEmbeds; cb.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector(`.format-btn[data-format="${o.format}"]`).click();
      }, opts);
      await page.type('#url-input', job.url);
      await page.click('#submit-btn');
      await Promise.race([
        page.waitForSelector('.preview-page', { timeout: 45_000 }),
        page.waitForFunction(() => { const e = document.getElementById('error-message'); return e && !e.classList.contains('hidden') && e.textContent.trim(); }, { timeout: 45_000 }),
      ]);
      const err = await page.evaluate(() => { const e = document.getElementById('error-message'); return e && !e.classList.contains('hidden') ? e.textContent.trim() : ''; });
      if (err) throw new Error(err);
      await settle(page);

      const images = await listImages(page);
      if (job.removeImages?.length) {
        const bad = job.removeImages.filter((i) => !images[i]);
        if (bad.length) throw new Error(`Unknown image id(s): ${bad.join(', ')}. Valid ids: 0..${images.length - 1}.`);
        const srcs = job.removeImages.map((i) => images[i].src);
        await page.evaluate((srcs) => {
          document.querySelectorAll('#preview-content .image-remove-wrapper').forEach((w) => {
            const img = w.querySelector('img');
            if (img && srcs.includes(img.src)) w.querySelector('.image-remove-overlay').click();
          });
        }, srcs);
        await new Promise((r) => setTimeout(r, 800)); // 350ms fade + 300ms debounce
        await page.evaluate(() => { window.__settle = null; });
        await settle(page);
      }
      return fn(page, { options: opts, images, article: parsed.article });
    })();
    return await Promise.race([work, killer]);
  } finally {
    clearTimeout(timer.id);
    if (page) await page.close().catch(() => {});
    release();
  }
}

/** Unique images in the paginated preview, in document order. */
export async function listImages(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll('#preview-content img').forEach((img) => {
      if (!img.src || seen.has(img.src)) return;
      seen.add(img.src);
      out.push({ id: out.length, src: img.src, alt: img.alt || '', width: img.naturalWidth, height: img.naturalHeight });
    });
    return out;
  });
}

export async function makePdf(page, article) {
  const title = article?.title || '';
  await page.emulateMediaType('print');
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.emulateMediaType('screen');
  return { pdf: Buffer.from(buf), title: title.replace(/[\\/:*?"<>|]/g, '').trim() };
}

export async function firstPagePng(page) {
  const el = await page.$('.preview-page');
  return Buffer.from(await el.screenshot({ type: 'png' }));
}

export async function pageCount(page) {
  return page.evaluate(() => document.querySelectorAll('.preview-page').length);
}
