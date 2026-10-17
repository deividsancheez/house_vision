// Every product: swap it into its slot from the item card, check it loads at the right size, can be
// selected by clicking it, moved, rotated and removed, and that its Buy (and backup) link opens the
// product's page. External pages are stubbed here; tools/check-links.mjs visits the real ones.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, setRoom, loaded, products, productById, clickSelect, expectedTotal, money, budgetText, root } from './helpers.js';

const PHONE_SLOTS = ['LR-FLOORLAMP', 'BR-NIGHTSTAND', 'LR-ART'];

test.beforeEach(async ({ context }) => {
  await context.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>stub' }));
});

/** Per-test record of what was checked, for the test report. */
function record(info, slotId, results) {
  const dir = path.join(root, 'test-results', 'products');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${info.project.name}-${slotId}.json`), JSON.stringify(results, null, 2));
}

/** Allowed size difference: 1" or 6%, whichever is larger. */
const close = (got, want) => Math.abs(got - want) <= Math.max(1, want * 0.06);

for (const slot of products.slots) {
  test(`slot ${slot.slot_id}: every option loads, fits and works`, async ({ page }, info) => {
    const phone = info.project.name === 'phone';
    test.skip(phone && !PHONE_SLOTS.includes(slot.slot_id), 'phone runs a sample of slots');
    const results = [];
    try { await run(results); } finally { record(info, slot.slot_id, results); }
  async function run(results) {
    const { errors, external } = await openApp(page, `room=${slot.room}`);
    await setRoom(page, slot.room);
    const key0 = `${slot.slot_id}#0`;

    for (const pid of slot.options) {
      const p = productById.get(pid);
      const r = { product: pid, slot: slot.slot_id, project: info.project.name };
      results.push(r);

      // --- swap from the item card
      await page.evaluate((k) => { window.__app.select(k); }, key0);
      const card = page.getByTestId('item-card');
      await expect(card).toBeVisible();
      if ((await card.getAttribute('data-product')) !== pid) {
        await card.locator(`.opt[data-option="${pid}"]`).click();
        await loaded(page);
      }
      await expect(card).toHaveAttribute('data-product', pid);
      expect(await page.evaluate((s) => window.__app.layout.slots[s].option, slot.slot_id)).toBe(pid);
      r.swap = 'ok';
      if (pid === slot.default_option) await expect(card.locator(`.opt[data-option="${pid}"] .def`)).toBeVisible();

      // --- info card
      await expect(card.locator('h2')).toHaveText(p.name);
      await expect(card.getByTestId('item-price')).toHaveText(money(Math.round(p.price * 100)));
      if (p.regular_price && p.regular_price > p.price) await expect(card.locator('.was')).toHaveText(money(Math.round(p.regular_price * 100)));
      await expect(card.locator('.badge.used, .badge.new').first()).toHaveText(p.condition === 'used' ? 'Used' : 'New');
      await expect(card.locator('.status')).toHaveText(p.status_today);
      await expect(card.locator('.photo img')).toHaveJSProperty('complete', true);
      expect(await card.locator('.photo img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

      // --- Buy link (and backup search for used items) open the product page in a new tab
      const buy = card.getByTestId('buy');
      await expect(buy).toHaveAttribute('href', p.buy_url);
      await expect(buy).toHaveAttribute('target', '_blank');
      const [popup] = await Promise.all([page.waitForEvent('popup'), buy.click()]);
      expect(popup.url()).toBe(new URL(p.buy_url).href);
      await popup.close();
      r.buy = popup.url();
      if (p.condition === 'used' && p.backup_search_url) {
        const backup = card.getByTestId('backup');
        await expect(backup).toHaveAttribute('href', p.backup_search_url);
        const [pop2] = await Promise.all([page.waitForEvent('popup'), backup.click()]);
        expect(pop2.url()).toBe(new URL(p.backup_search_url).href);
        await pop2.close();
        r.backup = 'ok';
      }

      // --- every instance is in the scene at the product's size
      const inst = await page.evaluate((s) => window.__app.items.filter((i) => i.slot?.slot_id === s).map((i) => ({ key: i.key, hidden: i.hidden, kind: i.productKind, dims: i.dims, mount: i.mount })), slot.slot_id);
      expect(inst.length).toBeGreaterThanOrEqual(slot.placements.length); // BR-ART-B is a set of 3 canvases
      r.sizes = [];
      for (const it of inst) {
        if (it.hidden) { r.sizes.push({ key: it.key, hidden: true }); continue; }
        const s = await page.evaluate((k) => window.__app.modelSize(k), it.key);
        expect(s, `${it.key} has a model`).not.toBeNull();
        const checks = it.kind === 'curtain' ? ['h'] : ['w', 'd', 'h'];
        const got = Object.fromEntries(['w', 'd', 'h'].map((a) => [a, Math.round(s[a] * 10) / 10]));
        r.sizes.push({ key: it.key, want: it.dims, got });
        for (const a of checks) expect(close(s[a], it.dims[a]), `${it.key} ${a}: drawn ${got[a]}" vs product ${it.dims[a]}"`).toBeTruthy();
      }
      if (inst[0].hidden) {
        r.select = 'not drawn (pillow insert): selected from the Items list';
        await page.evaluate(() => window.__app.select(null));
        await page.getByRole('button', { name: 'Items list' }).click();
        await page.locator(`.menu [data-slot="${slot.slot_id}"]`).click();
        await expect(page.getByTestId('item-card')).toHaveAttribute('data-product', pid);
        await page.locator('.menu').evaluate((m) => { m.hidden = true; });
      } else {
        // --- select by clicking it in the 3D view
        const sel = await clickSelect(page, key0, { touch: phone });
        expect(sel, `clicking ${key0} selects it`).toBe(key0);
        r.select = 'ok';
        await expect(page.getByTestId('item-card')).toHaveAttribute('data-product', pid);

        // --- move with the arrow pad (some directions can be blocked by walls/furniture)
        const pose0 = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key0);
        let moved = false;
        for (const dir of ['Move right', 'Move left', 'Move away', 'Move closer']) {
          await page.getByRole('button', { name: dir }).click();
          const pose = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key0);
          if (Math.hypot(pose.x - pose0.x, pose.y - pose0.y, (pose.z ?? 0) - (pose0.z ?? 0)) > 0.5) { moved = dir; break; }
        }
        expect(moved, `${pid} moves`).toBeTruthy();
        r.move = moved;
        await page.getByRole('button', { name: 'Reset spot' }).click();

        // --- rotate (floor/top items turn 15 degrees; wall items turn a quarter in the wall plane)
        const rot0 = await page.evaluate((k) => { const p = window.__app.item(k).pose; return `${p.rot}|${p.spin ?? 0}`; }, key0);
        let turned = false;
        for (const b of ['rotate-left', 'rotate-right']) {
          await page.getByTestId(b).click();
          const rot = await page.evaluate((k) => { const p = window.__app.item(k).pose; return `${p.rot}|${p.spin ?? 0}`; }, key0);
          if (rot !== rot0) { turned = b; break; }
        }
        if (!turned) {
          // blocked where it stands: the app must say so; then it must turn once moved into open floor
          await expect(page.locator('.toast').filter({ hasText: 'No room to turn' }).first()).toBeVisible();
          r.rotate = 'blocked in place (toast shown)';
        } else r.rotate = turned;
        await page.getByRole('button', { name: 'Reset spot' }).click();
        const back = await page.evaluate((k) => { const p = window.__app.item(k).pose; return `${p.rot}|${p.spin ?? 0}`; }, key0);
        expect(back).toBe(rot0);
      }

      // --- remove: the item leaves the scene and the budget; then add it back from the Items list
      const before = await page.evaluate(() => Object.fromEntries(Object.entries(window.__app.layout.slots).map(([k, v]) => [k, v.option])));
      await page.getByTestId('remove').click();
      expect(await page.evaluate((s) => window.__app.layout.slots[s].option, slot.slot_id)).toBeNull();
      expect(await page.evaluate((s) => [...window.__app.room.objects.keys()].filter((k) => k.startsWith(`${s}#`)).length, slot.slot_id)).toBe(0);
      expect(await budgetText(page)).toBe(money(expectedTotal({ ...before, [slot.slot_id]: null }).total));
      r.remove = 'ok';
      await page.getByRole('button', { name: 'Items list' }).click();
      await page.locator(`.menu [data-restore="${slot.slot_id}"]`).click();
      await loaded(page);
      expect(await page.evaluate((s) => window.__app.layout.slots[s].option, slot.slot_id)).toBe(slot.default_option);
      await page.locator('.menu').evaluate((m) => { m.hidden = true; });
    }

    expect(errors, 'no console errors').toEqual([]);
    expect(external, 'no requests leave the app (no hot-linking)').toEqual([]);
  }
  });
}
