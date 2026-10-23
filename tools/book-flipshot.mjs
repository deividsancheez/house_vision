// A page turn frozen half way: node tools/book-flipshot.mjs <outDir> <width> <height> <view> <angle>...
import { chromium } from '@playwright/test';
const [out, w, hh, view, ...angles] = process.argv.slice(2);
const browser = await chromium.launch();
const phone = Number(w) < 900;
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(hh) }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
await page.goto('http://localhost:4173/lookbook/');
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.evaluate((v) => window.__lookbook.book.goToView(Number(v), { animate: false }), view);
for (const a of angles) {
  await page.evaluate(([v, a]) => { const b = window.__lookbook.book; b.finishNow(); b.view = Number(v); b.render(); b.prepare(Number(v) + 1); b.apply(Number(a)); }, [view, a]);
  await page.waitForTimeout(400);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.stage img[src]')].map((im) => im.decode().catch(() => null))));
  await page.screenshot({ path: `${out}/flip-${w}-v${view}-a${Math.abs(a)}.png` });
}
await browser.close();
