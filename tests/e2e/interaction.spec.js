// Camera and editing controls: mouse + keyboard on desktop; one-finger rotate, two-finger pinch/pan,
// tap to select and one-finger drag to move on the phone. Also: the room switch loads only the
// current room's models.
import { test, expect } from '@playwright/test';
import { openApp, setRoom, clickSelect, touchGesture, loaded, productById } from './helpers.js';

const cam = (page) => page.evaluate(() => {
  const a = window.__app, c = a.controls;
  return { az: c.getAzimuthalAngle(), polar: c.getPolarAngle(), dist: a.camera.position.distanceTo(c.target), target: c.target.toArray() };
});
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A screen spot over empty floor/wall (nothing selectable), near the middle of the view. */
async function emptySpot(page) {
  return page.evaluate(() => {
    const r = window.__app.canvas.getBoundingClientRect();
    for (let fy = 0.25; fy < 0.8; fy += 0.05) for (let fx = 0.2; fx < 0.8; fx += 0.05) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el === window.__app.canvas && !window.__app.pickAt(x, y)) return { x, y };
    }
    return null;
  });
}

test('touch: one finger rotates, two fingers pinch and pan, tap selects, drag moves the item', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch screen test');
  const { errors } = await openApp(page);
  const p = await emptySpot(page);
  expect(p).toBeTruthy();

  let c0 = await cam(page);
  await touchGesture(page, [p], [{ x: p.x + 120, y: p.y }]);
  await page.waitForTimeout(400);
  let c1 = await cam(page);
  expect(Math.abs(c1.az - c0.az), 'one-finger drag rotates the view').toBeGreaterThan(0.2);
  expect(await page.evaluate(() => window.__app.selected)).toBeNull();

  c0 = await cam(page);
  await touchGesture(page, [{ x: p.x - 30, y: p.y }, { x: p.x + 30, y: p.y }], [{ x: p.x - 120, y: p.y }, { x: p.x + 120, y: p.y }]);
  await page.waitForTimeout(400);
  c1 = await cam(page);
  expect(c1.dist, 'pinch out zooms in').toBeLessThan(c0.dist * 0.9);

  c0 = await cam(page);
  await touchGesture(page, [{ x: p.x - 40, y: p.y }, { x: p.x + 40, y: p.y }], [{ x: p.x - 40, y: p.y + 110 }, { x: p.x + 40, y: p.y + 110 }]);
  await page.waitForTimeout(400);
  c1 = await cam(page);
  expect(moved(c1.target, c0.target), 'two-finger drag pans').toBeGreaterThan(0.1);
  expect(Math.abs(c1.dist - c0.dist) / c0.dist).toBeLessThan(0.15);

  // tap to select, then one-finger drag moves the item (not the camera)
  const key = 'LR-FLOORLAMP#0';
  expect(await clickSelect(page, key, { touch: true })).toBe(key);
  await expect(page.getByTestId('item-card')).toBeVisible();
  await page.evaluate(() => window.__app.applyPreset('top', false));
  await page.waitForTimeout(300);
  const pose0 = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key);
  const az0 = (await cam(page)).az;
  const from = await page.evaluate((k) => window.__app.visiblePointOf(k), key);
  const to = await page.evaluate((pt) => window.__app.screenOfPoint(pt), { x: pose0.x + 30, y: pose0.y + 20, z: 0 });
  await touchGesture(page, [from], [to], 20);
  const pose1 = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key);
  expect(Math.hypot(pose1.x - pose0.x, pose1.y - pose0.y), 'finger drag moves the selected lamp').toBeGreaterThan(10);
  expect(Math.abs((await cam(page)).az - az0)).toBeLessThan(0.01);
  // tapping empty space deselects
  const e = await emptySpot(page);
  await page.touchscreen.tap(e.x, e.y);
  await expect.poll(() => page.evaluate(() => window.__app.selected)).toBeNull();
  expect(errors).toEqual([]);
});

test('mouse and keyboard: orbit, zoom, pan, select, R rotates, arrows move, Delete removes, Esc', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop test');
  const { errors } = await openApp(page);
  const p = await emptySpot(page);
  let c0 = await cam(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 150, p.y, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect(Math.abs((await cam(page)).az - c0.az)).toBeGreaterThan(0.2);
  c0 = await cam(page);
  await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  expect((await cam(page)).dist).toBeLessThan(c0.dist * 0.95);
  c0 = await cam(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(p.x + 100, p.y + 60, { steps: 10 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  expect(moved((await cam(page)).target, c0.target)).toBeGreaterThan(0.1);

  const key = 'LR-COFFEE#0';
  expect(await clickSelect(page, key)).toBe(key);
  const r0 = await page.evaluate((k) => window.__app.item(k).pose.rot, key);
  await page.keyboard.press('r');
  expect(await page.evaluate((k) => window.__app.item(k).pose.rot, key)).not.toBe(r0);
  const p0 = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key);
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft']) await page.keyboard.press(k);
  const p1 = await page.evaluate((k) => ({ ...window.__app.item(k).pose }), key);
  expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__app.selected)).toBeNull();
  await page.evaluate((k) => window.__app.select(k), key);
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__app.layout.slots['LR-COFFEE'].option)).toBeNull();
  expect(errors).toEqual([]);
});

test('room switch: tabs swap rooms and only the current room is loaded', async ({ page }) => {
  const { errors } = await openApp(page);
  const models = () => page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/models/')).map((n) => n.split('/models/')[1]));
  const manifest = await page.evaluate(async () => (await fetch('models/manifest.json')).json());
  // model files used only by bedroom products must not be downloaded while the living room shows
  const filesOf = (room) => new Set(Object.entries(manifest).filter(([id]) => productById.get(id)?.room === room).map(([, f]) => f));
  const livingFiles = filesOf('living'), bedroomOnly = [...filesOf('bedroom')].filter((f) => !livingFiles.has(f));
  const living = (await models()).filter((f) => f.endsWith('.glb'));
  expect(living.length).toBeGreaterThan(0);
  expect(living.filter((f) => bedroomOnly.includes(f)), 'no bedroom-only models loaded in the living room').toEqual([]);
  expect(await page.evaluate(() => !!window.__app.scene.getObjectByName('root-living'))).toBe(true);
  expect(await page.evaluate(() => !!window.__app.scene.getObjectByName('root-bedroom'))).toBe(false);
  await page.getByRole('tab', { name: 'Bedroom' }).click();
  await loaded(page);
  expect(await page.evaluate(() => window.__app.roomId)).toBe('bedroom');
  await expect(page.getByRole('tab', { name: 'Bedroom' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => !!window.__app.scene.getObjectByName('root-living')), 'living room detached').toBe(false);
  expect(await page.evaluate(() => !!window.__app.scene.getObjectByName('root-bedroom'))).toBe(true);
  expect((await models()).filter((f) => f.endsWith('.glb')).length).toBeGreaterThanOrEqual(living.length);
  await page.getByRole('tab', { name: 'Living room' }).click();
  await loaded(page);
  expect(await page.evaluate(() => window.__app.roomId)).toBe('living');
  expect(errors).toEqual([]);
});
