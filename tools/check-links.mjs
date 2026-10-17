// Visits every Buy link and backup search link from products.json in a real browser and records the
// HTTP status, where it ended up and the page title, so the report can show that each opens the right
// product page (or say honestly when a store blocks automated visits).
// node tools/check-links.mjs [outFile=test-results/links.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] || path.join(root, 'test-results', 'links.json');
const products = JSON.parse(fs.readFileSync(path.join(root, '../products.json'), 'utf8')).products;

const jobs = [];
for (const p of products) {
  jobs.push({ id: p.id, kind: 'buy', url: p.buy_url, name: p.name, retailer: p.retailer });
  if (p.condition === 'used' && p.backup_search_url) jobs.push({ id: p.id, kind: 'backup', url: p.backup_search_url, name: p.name, retailer: p.retailer });
}

const STOP = new Set(['the', 'and', 'with', 'for', 'set', 'of', 'in', 'x', 'a', 'pack', 'new', 'used', 'black', 'white']);
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const BLOCK = /robot|captcha|access denied|are you a human|verify you are|blocked|pardon our interruption|just a moment|request unsuccessful/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', locale: 'en-US', viewport: { width: 1280, height: 900 } });
const results = [];
async function run(job) {
  const page = await ctx.newPage();
  const r = { ...job };
  try {
    const resp = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    r.status = resp?.status() ?? null;
    r.finalUrl = page.url();
    r.title = (await page.title()).trim().slice(0, 160);
    const text = `${r.title} ${await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => '')}`;
    const want = words(job.name);
    const got = new Set(words(text));
    r.matched = want.filter((w) => got.has(w));
    r.blocked = BLOCK.test(text) || r.status === 403 || r.status === 429;
    if (job.kind === 'backup') r.verdict = r.blocked ? 'blocked by the site (bot check)' : r.status && r.status < 400 ? 'search page opens' : `HTTP ${r.status}`;
    else if (r.blocked) r.verdict = 'blocked by the site (bot check)';
    else if (r.status >= 400) r.verdict = `HTTP ${r.status}`;
    else if (r.matched.length >= 2 || (r.matched.length >= 1 && want.length <= 3)) r.verdict = 'right product page';
    else r.verdict = 'opens, title does not name the product (check by hand)';
  } catch (e) {
    r.error = e.message.split('\n')[0];
    r.verdict = 'did not load';
  }
  await page.close();
  results.push(r);
  console.log(`${r.id.padEnd(22)} ${r.kind.padEnd(6)} ${String(r.status ?? '-').padEnd(4)} ${r.verdict} | ${r.title ?? r.error ?? ''}`);
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
await browser.close();
results.sort((a, b) => jobs.indexOf(jobs.find((j) => j.id === a.id && j.kind === a.kind)) - jobs.indexOf(jobs.find((j) => j.id === b.id && j.kind === b.kind)));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 2));
const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\n${results.length} links: ${count('right product page')} right product page, ${count('search page opens')} search pages, ${results.filter((r) => /blocked/.test(r.verdict)).length} blocked, ${results.filter((r) => /HTTP|did not/.test(r.verdict)).length} errors`);
