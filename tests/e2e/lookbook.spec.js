// The lookbook (/lookbook/), at 1440px and on a 390px phone: every page renders with its images and
// without sideways scrolling, swatches swap, Buy links go to product pages, filters, hotspots, the
// pager, keys and swipe work, and My Picks adds up (packages, custom mixes, budget colors, refresh).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { root, shotsDir } from './helpers.js';

const lb = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/products.json'), 'utf8'));
const byId = new Map(lb.products.map((p) => [p.id, p]));
const cents = (d) => Math.round(d * 100);
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tax = (taxed) => Math.floor((taxed * 975 + 5000) / 10000);

/** Open a lookbook page; returns the console errors and the requests that left this computer. */
async function openLookbook(page, route = '#/cover', { clear = true } = {}) {
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) external.push(r.url()); });
  if (clear) {
    await page.goto('/lookbook/');
    await page.evaluate(() => localStorage.clear());
  }
  await page.goto(`/lookbook/${route}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  return { errors, external };
}

const phone = (info) => info.project.name !== 'desktop';
const imagesLoaded = (page) => page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('main img')];
  for (const img of imgs) { img.loading = 'eager'; if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 8000); }); }
  return imgs.filter((i) => !(i.naturalWidth > 0)).map((i) => i.getAttribute('src'));
});

test('every page: screenshot, images load, no sideways scroll, no console errors', async ({ page }, info) => {
  test.setTimeout(300_000);
  const { errors, external } = await openLookbook(page);
  const pages = await page.evaluate(() => window.__lookbook.pages.map((p) => p.id));
  expect(pages.length).toBeGreaterThan(40);
  const dir = path.join(shotsDir, `lookbook-${info.project.name}`);
  fs.mkdirSync(dir, { recursive: true });
  const broken = [];
  for (const [i, id] of pages.entries()) {
    await page.goto(`/lookbook/#/${id}`);
    await expect(page.locator(`main [data-page="${id}"]`)).toBeVisible();
    broken.push(...(await imagesLoaded(page)).map((s) => `${id}: ${s}`));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `${id} scrolls sideways`).toBeLessThanOrEqual(0);
    await page.waitForTimeout(350); // the page-enter animation
    await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}-${id.replace(/\//g, '_')}.png`), fullPage: !phone(info) || i < 2 || /packages|notes/.test(id) });
  }
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
  expect(external, 'the lookbook loads nothing from other sites').toEqual([]);
});

test('cover: title, concept, palette, start button', async ({ page }) => {
  await openLookbook(page);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.palette .chip, .palette [data-hex], .swatch-row > *').first()).toBeVisible();
  await page.getByRole('link', { name: /start the lookbook/i }).click();
  await expect(page.locator('main [data-page="inspiration"]')).toBeVisible();
});

test('inspiration credits each creator with a link', async ({ page }) => {
  await openLookbook(page, '#/inspiration');
  const insp = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/inspiration.json'), 'utf8'));
  const all = [...insp.living, ...insp.bedroom];
  await expect(page.getByTestId('insp-card')).toHaveCount(all.length);
  for (const x of all) {
    const a = page.locator(`[data-testid=insp-link][href="${x.source_url}"]`);
    await expect(a).toHaveCount(1);
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('insp-card').filter({ hasText: x.creator }).first()).toBeVisible();
  }
});

test('category pages show every option, the rule and the both-rooms badge', async ({ page }) => {
  await openLookbook(page, '#/living/LR-RUG');
  const cat = lb.categories.find((c) => c.id === 'LR-RUG');
  await expect(page.getByTestId('product-card')).toHaveCount(cat.product_ids.length);
  await expect(page.getByTestId('rule')).toContainText(cat.rule);
  const both = lb.categories.find((c) => c.room === 'both');
  for (const room of ['living', 'bedroom']) {
    await page.goto(`/lookbook/#/${room}/${both.id}`);
    await expect(page.getByTestId('both-badge')).toBeVisible();
    await expect(page.getByTestId('product-card')).toHaveCount(both.product_ids.length);
  }
});

test('product card: price, sale, stock note, size marks, used label, backup link', async ({ page }) => {
  await openLookbook(page, '#/living/LR-COFFEE');
  const used = lb.products.find((p) => p.category === 'LR-COFFEE' && p.condition === 'used');
  const card = page.locator(`[data-testid=product-card][data-product="${used.id}"]`);
  await expect(card.getByTestId('price')).toContainText(money(cents(used.price)));
  await expect(card.getByTestId('used-label')).toContainText(used.used_label.slice(0, 20));
  if (used.backup_search_url) await expect(card.getByTestId('backup')).toHaveAttribute('href', used.backup_search_url);
  await expect(card.getByTestId('buy')).toHaveAttribute('href', used.product_url);
  // a sale price shows the regular price struck through
  const sale = lb.products.find((p) => p.on_sale && p.regular_price > p.price);
  if (sale) {
    const room = sale.room === 'both' ? 'living' : sale.room;
    await page.goto(`/lookbook/#/${room}/${sale.category}`);
    const c = page.locator(`[data-testid=product-card][data-product="${sale.id}"]`);
    await expect(c.getByTestId('regular-price')).toContainText(money(cents(sale.regular_price)));
    await expect(c.getByTestId('regular-price')).toHaveCSS('text-decoration-line', 'line-through');
  }
  // the stock note on hover / tap
  const noted = lb.products.find((p) => p.stock_note && p.category === 'LR-RUG');
  await page.goto('/lookbook/#/living/LR-RUG');
  const c = page.locator(`[data-testid=product-card][data-product="${noted.id}"]`);
  await c.getByTestId('stock').click();
  await expect(c.getByTestId('stock-note')).toBeVisible();
  await expect(c.getByTestId('stock-note')).toContainText(noted.stock_note.slice(0, 20));
  // a null size says "size needed"
  const nul = lb.products.find((p) => p.dimensions.w_in === null && p.room !== 'both');
  await page.goto(`/lookbook/#/${nul.room}/${nul.category}`);
  await expect(page.locator(`[data-testid=product-card][data-product="${nul.id}"] [data-testid=size]`)).toContainText('size needed');
  // estimated sizes are marked
  const est = lb.products.find((p) => p.dimensions.estimated?.length && p.room !== 'both');
  await page.goto(`/lookbook/#/${est.room}/${est.category}`);
  await expect(page.locator(`[data-testid=product-card][data-product="${est.id}"] [data-testid=size]`)).toContainText('est.');
});

test('color swatches swap image, price, stock and Buy link', async ({ page }) => {
  await openLookbook(page, '#/living/LR-RUG');
  const p = lb.products.find((x) => x.category === 'LR-RUG' && x.color_variants.length);
  const card = page.locator(`[data-testid=product-card][data-product="${p.id}"]`);
  await card.scrollIntoViewIfNeeded();
  for (const v of p.color_variants) {
    await card.locator(`[data-testid=swatch][data-color="${v.color}"]`).click();
    await expect(card.getByTestId('color-name')).toHaveText(v.color);
    await expect(card.getByTestId('buy')).toHaveAttribute('href', v.product_url);
    await expect(card.getByTestId('price')).toContainText(money(cents(v.price)));
    await expect(card.getByTestId('product-image')).toHaveAttribute('src', new RegExp(path.basename(v.image_file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(card.getByTestId('stock')).toContainText(v.in_stock ? 'In stock' : 'Out of stock');
  }
  await card.locator('[data-testid=swatch][data-color=""]').click();
  await expect(card.getByTestId('buy')).toHaveAttribute('href', p.product_url);
});

test('every Buy button points to its product page, in a new tab', async ({ page }) => {
  test.setTimeout(180_000);
  await openLookbook(page);
  const seen = new Set();
  for (const c of lb.categories) {
    const room = c.room === 'both' ? 'living' : c.room;
    await page.goto(`/lookbook/#/${room}/${c.id}`);
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    const links = await page.locator('[data-testid=product-card]').evaluateAll((cards) => cards.map((el) => ({ id: el.dataset.product, href: el.querySelector('[data-testid=buy]').getAttribute('href'), target: el.querySelector('[data-testid=buy]').getAttribute('target') })));
    for (const l of links) {
      expect(l.href, l.id).toBe(byId.get(l.id).product_url);
      expect(l.target).toBe('_blank');
      const u = new URL(l.href);
      expect(u.protocol).toBe('https:');
      expect(u.pathname.length, `${l.id}: not a store home page`).toBeGreaterThan(1);
      seen.add(l.id);
    }
  }
  expect(seen.size).toBe(lb.products.length);
});

test('filters: store, price range, Deal, Used, Top pick', async ({ page }, info) => {
  await openLookbook(page, '#/bedroom/BR-DESK');
  const ids = lb.categories.find((c) => c.id === 'BR-DESK').product_ids.map((id) => byId.get(id));
  const count = () => page.getByTestId('product-card').count();
  if (phone(info)) await page.locator('.filters-toggle').click();
  const check = async (sel) => page.locator(sel).locator('xpath=..').click();
  await check('[data-filter=used]');
  await expect.poll(count).toBe(ids.filter((p) => p.condition === 'used').length);
  await page.getByTestId('clear-filters').click();
  await expect.poll(count).toBe(ids.length);
  if (phone(info) && !(await page.locator('.filters.open').count())) await page.locator('.filters-toggle').click();
  const store = ids[0].store;
  await check(`[data-store="${store}"]`);
  await expect.poll(count).toBe(ids.filter((p) => p.store === store).length);
  await page.getByTestId('clear-filters').click();
  if (phone(info) && !(await page.locator('.filters.open').count())) await page.locator('.filters-toggle').click();
  await page.locator('[data-filter=min]').fill('40');
  await page.locator('[data-filter=max]').fill('120');
  await expect.poll(count).toBe(ids.filter((p) => p.price >= 40 && p.price <= 120).length);
  await page.getByTestId('clear-filters').click();
  for (const [key, tag] of [['top', 'Top pick'], ['deal', 'Deal']]) {
    if (phone(info) && !(await page.locator('.filters.open').count())) await page.locator('.filters-toggle').click();
    await check(`[data-filter=${key}]`);
    const n = ids.filter((p) => p.tags.includes(tag)).length;
    if (n) await expect.poll(count).toBe(n);
    else await expect(page.getByTestId('count')).toContainText(/0|no /i);
    await page.getByTestId('clear-filters').click();
  }
});

test('mood board hotspots open the product', async ({ page }) => {
  await openLookbook(page, '#/living');
  const spots = page.getByTestId('hotspot');
  expect(await spots.count()).toBeGreaterThan(4);
  const id = await spots.first().getAttribute('data-product');
  await spots.first().click();
  const quick = page.getByTestId('quick-view');
  await expect(quick).toBeVisible();
  await expect(quick.locator(`[data-product="${id}"]`)).toBeVisible();
  await expect(quick.getByTestId('buy')).toHaveAttribute('href', byId.get(id).product_url);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
});

test('navigation: menu, pager, keyboard arrows and swipe', async ({ page }, info) => {
  await openLookbook(page);
  await expect(page.getByTestId('page-count')).toHaveText(/^01 \//);
  if (!phone(info)) {
    await page.locator('nav.site-nav a[data-nav=packages]').click();
    await expect(page.locator('main [data-page=packages]')).toBeVisible();
    await page.locator('nav.site-nav a[data-nav=bedroom]').click();
    await expect(page.locator('main [data-page=bedroom]')).toBeVisible();
    await page.locator('nav.site-nav a[data-nav=cover]').click();
  } else {
    await page.locator('.menu-btn').click();
    await page.locator('nav.site-nav a[data-nav=packages]').click();
    await expect(page.locator('main [data-page=packages]')).toBeVisible();
    await page.goto('/lookbook/#/cover');
  }
  await expect(page.locator('main [data-page=cover]')).toBeVisible();
  await page.getByTestId('next').click();
  await expect(page.getByTestId('page-count')).toHaveText(/^02 \//);
  await page.getByTestId('prev').click();
  await expect(page.getByTestId('page-count')).toHaveText(/^01 \//);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('page-count')).toHaveText(/^03 \//);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('page-count')).toHaveText(/^02 \//);
  // swipe left: next page; swipe right: back
  const swipe = (dx) => page.evaluate((d) => {
    const el = document.querySelector('main .page h1, main .page h2, main .page p');
    const r = el.getBoundingClientRect();
    const x = r.left + 20, y = r.top + r.height / 2;
    const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(x + (d < 0 ? 200 : 0))], changedTouches: [t(x + (d < 0 ? 200 : 0))] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(x + (d < 0 ? 200 : 0) + d)] }));
  }, dx);
  await swipe(-160);
  await expect(page.getByTestId('page-count')).toHaveText(/^03 \//);
  await swipe(160);
  await expect(page.getByTestId('page-count')).toHaveText(/^02 \//);
});

// ---------------------------------------------------------------------------------------------
// My Picks

async function loadPackage(page, id) {
  await page.goto('/lookbook/#/packages');
  await page.locator(`[data-package=${id}] [data-testid=load-package]`).click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  await expect(page.locator(`[data-package=${id}] [data-testid=load-package]`)).toContainText('Loaded');
}
async function drawer(page) {
  if (!(await page.getByTestId('picks-drawer').isVisible())) await page.getByTestId('picks-button').click();
  await expect(page.getByTestId('picks-drawer')).toBeVisible();
  return page.getByTestId('picks-drawer');
}

test('packages: totals match, load into My Picks, budget colors', async ({ page }) => {
  await openLookbook(page, '#/packages');
  const want = { save: ['$908.30', 'ok'], balanced: ['$988.16', 'ok'], upgrade: ['$1,186.77', 'amber'] };
  for (const [id, [total, level]] of Object.entries(want)) {
    await expect(page.locator(`[data-package=${id}] [data-testid=package-total]`)).toHaveText(total);
    await loadPackage(page, id);
    await expect(page.getByTestId('picks-total')).toHaveText(total);
    const d = await drawer(page);
    await expect(d.getByTestId('total')).toHaveText(total);
    await expect(d.getByTestId('budget')).toHaveAttribute('data-level', level);
    await expect(d.getByTestId('pick-line')).toHaveCount(lb.packages[id].items.length);
    await page.keyboard.press('Escape');
  }
});

test('custom mixes add up, go amber and red, and survive a refresh', async ({ page }) => {
  await openLookbook(page);
  // mix 1: BALANCED, then 2 more cream pillow covers and a different rug color
  await loadPackage(page, 'balanced');
  const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('lookbook.picks.v1')).picks);
  const independent = (st) => {
    let taxed = 0, used = 0, del = 0;
    for (const v of Object.values(st)) {
      const p = byId.get(v.id);
      const vv = v.color ? p.color_variants.find((x) => x.color === v.color) : null;
      const line = cents(vv ? vv.price : p.price) * v.qty;
      if (p.taxed) taxed += line; else used += line;
      del += cents(p.delivery_fee || 0);
    }
    return taxed + used + tax(taxed) + del;
  };
  let d = await drawer(page);
  const pillow = d.locator('[data-testid=pick-line][data-key^="PILLOW"]').first();
  const key = await pillow.getAttribute('data-key');
  await pillow.getByRole('button', { name: 'One more' }).click();
  await pillow.getByRole('button', { name: 'One more' }).click();
  picks[key].qty += 2;
  await expect(d.locator(`[data-testid=pick-line][data-key="${key}"] [data-testid=qty-value]`)).toHaveText(String(picks[key].qty));
  await expect(d.getByTestId('total')).toHaveText(money(independent(picks)));
  await page.keyboard.press('Escape');
  const rug = lb.products.find((p) => p.category === 'LR-RUG' && p.color_variants.length);
  await page.goto(`/lookbook/#/living/LR-RUG`);
  const card = page.locator(`[data-testid=product-card][data-product="${rug.id}"]`);
  await card.locator(`[data-testid=swatch][data-color="${rug.color_variants[0].color}"]`).click();
  await card.getByTestId('pick').click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  picks['LR-RUG@LR-RUG'] = { id: rug.id, qty: 1, color: rug.color_variants[0].color };
  const t1 = independent(picks);
  await expect(page.getByTestId('picks-total')).toHaveText(money(t1));
  d = await drawer(page);
  await expect(d.getByTestId('budget')).toHaveAttribute('data-level', t1 > 120000 ? 'red' : t1 > 100000 ? 'amber' : 'ok');
  // refresh: the picks are still there
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await expect(page.getByTestId('picks-total')).toHaveText(money(t1));
  await expect(page.getByTestId('picks-count')).toHaveText(String(Object.keys(picks).length));
  // mix 2: UPGRADE plus the delivery-fee rug and the priciest bench: over $1,200, red
  await loadPackage(page, 'upgrade');
  const up = await page.evaluate(() => JSON.parse(localStorage.getItem('lookbook.picks.v1')).picks);
  const feeRug = lb.products.find((p) => p.delivery_fee);
  await page.goto(`/lookbook/#/living/LR-RUG`);
  await page.locator(`[data-testid=product-card][data-product="${feeRug.id}"] [data-testid=pick]`).click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  up['LR-RUG@LR-RUG'] = { id: feeRug.id, qty: 1, color: null };
  const bench = lb.products.filter((p) => p.category === 'BENCH').sort((a, b) => b.price - a.price)[0];
  await page.goto(`/lookbook/#/living/BENCH`);
  await page.locator(`[data-testid=product-card][data-product="${bench.id}"] [data-testid=pick]`).click();
  up.BENCH = { id: bench.id, qty: 1, color: null };
  const t2 = independent(up);
  expect(t2).toBeGreaterThan(120000);
  await expect(page.getByTestId('picks-total')).toHaveText(money(t2));
  d = await drawer(page);
  await expect(d.getByTestId('delivery')).toHaveText(money(cents(feeRug.delivery_fee)));
  await expect(d.getByTestId('budget')).toHaveAttribute('data-level', 'red');
  await expect(d.getByTestId('budget')).toHaveCSS('--level', /.*/).catch(() => {});
  // Open all buy links: grouped by store, every link a product page
  await d.getByTestId('open-all-links').click();
  const groups = d.locator('[data-testid=links-by-store] .store-group');
  const stores = [...new Set(Object.values(up).map((v) => byId.get(v.id).store))].sort();
  await expect(groups).toHaveCount(stores.length);
  expect(await groups.evaluateAll((g) => g.map((x) => x.dataset.store))).toEqual(stores);
  // remove a line
  const before = await d.getByTestId('pick-line').count();
  await d.getByTestId('line-remove').first().click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  await expect(d.getByTestId('pick-line')).toHaveCount(before - 1);
});

test('budget colors: amber over $1,000, red over $1,200', async ({ page }) => {
  await openLookbook(page);
  await loadPackage(page, 'balanced');
  let d = await drawer(page);
  await expect(d.getByTestId('budget')).toHaveAttribute('data-level', 'ok');
  const okColor = await d.getByTestId('total').evaluate((e) => getComputedStyle(e).color);
  await page.keyboard.press('Escape');
  await loadPackage(page, 'upgrade');
  d = await drawer(page);
  await expect(d.getByTestId('budget')).toHaveAttribute('data-level', 'amber');
  const amber = await d.getByTestId('total').evaluate((e) => getComputedStyle(e).color);
  expect(amber).not.toBe(okColor);
  await page.keyboard.press('Escape');
  const bench = lb.products.filter((p) => p.category === 'BENCH').sort((a, b) => b.price - a.price)[0];
  await page.goto(`/lookbook/#/living/BENCH`);
  await page.locator(`[data-testid=product-card][data-product="${bench.id}"] [data-testid=pick]`).click();
  const feeRug = lb.products.find((p) => p.delivery_fee);
  await page.goto(`/lookbook/#/living/LR-RUG`);
  await page.locator(`[data-testid=product-card][data-product="${feeRug.id}"] [data-testid=pick]`).click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  d = await drawer(page);
  await expect(d.getByTestId('budget')).toHaveAttribute('data-level', 'red');
  const red = await d.getByTestId('total').evaluate((e) => getComputedStyle(e).color);
  expect(red).not.toBe(amber);
  expect(red).not.toBe(okColor);
});
