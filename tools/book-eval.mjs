// Run a snippet in the book page: node tools/book-eval.mjs <width> <height> "<js expression>"
import { chromium } from '@playwright/test';
const [w, hh, expr] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(hh) } });
await page.goto('http://localhost:4173/lookbook/');
await page.waitForFunction(() => document.body.classList.contains('ready'));
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
