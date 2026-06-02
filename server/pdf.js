// ─── PDF Generator ────────────────────────────────────────────────
// Takes HTML + CSS content strings, renders them in a headless
// Chromium browser via Puppeteer, and returns a PDF buffer.
// ──────────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer';

/**
 * Google Fonts used across Pressroom templates.
 * Loaded via <link> tags so they're available for the PDF render.
 */
const GOOGLE_FONTS = [
  'Inter:wght@300;400;500;600;700',
  'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500',
  'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700',
  'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500',
  'JetBrains+Mono:wght@300;400;500;600;700',
  'Libre+Baskerville:ital,wght@0,400;0,700;1,400',
];

/**
 * Build the <link> tags that load Google Fonts.
 */
function buildFontLinks() {
  const families = GOOGLE_FONTS.map((f) => `family=${f}`).join('&');
  return `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?${families}&display=swap"
      rel="stylesheet"
    />
  `;
}

/**
 * Wrap the user-supplied HTML + CSS into a complete HTML document
 * ready for Puppeteer rendering.
 */
function buildFullDocument(html, css) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${buildFontLinks()}
  <style>
    /* ── Reset ─────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* ── User styles ──────────────────────────────────── */
    ${css}
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
}

/**
 * Generate a PDF from raw HTML + CSS strings.
 *
 * @param {string} html     – the body HTML content
 * @param {string} css      – the stylesheet to inject
 * @param {Object} [options]
 * @param {string} [options.format='A4']  – paper size (A4, Letter, etc.)
 * @returns {Promise<Buffer>} – the rendered PDF as a buffer
 */
export async function generatePDF(html, css = '', options = {}) {
  const { format = 'A4' } = options;

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',   // prevents OOM in Docker containers
        '--font-render-hinting=none', // smoother font rendering
      ],
    });

    const page = await browser.newPage();

    // Set the full HTML document as page content and wait until all
    // network requests (fonts, images) have settled.
    await page.setContent(buildFullDocument(html, css), {
      waitUntil: 'networkidle0',
      timeout: 60_000, // generous timeout for heavy pages
    });

    // Give fonts an extra moment to render (some Google Fonts load lazily)
    await page.evaluateHandle('document.fonts.ready');

    // Generate the PDF
    const pdfBuffer = await page.pdf({
      format,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }, // let CSS handle margins
      preferCSSPageSize: true,
    });

    return Buffer.from(pdfBuffer);
  } catch (err) {
    console.error('[pdf] Error generating PDF:', err);
    throw new Error(`PDF generation failed: ${err.message}`);
  } finally {
    // Always close the browser, even on error
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('[pdf] Error closing browser:', closeErr);
      }
    }
  }
}
