// Quick look at the book: screenshots of a few spreads at one viewport size.
// node tools/book-peek.mjs <outDir> <width> <height> [view...]
import { chromium } from '@playwright/test';
const [out, w = '1440', hh = '900', ...views] = process.argv.slice(2);
const browser = await chromium.launch();
const phone = Number(w) < 900;
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(hh) }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto('http://localhost:4173/lookbook/');
await page.waitForFunction(() => document.body.classList.contains('ready'));
const info = await page.evaluate(() => ({ pages: window.__lookbook.pages.length, views: window.__lookbook.book.viewCount, ms: window.__lookbook.layoutMs, starts: window.__lookbook.sectionStart, tall: document.querySelectorAll('.lb-too-tall').length }));
console.log(JSON.stringify(info));
const list = views.length ? views.map(Number) : [0, 1, 2, 3];
for (const v of list) {
  await page.evaluate((v) => window.__lookbook.book.goToView(v, { animate: false }), v);
  await page.waitForTimeout(150);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.stage img[src]')].map((im) => im.decode().catch(() => null))));
  await page.screenshot({ path: `${out}/v${String(v).padStart(3, '0')}.png` });
}
const tall = await page.evaluate(() => window.__lookbook.pages.filter((p) => p.querySelector('.lb-too-tall')).map((p) => p.dataset.index + ':' + p.dataset.section));
console.log('too tall:', tall.join(' '));
console.log('errors:', errors.join('\n'));
await browser.close();
