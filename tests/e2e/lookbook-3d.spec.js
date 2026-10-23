// The lookbook and the 3D rooms together: picks made in the lookbook appear under "From lookbook" at
// their true size; a slot product swaps into its 3D slot, a free product is carried in and set down
// (on the floor, or on a table), a used one is untaxed; the budget follows; storing one sends it back
// to "From lookbook"; un-picking it in the lookbook takes it out of the rooms; a product without a
// size can't be placed; Reset keeps the picks.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, budgetText, expectedTotal, money, shot, root } from './helpers.js';

const lb = JSON.parse(fs.readFileSync(path.resolve(root, '../../Lookbook Handoff/products.json'), 'utf8'));
const byId = new Map(lb.products.map((p) => [p.id, p]));
const cents = (d) => Math.round(d * 100);
const tax = (taxed) => Math.floor((taxed * 975 + 5000) / 10000);
const isPhone = (info) => info.project.name === 'phone';

const RUG = lb.products.find((p) => p.delivery_fee && p.slot_3d === 'LR-RUG'); // slot product with a delivery fee
const DESK = byId.get('BR-DESK-B'); // used, swaps into the desk slot
const SIDE = byId.get('LB-SIDETABLE-01'); // free placement, floor
const TRAY = byId.get('LB-TRAY-01'); // free placement, on any surface
const NOSIZE = byId.get('LB-LR-FLOORLAMP-03'); // size not published

const st = (page) => page.evaluate(() => window.__app.walk.state());
const teleport = (page, x, y, yaw, pitch = -8) => page.evaluate(([x, y, yaw, pitch]) => window.__app.walk.teleport(x, y, yaw, pitch), [x, y, yaw, pitch]);
const lookAt = (page, p) => page.evaluate((p) => window.__app.walk.lookAtPoint(p), p);
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
async function drop(page, phone) {
  if (phone) await page.locator('.wbtn[data-act="primary"]').tap();
  else await page.keyboard.press('e');
  await page.waitForTimeout(80);
}
/** Aim at floor points of the room until the carried piece's preview is green or yellow (a clear spot). */
async function findSpot(page, roomId) {
  const b = await page.evaluate((r) => window.__app.cat.rooms.get(r).bounds, roomId);
  for (let y = b.y0 + 30; y < b.y1 - 20; y += 25) {
    for (let x = b.x0 + 30; x < b.x1 - 20; x += 25) {
      await teleport(page, x + 60, y, 90);
      await lookAt(page, { x, y, z: 0 });
      await frames(page);
      const s = await page.evaluate(() => window.__app.walk.state().carry?.status);
      if (s === 'ok' || s === 'warn') return { x, y, status: s };
    }
  }
  return null;
}
async function pickInLookbook(page, room, p) {
  await page.goto(`/lookbook/#p=${p.id}&room=${room}`); // the book opens at the page with this product
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  const card = page.locator(`[data-testid=product-card][data-product="${p.id}"]`);
  await card.getByTestId('pick').click();
  if (await page.getByTestId('confirm').isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
  await expect(card.getByTestId('pick')).toHaveAttribute('aria-pressed', 'true');
}
async function openFromLookbook(page) {
  if (!(await page.getByTestId('inventory').isVisible())) await page.getByRole('button', { name: 'Inventory' }).first().click();
  await page.locator('[data-testid=inventory] [data-tab=lookbook]').click();
  await expect(page.locator('[data-testid=inventory] [data-tab=lookbook]')).toHaveAttribute('aria-selected', 'true');
}
const lbCard = (page, id) => page.locator(`[data-testid=lookbook-card][data-lookbook-id="${id}"]`);

test('lookbook picks in the 3D rooms: swap, place, used, budget, store, un-pick, size needed, reset', async ({ page }, info) => {
  test.setTimeout(240_000);
  const phone = isPhone(info);
  const { errors, external } = await openApp(page);
  expect(await budgetText(page)).toBe('$1,018.17');

  // pick 4 products in the lookbook, and send one without a size with "See in 3D"
  await pickInLookbook(page, 'living', RUG);
  await pickInLookbook(page, 'bedroom', DESK);
  await pickInLookbook(page, 'living', SIDE);
  await pickInLookbook(page, 'living', TRAY);
  await page.goto(`/lookbook/#p=${NOSIZE.id}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await page.locator(`[data-testid=product-card][data-product="${NOSIZE.id}"] [data-testid=see3d]`).click();
  await page.waitForURL(/\?inv=lookbook/);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90_000 });
  await page.evaluate(() => window.__app.whenLoaded());

  // "From lookbook" opens, pointing at the product without a size: it can't be placed
  await expect(page.locator('[data-testid=inventory] [data-tab=lookbook]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('lookbook-card')).toHaveCount(5);
  const nosize = lbCard(page, NOSIZE.id);
  await expect(nosize).toHaveClass(/\bhl\b/);
  await expect(nosize.getByTestId('size-needed')).toBeVisible();
  await expect(nosize.getByTestId('lb-place')).toBeDisabled();
  for (const b of await nosize.getByTestId('lb-swap').all()) await expect(b).toBeDisabled();
  await expect(page.getByTestId('budget-total')).toHaveText('$1,018.17'); // not in the budget until placed
  await shot(page, `lookbook-3d-from-lookbook-${info.project.name}`);

  // true size from the lookbook
  const dims = await page.evaluate((id) => window.__app.cat.products.get([...window.__app.cat.lookbookRefs].find((r) => r.includes(`:${id}:`))).dimensions_in, SIDE.id);
  expect(dims).toEqual({ w: SIDE.dimensions.w_in, d: SIDE.dimensions.d_in, h: SIDE.dimensions.h_in });

  // 1. slot product: the rug swaps into the living room rug slot; its delivery fee is added
  const base = expectedTotal({ 'LR-RUG': null, 'BR-DESK': null });
  const designerDesk = await page.evaluate(() => window.__app.layout.slots['BR-DESK'].option);
  await lbCard(page, RUG.id).locator('[data-testid=lb-swap][data-slot=LR-RUG]').click();
  await expect.poll(() => page.evaluate(() => window.__app.layout.slots['LR-RUG'].option)).toMatch(new RegExp(`^lb:.*:${RUG.id}:`));
  const deskCents = cents(byId.get(designerDesk)?.price ?? 0);
  let taxed = base.taxed + cents(RUG.price);
  let untaxed = base.untaxed + deskCents;
  await expect(page.getByTestId('budget-total')).toHaveText(money(taxed + tax(taxed) + untaxed + cents(RUG.delivery_fee)));
  await shot(page, `lookbook-3d-rug-swapped-${info.project.name}`);

  // 2. used product: the desk swaps in, no tax on it
  await openFromLookbook(page);
  await lbCard(page, DESK.id).locator('[data-testid=lb-swap][data-slot=BR-DESK]').click();
  await expect.poll(() => page.evaluate(() => window.__app.layout.slots['BR-DESK'].option)).toMatch(/^lb:/);
  untaxed = base.untaxed + cents(DESK.price);
  await expect(page.getByTestId('budget-total')).toHaveText(money(taxed + tax(taxed) + untaxed + cents(RUG.delivery_fee)));
  const budgetLine = await page.evaluate(() => window.__app.budget.lines.find((l) => l.slotId === 'BR-DESK'));
  expect(budgetLine.taxed).toBe(false);

  // 3. free product: the side table is carried in (Walk mode) and set down on open floor
  await page.evaluate(() => window.__app.setRoom('living'));
  await openFromLookbook(page);
  await lbCard(page, SIDE.id).getByTestId('lb-place').click();
  await page.waitForFunction(() => window.__app.viewMode === 'walk' && !!window.__app.walk.state().carry);
  // a red spot first: into the coffee table, and the drop is refused
  const ct = await page.evaluate(() => ({ ...window.__app.item('LR-COFFEE#0').pose }));
  await teleport(page, ct.x + 60, ct.y, 90);
  await lookAt(page, { x: ct.x, y: ct.y, z: 0 });
  await frames(page);
  await page.waitForFunction(() => window.__app.walk.state().carry?.status === 'bad', null, { timeout: 10_000 }).catch(() => {});
  if ((await st(page)).carry.status === 'bad') {
    await expect(page.getByTestId('carry-label')).toHaveAttribute('data-status', 'bad');
    await drop(page, phone);
    expect((await st(page)).carry, 'a red drop is refused').not.toBeNull();
  }
  expect(await findSpot(page, 'living'), 'a clear spot in the living room').not.toBeNull();
  await expect(page.getByTestId('carry-label')).toHaveAttribute('data-status', /ok|warn/);
  await shot(page, `lookbook-3d-carry-${info.project.name}`);
  await drop(page, phone);
  expect((await st(page)).carry).toBeNull();
  const side = await page.evaluate(() => window.__app.layout.lookbook.find((e) => e.product.includes('LB-SIDETABLE-01')));
  expect(side.poses[0].stored).toBeFalsy();
  taxed += cents(SIDE.price);
  const afterSide = taxed + tax(taxed) + untaxed + cents(RUG.delivery_fee);
  await expect(page.getByTestId('budget-total')).toHaveText(money(afterSide));

  await openFromLookbook(page);
  await lbCard(page, TRAY.id).getByTestId('lb-place').click();
  await page.waitForFunction(() => !!window.__app.walk.state().carry);
  // the tray goes on top of the coffee table (any surface)
  const coffee = await page.evaluate(() => { const it = window.__app.item('LR-COFFEE#0'); return { ...it.pose, h: it.dims.h }; });
  await teleport(page, coffee.x + 50, coffee.y, 180, -30);
  await lookAt(page, { x: coffee.x, y: coffee.y, z: coffee.h });
  await frames(page);
  await page.waitForFunction(() => ['ok', 'warn'].includes(window.__app.walk.state().carry?.status), null, { timeout: 10_000 });
  await shot(page, `lookbook-3d-tray-on-table-${info.project.name}`);
  await drop(page, phone);
  expect((await st(page)).carry).toBeNull();
  const tray = await page.evaluate(() => window.__app.layout.lookbook.find((e) => e.product.includes('LB-TRAY-01')));
  expect(tray.poses[0].on, 'the tray rests on the coffee table').toBe('LR-COFFEE');
  expect(tray.poses[0].z).toBeCloseTo(coffee.h, 0);
  taxed += cents(TRAY.price);
  await expect(page.getByTestId('budget-total')).toHaveText(money(taxed + tax(taxed) + untaxed + cents(RUG.delivery_fee)));

  // the item card links back to the lookbook
  await page.evaluate(() => window.__app.setViewMode('overview'));
  const sideKey = `${side.uid}#0`;
  await page.evaluate((k) => window.__app.select(k), sideKey);
  await expect(page.getByTestId('item-card').getByTestId('view-lookbook')).toHaveAttribute('href', new RegExp(`lookbook/#p=${SIDE.id}`));
  await expect(page.getByTestId('item-card')).not.toContainText('Reset spot');
  await shot(page, `lookbook-3d-item-card-${info.project.name}`);

  // storing it sends it back to "From lookbook" and out of the budget
  await page.evaluate((k) => window.__app.storeKey(k, 'living'), sideKey);
  taxed -= cents(SIDE.price);
  await expect(page.getByTestId('budget-total')).toHaveText(money(taxed + tax(taxed) + untaxed + cents(RUG.delivery_fee)));
  await openFromLookbook(page);
  await expect(lbCard(page, SIDE.id)).toBeVisible();
  await page.keyboard.press('Escape');

  // the budget modal lists the lookbook pieces and the delivery fee
  await page.getByRole('button', { name: 'Budget details' }).click();
  await expect(page.locator('.modal')).toContainText('from lookbook');
  await expect(page.locator('.modal')).toContainText(`+${money(cents(RUG.delivery_fee))} delivery`);
  await page.locator('.modal [aria-label=Close]').click();

  // saved layouts keep the lookbook pieces; export keeps working
  const saved = await page.evaluate(() => JSON.stringify(window.__app.layout));

  // un-pick the rug in the lookbook: it is placed, so the lookbook asks first; then it leaves the room
  await page.goto(`/lookbook/#p=${RUG.id}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  const rugCard = page.locator(`[data-testid=product-card][data-product="${RUG.id}"]`);
  await expect(rugCard).toContainText('In 3D');
  await rugCard.getByTestId('pick').click();
  await expect(page.getByTestId('confirm')).toBeVisible();
  await expect(page.getByTestId('confirm')).toContainText(/3D/);
  await page.getByTestId('confirm-ok').click();
  await expect(rugCard.getByTestId('pick')).toHaveAttribute('aria-pressed', 'false');
  await page.goto('/?mode=overview&tutorial=0');
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__app.layout.slots['LR-RUG'].option)).toBeNull();
  taxed -= cents(RUG.price);
  await expect(page.getByTestId('budget-total')).toHaveText(money(taxed + tax(taxed) + untaxed));
  expect(JSON.parse(saved).slots['LR-RUG'].option).toMatch(/^lb:/);

  // Reset to the designer's layout: $1,018.17 again, and the picks are still in the lookbook
  await page.evaluate(() => window.__app.resetToDesigner());
  await expect(page.getByTestId('budget-total')).toHaveText('$1,018.17');
  const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('lookbook.picks.v1')).picks);
  expect(Object.values(picks).map((p) => p.id).sort()).toEqual([DESK.id, SIDE.id, TRAY.id].sort());
  await openFromLookbook(page);
  await expect(page.getByTestId('lookbook-card')).toHaveCount(4); // desk, side table, tray + the tried lamp

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('a layout file from before the lookbook still loads', async ({ page }) => {
  await openApp(page);
  const old = await page.evaluate(() => { const l = structuredClone(window.__app.layout); delete l.lookbook; return l; });
  await page.evaluate((l) => window.__app.loadLayout(l, 'Old file'), old);
  await expect(page.getByTestId('budget-total')).toHaveText('$1,018.17');
  expect(await page.evaluate(() => window.__app.layout.lookbook)).toEqual([]);
});
