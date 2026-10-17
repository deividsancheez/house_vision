// Shared helpers for the end-to-end tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
export const shotsDir = path.join(root, 'test-results', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

export const products = JSON.parse(fs.readFileSync(path.join(root, '../products.json'), 'utf8'));
export const spec = JSON.parse(fs.readFileSync(path.join(root, '../room-spec.json'), 'utf8'));
export const productById = new Map(products.products.map((p) => [p.id, p]));

/** Open the app, wait until every model in the room has loaded; returns the list of console errors
 *  and of requests that left this computer (the app must not hot-link anything). */
export async function openApp(page, query = '') {
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data')) external.push(r.url()); });
  // the existing tests run in Overview (Walk mode is the default for a person on a first visit)
  const q = new URLSearchParams(query);
  if (!q.has('mode')) q.set('mode', 'overview');
  if (!q.has('tutorial')) q.set('tutorial', '0');
  await page.goto(`/?${q}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90_000 });
  await page.evaluate(() => window.__app.whenLoaded());
  return { errors, external };
}

export const loaded = (page) => page.evaluate(() => window.__app.whenLoaded());

export async function setRoom(page, id) {
  await page.evaluate(async (r) => { await window.__app.setRoom(r); await window.__app.whenLoaded(); }, id);
}

/** Integer-cent budget math done independently of the app: new items taxed at products.json tax_rate
 *  (rounded to the cent, half up), used items untaxed. `options` maps slot_id -> product id or null. */
export function expectedTotal(options) {
  let taxed = 0, untaxed = 0;
  for (const s of products.slots) {
    const pid = s.slot_id in options ? options[s.slot_id] : s.default_option;
    if (!pid) continue;
    const p = productById.get(pid);
    const cents = Math.round(p.price * 100) * (p.qty ?? 1);
    if (p.taxed) taxed += cents; else untaxed += cents;
  }
  const rateBp = Math.round(products.tax_rate * 10000);
  const tax = Math.floor((taxed * rateBp + 5000) / 10000);
  return { taxed, tax, untaxed, total: taxed + tax + untaxed };
}

export const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function budgetText(page) {
  return (await page.getByTestId('budget-total').textContent()).trim();
}

/** Select an item the way a person does: point the camera at it, then click/tap it on screen. */
export async function clickSelect(page, key, { touch = false } = {}) {
  await page.evaluate((k) => { window.__app.select(null); window.__app.focus(k); }, key);
  // things stored in the closet are behind its sliding doors: open them first, as a person would
  const inCloset = await page.evaluate((k) => window.__app.isInCloset(k), key);
  if (inCloset && (await page.evaluate(() => window.__app.closetDoors))) await page.getByRole('button', { name: 'Closet doors' }).click();
  await page.waitForFunction(() => !window.__app.tween); // the camera glides to the piece
  await page.waitForTimeout(250);
  let pos = await page.evaluate((k) => window.__app.visiblePointOf(k), key);
  if (!pos) {
    await page.evaluate(() => window.__app.applyPreset('top', false));
    await page.waitForTimeout(300);
    pos = await page.evaluate((k) => window.__app.visiblePointOf(k), key);
  }
  expect(pos, `${key} should be visible somewhere on screen`).toBeTruthy();
  if (touch) await page.touchscreen.tap(pos.x, pos.y);
  else await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(150);
  const sel = await page.evaluate(() => window.__app.selected);
  if (inCloset) await page.evaluate(() => window.__app.setClosetDoors(true));
  return sel;
}

export async function shot(page, name) {
  const file = path.join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Drag the selected item with the mouse from its screen spot to a room point (inches). */
export async function mouseDragTo(page, key, target) {
  const from = await page.evaluate((k) => window.__app.visiblePointOf(k), key);
  const to = await page.evaluate((t) => window.__app.screenOfPoint(t), target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const n = 25;
  for (let i = 1; i <= n; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/** Real multi-finger touch input through Chrome DevTools: each finger moves from from[i] to to[i]. */
export async function touchGesture(page, from, to, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (k) => from.map((f, i) => ({ x: f.x + ((to[i].x - f.x) * k) / steps, y: f.y + ((to[i].y - f.y) * k) / steps, id: i, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(120);
}

/** Drag the selected item to a room point with the mouse, or with one finger on touch screens. */
export async function dragTo(page, key, target, { touch = false } = {}) {
  if (!touch) return mouseDragTo(page, key, target);
  const from = await page.evaluate((k) => window.__app.visiblePointOf(k), key);
  const to = await page.evaluate((t) => window.__app.screenOfPoint(t), target);
  await touchGesture(page, [from], [to], 25);
}
