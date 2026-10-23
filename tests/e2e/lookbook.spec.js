// The lookbook book (/lookbook/), at 1440px (two-page spreads) and on a 390px phone (one page): every
// spread is screenshotted with its images loaded and nothing overflowing or cut off; pages turn by
// corner click, keys, arrows, the progress bar and swipe; every contents entry opens its page; every
// Buy link and swatch works; My Picks adds up for the three packages; filters, sound and deep links.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { root, shotsDir } from './helpers.js';
import { variantList } from '../../src/shared/lbstore.js';

const lb = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/products.json'), 'utf8'));
const insp = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/inspiration.json'), 'utf8'));
const byId = new Map(lb.products.map((p) => [p.id, p]));
const cents = (d) => Math.round(d * 100);
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tax = (taxed) => Math.floor((taxed * Math.round(lb.tax_rate * 10000) + 5000) / 10000);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phone = (info) => info.project.name !== 'desktop';

/** Open the book; returns the console errors and the requests that left this computer. */
async function openBook(page, route = '#/cover', { clear = true } = {}) {
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) external.push(r.url()); });
  if (clear) {
    await page.goto('/lookbook/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('about:blank');
  }
  await page.goto(`/lookbook/${route}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await settled(page);
  return { errors, external };
}

/** Wait until no page is turning. */
const settled = (page) => page.waitForFunction(() => window.__lookbook?.book && !window.__lookbook.book.busy && !window.__lookbook.book.dragging);
const view = (page) => page.evaluate(() => window.__lookbook.book.view);
const visible = (page) => page.evaluate(() => window.__lookbook.book.visible());
const startOf = (page, id) => page.evaluate((id) => window.__lookbook.sectionStart[id], id);
const showView = (page, v) => page.evaluate((v) => window.__lookbook.book.goToView(v, { animate: false }), v);
const showPage = (page, i) => page.evaluate((i) => window.__lookbook.book.goTo(i, { animate: false }), i);
async function showProduct(page, id) {
  await showPage(page, await page.evaluate((id) => window.__lookbook.productPage.get(id), id));
  return page.locator(`.stage [data-testid=product-card][data-product="${id}"]`);
}

/** Every image on the open pages loaded (the big srcset versions too). */
const imagesLoaded = (page) => page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.fb-slot img')];
  await Promise.all(imgs.map((im) => Promise.race([im.decode().catch(() => null), new Promise((r) => setTimeout(r, 8000))])));
  return imgs.filter((i) => !(i.naturalWidth > 0)).map((i) => i.getAttribute('src') || `(not loaded) ${i.dataset.src}`);
});

/** Anything on the open pages that overflows its page or is cut off. */
const layoutProblems = (page) => page.evaluate(() => {
  const out = [];
  for (const slot of document.querySelectorAll('.fb-slot:not(.empty)')) {
    const pg = slot.firstElementChild;
    if (!pg) continue;
    const n = pg.dataset.index;
    const pr = pg.getBoundingClientRect();
    const tol = 1.5;
    if (pg.querySelector('.lb-too-tall')) out.push(`page ${n}: a block is taller than a page`);
    for (const b of pg.querySelectorAll('.pbody')) if (b.scrollHeight > b.clientHeight + 1) out.push(`page ${n}: text runs ${b.scrollHeight - b.clientHeight}px past the bottom`);
    for (const el of pg.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < pr.left - tol || r.right > pr.right + tol || r.top < pr.top - tol || r.bottom > pr.bottom + tol) out.push(`page ${n}: ${el.className || el.tagName} sticks out of the page`);
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      if ([...el.children].length && [...el.children].every((c) => c.tagName === 'IMG')) continue; // photos are fitted with object-fit
      if (el.classList.contains('pbody') || el.classList.contains('page') || el.closest('.mood, .cover-plate')) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`page ${n}: "${el.textContent.trim().slice(0, 40)}" is cut off`);
    }
  }
  return out;
});

/** A finger swipe (touch screens) or a mouse drag from the page edge (desktop). */
async function swipe(page, dir, info) {
  const box = await page.locator('.fb-shift').boundingBox();
  const y = box.y + box.height * 0.45;
  if (phone(info)) {
    const x0 = dir > 0 ? box.x + box.width * 0.8 : box.x + box.width * 0.2;
    const x1 = dir > 0 ? box.x + box.width * 0.1 : box.x + box.width * 0.9;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    const x0 = dir > 0 ? box.x + box.width - 20 : box.x + 20;
    const x1 = dir > 0 ? box.x + box.width * 0.15 : box.x + box.width * 0.85;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y);
    await page.mouse.up();
  }
  await settled(page);
}

/** A package priced from products.json, independently of the app. */
function expectedPackage(id) {
  let taxed = 0, untaxed = 0, delivery = 0;
  for (const it of lb.packages[id].items) {
    const p = byId.get(it.id);
    const c = cents(p.price) * it.qty;
    if (p.taxed) taxed += c; else untaxed += c;
    delivery += cents(p.delivery_fee || 0);
  }
  const t = tax(taxed);
  return { taxed, untaxed, tax: t, delivery, total: taxed + untaxed + t + delivery };
}

// ---------------------------------------------------------------------------------------------

test('every spread: screenshot, images load, nothing overflows or is cut off, no console errors', async ({ page }, info) => {
  test.setTimeout(900_000);
  const { errors, external } = await openBook(page);
  const n = await page.evaluate(() => window.__lookbook.book.viewCount);
  expect(n).toBeGreaterThan(phone(info) ? 120 : 60);
  const dir = path.join(shotsDir, `book-${info.project.name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const broken = [], problems = [];
  for (let v = 0; v < n; v++) {
    await showView(page, v);
    broken.push(...(await imagesLoaded(page)).map((s) => `view ${v}: ${s}`));
    problems.push(...(await layoutProblems(page)));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `view ${v} scrolls sideways`).toBeLessThanOrEqual(0);
    const sec = await page.evaluate(() => window.__lookbook.sectionOf(window.__lookbook.book.visible().at(-1)));
    await page.screenshot({ path: path.join(dir, `${String(v).padStart(3, '0')}-${String(sec).replace(/\//g, '_')}.png`) });
  }
  expect(problems).toEqual([]);
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
  expect(external, 'the lookbook loads nothing from other sites').toEqual([]);
});

test('cover: a closed hardcover with title, subtitle and palette; clicking it opens the book', async ({ page }, info) => {
  await openBook(page);
  expect(await view(page)).toBe(0);
  const cover = page.locator('.stage .k-cover');
  await expect(cover.locator('h1')).toHaveText(/The Organic\s*Modern Edit/);
  await expect(cover).toContainText('Living Room & Bedroom · Los Angeles · 2026');
  await expect(cover.locator('.cover-palette li')).toHaveCount(9);
  if (!phone(info)) await expect(page.locator('.fb-book')).toHaveAttribute('data-closed', 'front');
  await cover.click({ position: { x: 120, y: 200 } });
  await settled(page);
  expect(await view(page)).toBe(1);
  expect(await page.evaluate(() => window.__lookbook.sectionOf(window.__lookbook.book.visible().at(-1)))).toBe('welcome');
});

test('turning pages: corners, keys, arrows, progress bar and swipe', async ({ page }, info) => {
  await openBook(page, '#/welcome');
  const v0 = await view(page);
  await page.keyboard.press('ArrowRight'); await settled(page);
  expect(await view(page)).toBe(v0 + 1);
  await page.keyboard.press('ArrowLeft'); await settled(page);
  expect(await view(page)).toBe(v0);
  await page.getByTestId('next').click(); await settled(page);
  expect(await view(page)).toBe(v0 + 1);
  await page.getByTestId('prev').click(); await settled(page);
  expect(await view(page)).toBe(v0);
  if (!phone(info)) {
    await page.getByTestId('side-next').click(); await settled(page);
    expect(await view(page)).toBe(v0 + 1);
    await page.getByTestId('side-prev').click(); await settled(page);
    expect(await view(page)).toBe(v0);
  }
  // page corners (bottom right: next; bottom left: back)
  await page.locator('.fb-corner.br').click(); await settled(page);
  expect(await view(page)).toBe(v0 + 1);
  await page.locator('.fb-corner.bl').click(); await settled(page);
  expect(await view(page)).toBe(v0);
  // swipe (a finger on a phone, a mouse drag from the page edge on a computer)
  await swipe(page, 1, info);
  expect(await view(page)).toBe(v0 + 1);
  await swipe(page, -1, info);
  expect(await view(page)).toBe(v0);
  // the progress bar jumps
  await page.getByTestId('progress').fill('10'); await settled(page);
  expect(await view(page)).toBe(10);
  await expect(page.getByTestId('page-count')).toContainText(/Pages? \d+/);
  // a tap on a button inside a page presses the button, it doesn't turn the page
  const card = await showProduct(page, lb.products.find((x) => x.color_variants.length).id);
  const before = await view(page);
  await card.locator('[data-testid=swatch]').last().click();
  await settled(page);
  expect(await view(page)).toBe(before);
});

test('contents: every entry opens its page, and every page has Back to contents', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openBook(page, '#/contents');
  const start = await startOf(page, 'contents');
  const entries = await page.evaluate(() => {
    const lb = window.__lookbook;
    return lb.pages.flatMap((el, i) => [...el.querySelectorAll('[data-testid=toc-entry]')].map((b) => ({ page: i, target: b.dataset.goto, printed: b.querySelector('.toc-pg').textContent })));
  });
  expect(entries.length).toBe(lb.categories.length + 14); // + an "Also for this room" line in each chapter
  for (const e of entries) {
    await showPage(page, e.page);
    const target = await startOf(page, e.target);
    expect(e.printed, `${e.target}: printed page number`).toBe(String(target));
    await page.locator(`.stage [data-testid=toc-entry][data-goto="${e.target}"]`).click();
    await settled(page);
    expect(await visible(page), `${e.target} opens page ${target}`).toContain(target);
  }
  // Back to contents on every page but the front cover
  const missing = await page.evaluate(() => window.__lookbook.pages.map((el, i) => (i > 0 && !el.querySelector('[data-goto=contents]') ? i : null)).filter((x) => x !== null));
  expect(missing).toEqual([]);
  const mid = (await page.evaluate(() => window.__lookbook.pages.length)) >> 1;
  await showPage(page, mid);
  await page.locator('.fb-slot [data-testid=to-contents]').first().click();
  await settled(page);
  expect(await visible(page)).toContain(start);
  // and the button in the top bar
  await showPage(page, mid);
  await page.getByTestId('contents-button').click();
  await settled(page);
  expect(await visible(page)).toContain(start);
});

test('inspiration credits each creator with a link', async ({ page }) => {
  await openBook(page, '#/inspiration');
  const all = [...insp.living, ...insp.bedroom];
  const links = await page.evaluate(() => window.__lookbook.pages.flatMap((el) => [...el.querySelectorAll('[data-testid=insp-card]')].map((c) => ({ text: c.textContent, href: c.querySelector('[data-testid=insp-link]')?.href, target: c.querySelector('[data-testid=insp-link]')?.target }))));
  expect(links.length).toBe(all.length);
  for (const x of all) {
    const hit = links.find((l) => l.href === x.source_url);
    expect(hit, x.source_url).toBeTruthy();
    expect(hit.text).toContain(x.creator);
    expect(hit.target).toBe('_blank');
  }
});

test('every product is in the book once, with its Buy link, price, stock and tags', async ({ page }) => {
  await openBook(page, '#/contents');
  const cards = await page.evaluate(() => window.__lookbook.pages.flatMap((el) => [...el.querySelectorAll('.pcard')].map((c) => ({
    id: c.dataset.product, href: c.querySelector('[data-testid=buy]').getAttribute('href'), target: c.querySelector('[data-testid=buy]').target, rel: c.querySelector('[data-testid=buy]').rel,
    price: c.querySelector('[data-testid=price]').textContent, regular: c.querySelector('[data-testid=regular-price]')?.textContent || null,
    stock: c.querySelector('[data-testid=stock]').textContent, tags: [...c.querySelectorAll('.tag')].length, pick: !!c.querySelector('[data-testid=pick]'),
  }))));
  expect(cards.map((c) => c.id).sort()).toEqual(lb.products.map((p) => p.id).sort());
  for (const c of cards) {
    const p = byId.get(c.id);
    expect(c.href, c.id).toBe(p.product_url);
    expect(c.target).toBe('_blank');
    expect(c.rel).toContain('noopener');
    expect(c.price).toBe(money(cents(p.price)));
    if (p.on_sale && p.regular_price > p.price) expect(c.regular).toBe(money(cents(p.regular_price)));
    expect(c.stock).toContain(p.in_stock ? 'In stock' : 'Out of stock');
    expect(c.tags).toBe(p.tags.length);
    expect(c.pick).toBe(true);
  }
});

test('every color swatch swaps the image, price, stock and Buy link', async ({ page }) => {
  test.setTimeout(240_000);
  await openBook(page, '#/contents');
  const withColors = lb.products.filter((p) => p.color_variants.length);
  expect(withColors.length).toBeGreaterThan(10);
  for (const p of withColors) {
    const card = await showProduct(page, p.id);
    for (const v of [...variantList(p), { key: null }]) {
      await card.locator(`[data-testid=swatch][data-color="${v.key || ''}"]`).click();
      const c = page.locator(`.stage [data-testid=product-card][data-product="${p.id}"]`);
      const shown = v.key ? v : { product_url: p.product_url, price: p.price, image_file: p.image_file, in_stock: p.in_stock };
      await expect(c.getByTestId('color-name')).toHaveText(v.key || 'As listed');
      await expect(c.locator(`[data-testid=swatch][data-color="${v.key || ''}"]`)).toHaveAttribute('aria-checked', 'true');
      await expect(c.getByTestId('buy')).toHaveAttribute('href', shown.product_url);
      await expect(c.getByTestId('price')).toHaveText(money(cents(shown.price)));
      await expect(c.getByTestId('product-image')).toHaveAttribute('src', new RegExp(`${esc(path.basename(shown.image_file))}$`));
      await expect(c.getByTestId('stock')).toContainText(shown.in_stock ? 'In stock' : 'Out of stock');
    }
  }
  expect(await layoutProblems(page)).toEqual([]);
});

test('product card details: sale price, stock note, used label and backup search, size marks', async ({ page }) => {
  await openBook(page, '#/contents');
  const sale = lb.products.find((p) => p.on_sale && p.regular_price > p.price);
  let card = await showProduct(page, sale.id);
  await expect(card.getByTestId('regular-price')).toHaveCSS('text-decoration-line', 'line-through');
  const used = lb.products.find((p) => p.condition === 'used' && p.backup_search_url && p.used_label);
  card = await showProduct(page, used.id);
  await expect(card.getByTestId('used-label')).toHaveText(used.used_label);
  await card.getByTestId('stock').click();
  await expect(page.getByTestId('stock-note')).toContainText(used.stock_note.slice(0, 30));
  await expect(page.getByTestId('backup')).toHaveAttribute('href', used.backup_search_url);
  await page.keyboard.press('Escape');
  const nul = lb.products.find((p) => p.dimensions.w_in === null);
  card = await showProduct(page, nul.id);
  await expect(card.getByTestId('size')).toContainText('Size needed');
  const est = lb.products.find((p) => p.dimensions.estimated?.length && p.dimensions.w_in && p.dimensions.d_in && p.dimensions.h_in);
  card = await showProduct(page, est.id);
  await expect(card.getByTestId('size')).toContainText('est.');
});

test('cards show why this and the notes; each chapter links to the shared categories printed in the other', async ({ page }, info) => {
  await openBook(page, '#/contents');
  const noted = lb.products.find((p) => p.notes.length && p.why_this);
  const card = await showProduct(page, noted.id);
  await expect(card.getByTestId('why')).toContainText(noted.why_this.split('. ')[0].replace(/\.$/, '').slice(0, 25));
  for (const n of noted.notes) await expect(card.getByTestId('notes')).toContainText(n.slice(0, 25));
  for (const room of ['living', 'bedroom']) {
    await showPage(page, await startOf(page, `${room}/shared`));
    const elsewhere = await page.evaluate((r) => window.__lookbook.sharedElsewhere(r).map((c) => c.id), room);
    expect(elsewhere.length).toBeGreaterThan(0);
    // every shared category is listed once on this chapter's page(s), in order
    const printed = await page.evaluate((r) => window.__lookbook.pages.filter((el) => el.dataset.section === `${r}/shared`).flatMap((el) => [...el.querySelectorAll('[data-testid=shared-link]')].map((b) => b.dataset.goto)), room);
    expect(printed).toEqual(elsewhere.map((id) => `${room === 'living' ? 'bedroom' : 'living'}/${id}`));
    const links = page.locator(`.stage [data-section="${room}/shared"] [data-testid=shared-link]`);
    const other = room === 'living' ? 'bedroom' : 'living';
    await expect(links.first()).toHaveAttribute('data-goto', `${other}/${elsewhere[0]}`);
    await links.first().click();
    await settled(page);
    expect(await visible(page)).toContain(await startOf(page, `${other}/${elsewhere[0]}`));
  }
});

test('My Picks: add from a card, total with tax, kept after reload, side panel over the book', async ({ page }) => {
  await openBook(page, '#/contents');
  const p = lb.products.find((x) => x.id === 'LR-RUG-A');
  const card = await showProduct(page, p.id);
  await card.getByTestId('pick').click();
  await expect(card.getByTestId('pick')).toHaveAttribute('aria-pressed', 'true');
  const expected = cents(p.price) + tax(cents(p.price));
  await expect(page.getByTestId('picks-count')).toHaveText('1');
  await expect(page.getByTestId('picks-total')).toHaveText(money(expected));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await expect(page.getByTestId('picks-count')).toHaveText('1');
  await page.getByTestId('picks-button').click();
  const drawer = page.getByTestId('picks-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('total')).toHaveText(money(expected));
  await expect(drawer.getByTestId('budget')).toHaveAttribute('data-level', 'ok');
  await expect(drawer.getByTestId('line-buy')).toHaveAttribute('href', p.product_url);
  // the panel sits over the book; the book stays where it was
  const v = await view(page);
  await drawer.getByTestId('line-remove').click();
  await expect(page.getByTestId('picks-count')).toHaveText('0');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  expect(await view(page)).toBe(v);
});

test('packages: each one loads into My Picks with the right subtotal, 9.75% tax, delivery and total', async ({ page }) => {
  await openBook(page, '#/packages');
  const levels = { save: 'ok', balanced: 'ok', upgrade: 'amber' };
  for (const id of Object.keys(lb.packages)) {
    const e = expectedPackage(id);
    expect(e.total, `${id} matches the designer's total`).toBe(cents(lb.packages[id].total));
    const at = await page.evaluate((id) => window.__lookbook.pages.findIndex((el) => el.querySelector(`.pkg-head[data-package="${id}"]`)), id);
    await showPage(page, at);
    const head = page.locator(`.stage .pkg-head[data-package="${id}"]`);
    await expect(head.getByTestId('package-total')).toHaveText(money(e.total));
    await head.getByTestId('load-package').click();
    if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
    const drawer = page.getByTestId('picks-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('sub-new')).toHaveText(money(e.taxed));
    await expect(drawer.getByTestId('sub-used')).toHaveText(money(e.untaxed));
    await expect(drawer.getByTestId('tax')).toHaveText(money(e.tax));
    await expect(drawer.getByTestId('delivery')).toHaveText(money(e.delivery));
    await expect(drawer.getByTestId('total')).toHaveText(money(e.total));
    await expect(drawer.getByTestId('budget')).toHaveAttribute('data-level', levels[id]);
    await expect(page.getByTestId('picks-total')).toHaveText(money(e.total));
    await expect(page.getByTestId('picks-count')).toHaveText(String(lb.packages[id].items.length));
    await page.keyboard.press('Escape');
  }
  // above $1,200 turns red
  const big = lb.products.filter((p) => p.taxed).sort((a, b) => b.price - a.price)[0];
  const card = await showProduct(page, big.id);
  await card.getByTestId('pick').click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  if (await page.getByTestId('pick-option').first().isVisible().catch(() => false)) await page.getByTestId('pick-option').first().click();
  await page.getByTestId('picks-button').click();
  const total = await page.getByTestId('picks-drawer').getByTestId('total').textContent();
  const level = Number(total.replace(/[$,]/g, '')) > 1200 ? 'red' : 'amber';
  await expect(page.getByTestId('budget')).toHaveAttribute('data-level', level);
  await expect(page.getByTestId('picks-button')).toHaveClass(new RegExp(`level-${level}`));
});

test('package pages: every item, subtotal, tax, delivery and total in print', async ({ page }) => {
  await openBook(page, '#/packages');
  const printed = await page.evaluate(() => {
    const out = {};
    let cur = null;
    for (const el of window.__lookbook.pages) for (const b of el.querySelectorAll('.pkg-head, [data-testid=package-line], .pkg-totals')) {
      if (b.classList.contains('pkg-head')) { cur = b.dataset.package; out[cur] = { lines: 0 }; }
      else if (b.dataset.testid === 'package-line') out[cur].lines++;
      else for (const k of ['package-subtotal', 'package-new', 'package-used', 'package-tax', 'package-delivery', 'package-total-row']) out[cur][k] = b.querySelector(`[data-testid=${k}]`).textContent;
    }
    return out;
  });
  for (const id of Object.keys(lb.packages)) {
    const e = expectedPackage(id);
    expect(printed[id].lines).toBe(lb.packages[id].items.length);
    expect(printed[id]['package-subtotal']).toBe(money(e.taxed + e.untaxed));
    expect(printed[id]['package-new']).toBe(money(e.taxed));
    expect(printed[id]['package-used']).toBe(money(e.untaxed));
    expect(printed[id]['package-tax']).toBe(money(e.tax));
    expect(printed[id]['package-delivery']).toBe(money(e.delivery));
    expect(printed[id]['package-total-row']).toBe(money(e.total));
  }
});

test('filters work inside the book and keep the place', async ({ page }) => {
  await openBook(page, '#/living/LR-RUG');
  await page.getByTestId('filters-button').click();
  const panel = page.getByTestId('filter-panel');
  await expect(panel).toBeVisible();
  await panel.locator('[data-store="IKEA"]').check();
  await expect(page.getByTestId('filters-count')).toHaveText('1');
  await expect(panel.getByTestId('filter-result')).toContainText(`${lb.products.filter((p) => p.store === 'IKEA').length} of ${lb.products.length}`);
  await page.getByTestId('filters-done').click();
  await settled(page);
  const stores = await page.evaluate(() => [...new Set(window.__lookbook.pages.flatMap((el) => [...el.querySelectorAll('.pcard')].map((c) => c.dataset.product)))]);
  expect(stores.length).toBe(lb.products.filter((p) => p.store === 'IKEA').length);
  expect(stores.every((id) => byId.get(id).store === 'IKEA')).toBe(true);
  expect(await page.evaluate(() => window.__lookbook.sectionOf(window.__lookbook.book.visible()[0]))).toBe('living/LR-RUG');
  await expect(page.locator('.stage')).toContainText('Filters are on');
  expect(await layoutProblems(page)).toEqual([]);
  // the comparison still lists everything
  const rows = await page.evaluate(() => window.__lookbook.pages.flatMap((el) => [...el.querySelectorAll('[data-testid=compare-row]')]).length);
  expect(rows).toBe(lb.products.length);
  await page.getByTestId('filters-button').click();
  await page.getByTestId('clear-filters').click();
  await expect(page.getByTestId('filters-count')).toHaveText('');
  const all = await page.evaluate(() => window.__lookbook.pages.flatMap((el) => [...el.querySelectorAll('.pcard')]).length);
  expect(all).toBe(lb.products.length);
});

test('page sound is off by default; the toggle turns it on and is remembered', async ({ page }) => {
  await openBook(page, '#/welcome');
  const btn = page.getByTestId('sound-toggle');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('sound-toggle').click();
  await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('links into the book: a product, a category, and old links from the 3D rooms', async ({ page }) => {
  const { errors } = await openBook(page, '#p=LB-TRAY-01&room=living');
  expect(await visible(page)).toContain(await page.evaluate(() => window.__lookbook.productPage.get('LB-TRAY-01')));
  await expect(page.locator('.stage [data-product="LB-TRAY-01"]')).toBeVisible();
  // a shared category printed in the other chapter still opens
  const pillow = lb.categories.find((c) => c.id === 'PILLOW');
  await page.goto('/lookbook/#/bedroom/PILLOW');
  await settled(page);
  const at = await page.evaluate(() => Object.entries(window.__lookbook.sectionStart).find(([k]) => k.endsWith('/PILLOW'))[1]);
  expect(await visible(page)).toContain(at);
  await expect(page.locator('.stage')).toContainText(pillow.label);
  // the hash follows the pages, so a reload opens the same place
  await page.keyboard.press('ArrowRight');
  await settled(page);
  const hash = await page.evaluate(() => location.hash);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  expect(errors).toEqual([]);
});

test('page turns stay smooth @perf', async ({ page }, info) => {
  await openBook(page, '#/living/LR-RUG');
  const cdp = await page.context().newCDPSession(page);
  if (phone(info)) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); // a mid-range phone
  const r = await page.evaluate(async () => {
    const times = [];
    let last = performance.now(), on = true;
    const tick = (t) => { times.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    for (let i = 0; i < 6; i++) await window.__lookbook.book.next();
    on = false;
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    return { frames: times.length, avg: times.reduce((a, b) => a + b, 0) / times.length, p95: sorted[Math.floor(sorted.length * 0.95)], long: times.filter((t) => t > 50).length };
  });
  fs.writeFileSync(path.join(root, 'test-results', `book-perf-${info.project.name}.json`), JSON.stringify(r, null, 2));
  test.info().annotations.push({ type: 'frames', description: `avg ${r.avg.toFixed(1)} ms (${(1000 / r.avg).toFixed(0)} fps), p95 ${r.p95.toFixed(1)} ms, ${r.long} frames over 50 ms of ${r.frames}` });
  expect(r.avg).toBeLessThan(25); // 40 fps or better on average
  expect(r.long / r.frames).toBeLessThan(0.05);
});
