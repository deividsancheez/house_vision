// Save / name / load / compare layouts (kept in the browser), export to a file and import it back,
// and "Reset to designer's layout".
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openApp, setRoom, loaded, budgetText, expectedTotal, money } from './helpers.js';

const openLayouts = (page) => page.getByRole('button', { name: 'Saved layouts' }).click();
const closeModal = (page) => page.locator('.modal-head .icon-btn').click();

async function swap(page, room, slotId, pid) {
  await setRoom(page, room);
  await page.evaluate((k) => window.__app.select(k), `${slotId}#0`);
  await page.getByTestId('item-card').locator(`.opt[data-option="${pid}"]`).click();
  await loaded(page);
  await page.evaluate(() => window.__app.select(null));
}

test('save, reload, load, compare, export, import and reset', async ({ page }, info) => {
  const { errors } = await openApp(page);
  const designer = await page.evaluate(() => JSON.stringify(window.__app.layout));

  // Layout A: rug B, floor lamp moved
  await swap(page, 'living', 'LR-RUG', 'LR-RUG-B');
  await page.evaluate(() => { window.__app.select('LR-FLOORLAMP#0'); window.__app.moveSelectedTo({ x: 40, y: 14 }); window.__app.select(null); });
  const lampA = await page.evaluate(() => ({ ...window.__app.layout.slots['LR-FLOORLAMP'].poses[0] }));
  await openLayouts(page);
  await page.getByTestId('layout-name').fill('Cozy A');
  await page.getByTestId('save-layout').click();
  await expect(page.locator('.saved-row[data-layout="Cozy A"]')).toBeVisible();
  await closeModal(page);

  // the working layout survives a reload
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await loaded(page);
  expect(await page.evaluate(() => window.__app.layoutName)).toBe('Cozy A');
  expect(await page.evaluate(() => window.__app.layout.slots['LR-RUG'].option)).toBe('LR-RUG-B');

  // Layout B: desk B in the bedroom
  await swap(page, 'bedroom', 'BR-DESK', 'BR-DESK-B');
  await openLayouts(page);
  await page.getByTestId('layout-name').fill('Desk B');
  await page.getByTestId('save-layout').click();
  await expect(page.locator('.saved-row')).toHaveCount(2);

  // compare A vs B: totals and the differing slots
  await page.getByTestId('cmp-a').selectOption({ label: 'Cozy A' });
  await page.getByTestId('cmp-b').selectOption({ label: 'Desk B' });
  await page.getByTestId('compare').click();
  const cmp = page.getByTestId('compare-out');
  await expect(cmp).toContainText('Desk');
  const totA = expectedTotal({ 'LR-RUG': 'LR-RUG-B' }).total, totB = expectedTotal({ 'LR-RUG': 'LR-RUG-B', 'BR-DESK': 'BR-DESK-B' }).total;
  await expect(cmp.locator('tr.sum')).toContainText(money(totA));
  await expect(cmp.locator('tr.sum')).toContainText(money(totB));

  // reset to the designer's layout (with confirmation)
  await page.getByTestId('reset-designer').click();
  await page.getByTestId('reset-confirm').click();
  await loaded(page);
  expect(await budgetText(page)).toBe('$1,018.17');
  expect(await page.evaluate(() => window.__app.layoutName)).toBe("Designer's layout");
  expect(await page.evaluate(() => JSON.stringify(window.__app.layout))).toBe(designer); // every slot, option and position
  expect(await page.evaluate(() => window.__app.layout.slots['LR-RUG'].option)).toBe('LR-RUG-A');

  // load A back: swap and moved lamp return
  await openLayouts(page);
  await page.locator('.saved-row[data-layout="Cozy A"]').getByTestId('load-layout').click();
  await loaded(page);
  expect(await page.evaluate(() => window.__app.layout.slots['LR-RUG'].option)).toBe('LR-RUG-B');
  expect(await page.evaluate(() => window.__app.layout.slots['LR-FLOORLAMP'].poses[0])).toMatchObject({ x: lampA.x, y: lampA.y });
  expect(await budgetText(page)).toBe(money(totA));

  // export all saved layouts to a file
  await openLayouts(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-all').click()]);
  const file = info.outputPath('layouts.json');
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data.app).toBe('room-viewer-layouts');
  expect(data.layouts.map((l) => l.name).sort()).toEqual(['Cozy A', 'Desk B']);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-current').click()]);
  const cur = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  expect(cur.layouts[0].layout.slots['LR-RUG'].option).toBe('LR-RUG-B');

  // delete both, then import the file back
  for (const name of ['Cozy A', 'Desk B']) {
    const row = page.locator(`.saved-row[data-layout="${name}"]`);
    await row.getByRole('button', { name: 'Delete' }).click();
    await row.locator('.confirm').getByRole('button', { name: 'Delete' }).click();
  }
  await expect(page.locator('.saved-row')).toHaveCount(0);
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(page.locator('.saved-row')).toHaveCount(2);
  await expect(page.locator('.toast').filter({ hasText: 'Imported 2 layouts' })).toBeVisible();
  await page.locator('.saved-row[data-layout="Desk B"]').getByTestId('load-layout').click();
  await loaded(page);
  expect(await page.evaluate(() => window.__app.layout.slots['BR-DESK'].option)).toBe('BR-DESK-B');

  // a broken file is refused with a message, nothing changes
  await openLayouts(page);
  const bad = info.outputPath('bad.json');
  fs.writeFileSync(bad, '{"not": "a layout"');
  await page.getByTestId('import-file').setInputFiles(bad);
  await expect(page.locator('.toast.error')).toBeVisible();
  await expect(page.locator('.saved-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});
