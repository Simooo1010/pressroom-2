import puppeteer from 'puppeteer';
import path from 'path';

const outDir = 'C:\\Users\\Utente\\.gemini\\antigravity\\brain\\e9080344-6442-4883-941d-fb43426c5268\\';

async function run() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1080 });
  
  console.log('Navigating to app...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  console.log('Taking UI screenshot...');
  await page.screenshot({ path: path.join(outDir, 'app_ui.png') });
  
  console.log('Filling URL...');
  await page.type('#url-input', 'https://rawandferal.substack.com/p/the-game-theory-of-1-margarita-night');
  await page.click('#submit-btn');
  
  console.log('Waiting for preview to render...');
  await page.waitForSelector('#preview-content .format-default', { timeout: 15000 });
  
  // Take screenshot of default format
  console.log('Screenshot: Default Format');
  await page.screenshot({ path: path.join(outDir, 'format_default.png') });
  
  const formats = ['newspaper', 'scientific', 'book', 'monospace', 'magazine'];
  
  for (const fmt of formats) {
    console.log(`Switching to format: ${fmt}`);
    // Click the format pill
    await page.evaluate((formatName) => {
      const btns = Array.from(document.querySelectorAll('.format-btn'));
      const target = btns.find(b => b.dataset.format === formatName);
      if (target) target.click();
    }, fmt);
    
    await page.waitForSelector(`#preview-content .format-${fmt}`, { timeout: 5000 });
    // Small delay for font rendering/reflow
    await new Promise(r => setTimeout(r, 500)); 
    
    console.log(`Screenshot: ${fmt} Format`);
    await page.screenshot({ path: path.join(outDir, `format_${fmt}.png`) });
  }
  
  // Test PDF generation
  console.log('Testing PDF Download...');
  await page.click('#btn-download');
  
  // Wait a bit to ensure no errors
  await new Promise(r => setTimeout(r, 2000));
  
  await browser.close();
  console.log('Screenshots saved!');
}

run().catch(console.error);
