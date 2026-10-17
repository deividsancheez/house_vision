// Live budget: new items + 9.75% tax, used items untaxed, against the $1,000 cap. The designer's
// layout must total exactly $1,018.17 (shown red). Swaps made in the UI update it.
import { test, expect } from '@playwright/test';
import { openApp, setRoom, loaded, expectedTotal, money, budgetText, products } from './helpers.js';

test('designer layout totals $1,018.17 and shows red', async ({ page }) => {
  const { errors } = await openApp(page);
  const exp = expectedTotal({});
  expect(exp.total).toBe(101817); // independent math from products.json
  expect(await budgetText(page)).toBe('$1,018.17');
  await expect(page.locator('.budget-chip')).toHaveClass(/over/);
  expect(await page.locator('.budget-chip').evaluate((el) => getComputedStyle(el).color)).toMatch(/rgb\((1[5-9]\d|2\d\d), (\d|[1-9]\d), (\d|[1-9]\d)\)/); // red
  await page.locator('.budget-chip').click();
  await expect(page.getByTestId('budget-modal-total')).toHaveText('$1,018.17');
  await expect(page.getByTestId('sub-new')).toHaveText(money(exp.taxed));
  await expect(page.getByTestId('tax')).toHaveText(money(exp.tax));
  await expect(page.getByTestId('sub-used')).toHaveText(money(exp.untaxed));
  expect([money(exp.taxed), money(exp.tax), money(exp.untaxed)]).toEqual(['$718.15', '$70.02', '$230.00']);
  expect(errors).toEqual([]);
});

/** Swap through the item card, like a person would. */
async function swapInUI(page, slotId, productId) {
  const slot = products.slots.find((s) => s.slot_id === slotId);
  await setRoom(page, slot.room);
  await page.evaluate((k) => window.__app.select(k), `${slotId}#0`);
  await page.getByTestId('item-card').locator(`.opt[data-option="${productId}"]`).click();
  await loaded(page);
}

const COMBOS = [
  { name: 'rug B + desk B', swaps: { 'LR-RUG': 'LR-RUG-B', 'BR-DESK': 'BR-DESK-B' } },
  { name: 'bedroom budget picks', swaps: { 'BR-NIGHTSTAND': 'BR-NIGHTSTAND-B', 'BR-CHAIR': 'BR-CHAIR-B', 'BR-DESKLAMP': 'BR-DESKLAMP-B' } },
  { name: 'living alternates', swaps: { 'LR-FLOORLAMP': 'LR-FLOORLAMP-B', 'LR-SCONCE': 'LR-SCONCE-B', 'LR-CURTAIN': 'LR-CURTAIN-B', 'LR-ART': 'LR-ART-B' } },
  { name: 'WiFi cabinet removed', swaps: { 'LR-WIFI': null } },
];

for (const combo of COMBOS) {
  test(`budget after swaps: ${combo.name}`, async ({ page }) => {
    const { errors } = await openApp(page);
    for (const [slotId, pid] of Object.entries(combo.swaps)) {
      const slot = products.slots.find((s) => s.slot_id === slotId);
      if (!slot) throw new Error(`unknown slot ${slotId}`);
      if (pid && !slot.options.includes(pid)) throw new Error(`${pid} is not an option of ${slotId}`);
      if (pid) await swapInUI(page, slotId, pid);
      else {
        await setRoom(page, slot.room);
        await page.evaluate((k) => window.__app.select(k), `${slotId}#0`);
        await page.getByTestId('remove').click();
      }
    }
    const exp = expectedTotal(combo.swaps);
    expect(await budgetText(page)).toBe(money(exp.total));
    await expect(page.locator('.budget-chip')).toHaveClass(exp.total > 100000 ? /over/ : /ok/);
    await page.locator('.budget-chip').click();
    await expect(page.getByTestId('sub-new')).toHaveText(money(exp.taxed));
    await expect(page.getByTestId('tax')).toHaveText(money(exp.tax));
    await expect(page.getByTestId('sub-used')).toHaveText(money(exp.untaxed));
    test.info().annotations.push({ type: 'total', description: `${combo.name}: ${money(exp.total)}` });
    expect(errors).toEqual([]);
  });
}
