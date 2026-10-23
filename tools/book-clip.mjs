// Which texts are shortened with "…" on the book's pages: node tools/book-clip.mjs <width> <height>
import { chromium } from '@playwright/test';
const [w, hh] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(hh) } });
await page.goto('http://localhost:4173/lookbook/');
await page.waitForFunction(() => document.body.classList.contains('ready'));
const res = await page.evaluate(async () => {
  const lb = window.__lookbook, out = {};
  for (let v = 0; v < lb.book.viewCount; v++) {
    lb.book.goToView(v, { animate: false });
    for (const slot of document.querySelectorAll('.fb-slot')) for (const el of slot.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
      const clipped = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (!clipped || !el.clientWidth || [...el.children].every((c) => c.tagName === 'IMG')) continue; // images are fitted with object-fit
      const k = el.className.split(' ')[0] || el.tagName;
      (out[k] ||= []).push(el.textContent.trim().slice(0, 60));
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [v.length, ...v.slice(0, 3)]]));
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
