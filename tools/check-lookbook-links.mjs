// Visits every Buy link of the lookbook (each product_url, each color variant's product_url) and the
// backup search of used items, in a real browser, and records the HTTP status, where it ended up and
// the page title. A link only passes when the page names the product; a store's bot check, an error
// or a page that doesn't name it is "needs manual check" (never counted as a pass).
// node tools/check-lookbook-links.mjs [outFile=test-results/lookbook-links.json] [--only=ID,ID]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'test-results', 'lookbook-links.json');
const only = new Set((args.find((a) => a.startsWith('--only='))?.slice(7) || '').split(',').filter(Boolean));
const doc = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/products.json'), 'utf8'));

const jobs = [];
for (const p of doc.products) {
  if (only.size && !only.has(p.id)) continue;
  jobs.push({ id: p.id, kind: 'buy', color: null, url: p.product_url, name: p.name, store: p.store });
  for (const v of p.color_variants || []) jobs.push({ id: p.id, kind: 'variant', color: v.color, url: v.product_url, name: `${p.name} ${v.color}`, store: p.store });
  if (p.condition === 'used' && p.backup_search_url) jobs.push({ id: p.id, kind: 'backup', color: null, url: p.backup_search_url, name: p.name, store: p.store });
}

const STOP = new Set(['the', 'and', 'with', 'for', 'set', 'of', 'in', 'x', 'a', 'pack', 'new', 'used', 'black', 'white', 'inch', 'inches', 'size']);
const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const BLOCK = /robot|captcha|access denied|are you a human|verify you are|blocked|pardon our interruption|just a moment|request unsuccessful|press & hold|security check/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', locale: 'en-US', viewport: { width: 1280, height: 900 } });
const results = [];
async function run(job) {
  const page = await ctx.newPage();
  const r = { ...job };
  try {
    const resp = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);
    r.status = resp?.status() ?? null;
    r.finalUrl = page.url();
    r.title = (await page.title()).trim().slice(0, 160);
    const h1 = await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => '');
    const text = `${r.title} ${h1}`;
    const want = words(job.kind === 'variant' ? job.name.replace(job.color, '') : job.name);
    const got = new Set(words(text));
    r.matched = want.filter((w) => got.has(w));
    r.blocked = BLOCK.test(text) || r.status === 403 || r.status === 429;
    const fin = new URL(r.finalUrl);
    const lostPage = job.kind !== 'backup' && (fin.pathname === '/' || /\/(search|s)\b|[?&](q|k|query)=/.test(fin.pathname + fin.search));
    if (r.blocked) r.reason = 'blocked by the site (bot check)';
    else if (r.status >= 400) r.reason = `HTTP ${r.status}`;
    else if (job.kind === 'backup') r.reason = null;
    else if (lostPage) r.reason = `redirected away from the product page (${fin.pathname})`;
    else if (!(r.matched.length >= 2 || (r.matched.length >= 1 && want.length <= 3))) r.reason = 'the page title does not name the product';
    else r.reason = null;
    r.verdict = r.reason ? 'needs manual check' : job.kind === 'backup' ? 'search page opens' : 'right product page';
  } catch (e) {
    r.error = e.message.split('\n')[0];
    r.reason = 'did not load';
    r.verdict = 'needs manual check';
  }
  await page.close();
  results.push(r);
  console.log(`${r.id.padEnd(20)} ${(r.kind + (r.color ? `:${r.color}` : '')).slice(0, 22).padEnd(22)} ${String(r.status ?? '-').padEnd(4)} ${r.verdict}${r.reason ? ` (${r.reason})` : ''} | ${r.title ?? r.error ?? ''}`);
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
await browser.close();
const order = (r) => jobs.findIndex((j) => j.id === r.id && j.kind === r.kind && j.color === r.color);
results.sort((a, b) => order(a) - order(b));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ checked: new Date().toISOString(), results }, null, 2));
const n = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\n${results.length} links: ${n('right product page')} right product page, ${n('search page opens')} backup searches open, ${n('needs manual check')} need a manual check`);
