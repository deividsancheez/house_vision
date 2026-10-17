// Dev helper: screenshots of the generated report. node tools/report-shot.mjs <outDir>
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(pathToFileURL(path.resolve('test-report/index.html')).href);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/rep1.png` });
for (const [i, name] of [[2, 'Every product'], [3, 'Budget']]) {
  await p.evaluate((n) => window.scrollTo(0, [...document.querySelectorAll('h2')].find((h) => h.textContent === n).offsetTop), name);
  await p.screenshot({ path: `${out}/rep${i}.png` });
}
await b.close();
