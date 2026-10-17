// Walk mode, on the desktop (keyboard + mouse) and on the phone (joystick + buttons): walking and
// the doorway, eye height, carrying with the colored preview, the inventory with the budget,
// undo/redo, warnings, goals and score, saving, the tutorial, and Overview staying as it was.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { openApp, loaded, budgetText, expectedTotal, money, shot, products, productById } from './helpers.js';

const isPhone = (info) => info.project.name === 'phone';
const st = (page) => page.evaluate(() => window.__app.walk.state());
const layoutOf = (page) => page.evaluate(() => JSON.stringify(window.__app.layout));
const poseOf = (page, key) => page.evaluate((k) => { const it = window.__app.item(k); return it ? { ...it.pose } : null; }, key);

async function openWalk(page, query = '') {
  const r = await openApp(page, `mode=walk${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => window.__app.viewMode === 'walk');
  return r;
}
const teleport = (page, x, y, yaw, pitch = -8) => page.evaluate(([x, y, yaw, pitch]) => window.__app.walk.teleport(x, y, yaw, pitch), [x, y, yaw, pitch]);
const lookAt = (page, p) => page.evaluate((p) => window.__app.walk.lookAtPoint(p), p);
async function faceItem(page, key) {
  expect(await page.evaluate((k) => window.__app.walk.faceItem(k), key), `a clear spot to aim at ${key}`).toBe(true);
  await page.waitForFunction((k) => window.__app.walk.state().aim === k, key);
}

// one action, the way a person does it: a key on the desktop, a HUD button on the phone
const KEYS = { pick: 'e', drop: 'e', store: 'f', rotate: 'r', cancel: 'Escape', bag: 'i', undo: 'Control+z', redo: 'Control+y', info: 'q' };
const BTNS = { pick: 'primary', drop: 'primary', store: 'store', rotate: 'rotate', cancel: 'cancel', bag: 'bag', undo: 'undo', redo: 'redo', info: 'info' };
async function act(page, phone, what) {
  if (phone) await page.locator(`.wbtn[data-act="${BTNS[what]}"]`).tap();
  else await page.keyboard.press(KEYS[what]);
  await page.waitForTimeout(60);
}

/** Phone: hold the joystick pushed in a direction (dx right, dy down, -1..1). */
async function joystick(page, dx, dy, until) {
  const box = await page.getByTestId('joystick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, R = box.width / 2;
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(cx, cy) });
  for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx + (dx * R * k) / 5, cy + (dy * R * k) / 5) });
  await until();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
/** Walk forward (W, or the joystick pushed up) for `ms`, or until `pred` holds in the page. */
async function walkFwd(page, phone, { ms = 0, run = false, pred = null, arg = null } = {}) {
  const until = async () => { if (pred) await page.waitForFunction(pred, arg, { timeout: 8000 }); else await page.waitForTimeout(ms); };
  if (phone) return joystick(page, 0, -1, until);
  if (run) await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  try { await until(); } finally {
    await page.keyboard.up('w');
    if (run) await page.keyboard.up('Shift');
  }
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
const sigSel = (sig) => `[data-sig=${JSON.stringify(sig)}]`;
const settle = (page) => page.waitForFunction(() => window.__app.walk.state().moving < 0.01, null, { timeout: 5000 });

/** The plan total done independently: options per slot, plus Catalog additions (product ids). */
function totalWith(options = {}, extras = []) {
  const base = expectedTotal(options);
  let { taxed, untaxed } = base;
  for (const pid of extras) {
    const p = productById.get(pid);
    const cents = Math.round(p.price * 100) * (p.qty ?? 1);
    if (p.taxed) taxed += cents; else untaxed += cents;
  }
  const rateBp = Math.round(products.tax_rate * 10000);
  return taxed + Math.floor((taxed * rateBp + 5000) / 10000) + untaxed;
}
async function expectBudget(page, cents) {
  await expect(page.getByTestId('budget-total')).toHaveText(money(cents));
  expect(await page.evaluate(() => window.__app.budget.totalCents), 'the app total is budget.js').toBe(cents);
}

// ------------------------------------------------------------------------------------------------
test('walking: start spot, eye height 68, walls, furniture, the kitchen edge and the front door stop you', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  let s = await st(page);
  expect(s.room).toBe('living');
  expect(Math.abs(s.x - 48) < 1 && Math.abs(s.y - 140) < 1, `start just past the front door: ${s.x},${s.y}`).toBe(true);
  expect(s.yaw).toBeCloseTo(-90, 3); // facing west, into the room
  expect(s.eye).toBe(68);
  expect(s.camZ).toBeCloseTo(68, 3);
  await expect(page.getByTestId('crosshair')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walk', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  await shot(page, `walk-living-day-${info.project.name}`);

  // walking forward goes west (+x), no faster than 4 ft/s
  const t0 = Date.now();
  await walkFwd(page, phone, { ms: 700 });
  const secs = (Date.now() - t0) / 1000;
  await settle(page);
  s = await st(page);
  expect(s.x - 48, 'moved forward').toBeGreaterThan(8);
  expect(s.x - 48, 'at most 48 in/s, plus easing out').toBeLessThan(48 * secs + 6);
  expect(Math.abs(s.y - 140)).toBeLessThan(0.5);
  expect(s.camZ, 'no head bob').toBeCloseTo(68, 3);
  if (!phone) {
    // Shift runs: farther in the same time
    await teleport(page, 30, 140, -90);
    await walkFwd(page, phone, { ms: 500 });
    await settle(page);
    const walked = (await st(page)).x - 30;
    await teleport(page, 30, 140, -90);
    await walkFwd(page, phone, { ms: 500, run: true });
    await settle(page);
    expect((await st(page)).x - 30, 'running is faster').toBeGreaterThan(walked + 4);
  }

  // north into the back of the sectional: stops one body radius (9 in) away
  await teleport(page, 100, 140, 180);
  await walkFwd(page, phone, { ms: 1600 });
  await settle(page);
  s = await st(page);
  expect(Math.abs(s.y - (124 + 9)), `stopped at y=${s.y}`).toBeLessThan(1);
  expect(s.clear).toBe(true);

  // east at the open kitchen edge: blocked, with the note
  await teleport(page, 125, 180, 90);
  await walkFwd(page, phone, { ms: 900 });
  await expect(page.getByTestId('walk-note')).toHaveText('Kitchen not modeled');
  await settle(page);
  s = await st(page);
  expect(Math.abs(s.x - (113 + 9)), `stopped at the kitchen edge, x=${s.x}`).toBeLessThan(1);
  await shot(page, `walk-kitchen-edge-${info.project.name}`);

  // the front door is not a way out
  await teleport(page, 48, 140, 90);
  await walkFwd(page, phone, { ms: 1500 });
  await settle(page);
  s = await st(page);
  expect(s.room).toBe('living');
  expect(Math.abs(s.x - 9), `stopped at the front door, x=${s.x}`).toBeLessThan(1);

  // looking around: the mouse on the desktop (click locks the pointer, drag also works), a finger
  // drag on the right side on the phone
  const yaw0 = (await st(page)).yaw;
  const vp = page.viewportSize();
  if (phone) {
    const cdp = await page.context().newCDPSession(page);
    const pt = (x) => [{ x, y: vp.height * 0.35, id: 2, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(vp.width * 0.7) });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(vp.width * 0.7 - k * 10) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(vp.width / 2 + k * 12, vp.height / 2);
    await page.mouse.up();
    await page.keyboard.press('Escape');
  }
  await frames(page);
  expect(Math.abs((await st(page)).yaw - yaw0), 'the view turned').toBeGreaterThan(5);

  // night at eye level
  await page.evaluate(() => window.__app.setMode('night'));
  await page.evaluate(() => window.__app.walk.toStart());
  await page.waitForTimeout(400);
  await shot(page, `walk-living-night-${info.project.name}`);
  expect(errors).toEqual([]);
});

test('eye height: the setting moves the camera and is remembered', async ({ page }) => {
  const { errors } = await openWalk(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const input = page.getByTestId('eye-height');
  await expect(input).toHaveValue('68');
  await input.fill('72');
  await input.press('Tab');
  await page.waitForFunction(() => window.__app.walk.state().eye === 72);
  expect((await st(page)).camZ).toBeCloseTo(72, 3);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await loaded(page);
  const s = await st(page);
  expect(s.eye).toBe(72);
  expect(s.camZ).toBeCloseTo(72, 3);
  expect(errors).toEqual([]);
});

test('doorway: the hallway opening leads to the bedroom door and back, with a fade', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  // west toward the hallway opening
  await teleport(page, 186, 122, -90, 0);
  await expect(page.getByTestId('door-label')).toHaveText('To bedroom');
  await expect(page.getByTestId('door-label')).toBeVisible();
  await page.evaluate(() => { window.__fades = 0; const el = document.querySelector('.walk-fade'); new MutationObserver(() => { if (el.classList.contains('on')) window.__fades++; }).observe(el, { attributes: true }); });
  await walkFwd(page, phone, { pred: () => window.__app.walk.state().transition });
  await page.waitForFunction(() => window.__app.roomId === 'bedroom' && !window.__app.walk.state().transition, null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__fades)).toBe(1);
  let s = await st(page);
  expect(s.room).toBe('bedroom');
  expect(s.yaw, 'facing south, into the bedroom').toBeCloseTo(-90, 3);
  expect(Math.hypot(s.x - 42, s.y - 110), `just inside the bedroom door: ${s.x},${s.y}`).toBeLessThan(8);
  expect(s.clear).toBe(true);
  await loaded(page);
  await page.waitForTimeout(300);
  await shot(page, `walk-bedroom-day-${info.project.name}`);
  // the bedroom switch in the top bar goes to the same start spot
  const start = await page.evaluate(() => { window.__app.walk.toStart(); return window.__app.walk.state(); });
  expect(Math.hypot(start.x - 42, start.y - 110)).toBeLessThan(1);
  expect(start.yaw).toBeCloseTo(-90, 3);
  // and back: north (-x) through the door
  await teleport(page, s.x, s.y, 90, 0);
  await expect(page.getByTestId('door-label')).toHaveText('To living room');
  await walkFwd(page, phone, { pred: () => window.__app.walk.state().transition });
  await page.waitForFunction(() => window.__app.roomId === 'living' && !window.__app.walk.state().transition, null, { timeout: 8000 });
  s = await st(page);
  expect(s.yaw, 'facing east, into the living room').toBeCloseTo(90, 3);
  expect(Math.hypot(s.x - 201, s.y - 122), `just inside the hallway opening: ${s.x},${s.y}`).toBeLessThan(8);
  // bedroom at night
  await page.evaluate(async () => { await window.__app.setRoom('bedroom'); window.__app.setMode('night'); });
  await loaded(page);
  await page.waitForTimeout(400);
  await shot(page, `walk-bedroom-night-${info.project.name}`);
  expect(errors).toEqual([]);
});

test('carrying: pick up, turn, green / yellow / red preview, refused drop, drop, cancel, things on top come along', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  const before = await layoutOf(page);

  // the coffee table, with the decor on it
  await faceItem(page, 'LR-COFFEE#0');
  await expect(page.getByTestId('aim-label')).toContainText(phone ? 'Pick up · Store' : 'E pick up · F store');
  await act(page, phone, 'pick');
  let s = await st(page);
  expect(s.carry.key).toBe('LR-COFFEE#0');
  expect(s.carry.keys).toContain('LR-DECOR#0');
  expect(s.carry.small, 'wider than 30 in: floats ahead as a ghost').toBe(false);
  const rel0 = s.carry.relRot;
  await act(page, phone, 'rotate');
  expect((await st(page)).carry.relRot).toBeCloseTo(((rel0 + 15 + 540) % 360) - 180, 3);
  if (!phone) {
    await page.keyboard.press('Shift+R');
    expect((await st(page)).carry.relRot).toBeCloseTo(rel0, 3);
    // holding R snaps to quarter turns
    await page.keyboard.down('r');
    await page.waitForTimeout(900);
    await page.keyboard.up('r');
    s = await st(page);
    const abs = (((s.yaw + s.carry.relRot) % 90) + 90) % 90;
    expect(Math.min(abs, 90 - abs), 'a multiple of 90°').toBeLessThan(0.01);
  }
  await act(page, phone, 'cancel');
  expect((await st(page)).carry).toBeNull();
  expect(await layoutOf(page), 'cancel puts it back').toBe(before);

  // pick up again and drop it a little to the side: the decor moves with it
  await faceItem(page, 'LR-COFFEE#0');
  const table0 = await poseOf(page, 'LR-COFFEE#0'), decor0 = await poseOf(page, 'LR-DECOR#0');
  await act(page, phone, 'pick');
  await teleport(page, 195, 50, 90);
  await lookAt(page, { x: 135, y: 50, z: 0 });
  await frames(page);
  expect((await st(page)).carry.status).toBe('warn'); // fits, in front of the hallway opening
  await act(page, phone, 'drop');
  expect((await st(page)).carry).toBeNull();
  const table1 = await poseOf(page, 'LR-COFFEE#0'), decor1 = await poseOf(page, 'LR-DECOR#0');
  expect(Math.hypot(table1.x - table0.x, table1.y - table0.y), 'the table moved').toBeGreaterThan(1);
  const turn = ((table1.rot - table0.rot) * Math.PI) / 180;
  const ox = decor0.x - table0.x, oy = decor0.y - table0.y;
  expect(decor1.x - table1.x).toBeCloseTo(ox * Math.cos(turn) - oy * Math.sin(turn), 0);
  expect(decor1.y - table1.y).toBeCloseTo(ox * Math.sin(turn) + oy * Math.cos(turn), 0);
  await act(page, phone, 'undo');
  expect(await layoutOf(page)).toBe(before);

  // the floor lamp (59 in tall) floats ahead as a ghost
  await faceItem(page, 'LR-FLOORLAMP#0');
  await act(page, phone, 'pick');
  expect((await st(page)).carry.small).toBe(false);
  const status = async (want) => { await frames(page); await page.waitForFunction((w) => window.__app.walk.state().carry?.status === w, want); };
  // green: open floor on the rug
  await teleport(page, 190, 35, 90);
  await lookAt(page, { x: 130, y: 35, z: 0 });
  await status('ok');
  await expect(page.getByTestId('carry-label')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('carry-label')).toContainText('Fits here');
  await page.waitForTimeout(250);
  await shot(page, `walk-carry-green-${info.project.name}`);
  // yellow: into the front door swing, with the warning's title
  await teleport(page, 60, 140, 90);
  await lookAt(page, { x: 0, y: 140, z: 0 });
  await status('warn');
  await expect(page.getByTestId('carry-label')).toContainText('Blocks the front door swing');
  await page.waitForTimeout(250);
  await shot(page, `walk-carry-yellow-${info.project.name}`);
  // red: into the sectional, refused with the reason
  await teleport(page, 100, 140, 180);
  await lookAt(page, { x: 100, y: 100, z: 0 });
  await status('bad');
  const reason = (await st(page)).carry.reason;
  expect(reason).toMatch(/sectional/i);
  await expect(page.getByTestId('carry-label')).toContainText(reason);
  await page.waitForTimeout(250);
  await shot(page, `walk-carry-red-${info.project.name}`);
  await act(page, phone, 'drop');
  expect((await st(page)).carry, 'a red drop is refused').not.toBeNull();
  await expect(page.getByTestId('walk-note')).toHaveText(reason);
  // back to green and drop (the desktop drops with a click)
  await teleport(page, 190, 35, 90);
  await lookAt(page, { x: 130, y: 35, z: 0 });
  await status('ok');
  if (phone) await act(page, phone, 'drop');
  else {
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, vp.height / 2);
  }
  expect((await st(page)).carry).toBeNull();
  const lamp = await poseOf(page, 'LR-FLOORLAMP#0');
  expect(Math.abs(lamp.x - 145) < 1.5 && Math.abs(lamp.y - 35) < 0.5, `dropped at ${lamp.x},${lamp.y}`).toBe(true);

  // the nightstand in the bedroom carries its lamp and candle along
  await page.evaluate(() => window.__app.setRoom('bedroom'));
  await loaded(page);
  await faceItem(page, 'BR-NIGHTSTAND#0');
  await act(page, phone, 'pick');
  expect((await st(page)).carry.keys.sort()).toEqual(['BR-BEDLAMP#0', 'BR-DECOR#0', 'BR-NIGHTSTAND#0']);
  await act(page, phone, 'cancel');
  expect(errors).toEqual([]);
});

test('inventory: store, search and filter, place back, Catalog add, swap and remove keep the budget right', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  const designer = expectedTotal({}).total;
  await expectBudget(page, designer);

  // 1) store a pillow: still in the budget
  const pillow0 = await page.evaluate(() => { const it = window.__app.item('LR-PILLOW-ACCENT#0'); return { ...it.pose, z: (it.baseZ ?? 0) + 10 }; });
  await faceItem(page, 'LR-PILLOW-ACCENT#0');
  const spot = await st(page);
  await act(page, phone, 'store');
  await expect(page.getByTestId('inv-count')).toHaveText('1');
  expect(await page.evaluate(() => window.__app.item('LR-PILLOW-ACCENT#0'))).toBeNull();
  await expectBudget(page, designer);

  // the inventory: photo, name, brand, size (ESTIMATED marked), price, new/used, room of origin
  await act(page, phone, 'bag');
  const inv = page.getByTestId('inventory');
  await expect(inv).toBeVisible();
  const card = inv.getByTestId('stored-card');
  await expect(card).toHaveCount(1);
  const pid = await page.evaluate(() => window.__app.layout.slots['LR-PILLOW-ACCENT'].option);
  const p = productById.get(pid);
  await expect(card.locator('.inv-name')).toHaveText(p.name);
  await expect(card.locator('.inv-brand')).toHaveText(p.brand);
  await expect(card.locator('.inv-size')).toContainText('(W × D × H)');
  await expect(card.locator('.inv-price')).toHaveText(money(Math.round(p.price * 100) * (p.qty ?? 1)));
  await expect(card.locator('.badge')).toHaveText(p.condition === 'used' ? 'Used' : 'New');
  await expect(card.locator('.inv-room')).toHaveText('from the living room');
  await expect(card.locator('.inv-photo')).toBeVisible();
  await shot(page, `walk-inventory-${info.project.name}`);
  // search
  await inv.getByTestId('inv-search').fill(p.brand.split(' ')[0]);
  await expect(card).toHaveCount(1);
  await inv.getByTestId('inv-search').fill('zzzz');
  await expect(card).toHaveCount(0);
  await inv.getByTestId('inv-search').fill('');
  // Catalog: filters (room, new/used, price range) and sort
  await inv.locator('[data-tab="catalog"]').click();
  const cat = inv.getByTestId('catalog-card');
  const nAll = await cat.count();
  expect(nAll).toBeGreaterThan(5);
  await inv.locator('[data-filter="room"]').selectOption('bedroom');
  for (const t of await cat.locator('.inv-room').allTextContents()) expect(t).toMatch(/bedroom$/);
  await inv.locator('[data-filter="room"]').selectOption('all');
  await inv.locator('[data-filter="condition"]').selectOption('used');
  const used = await cat.count();
  expect(used).toBeGreaterThan(0);
  expect(used).toBeLessThan(nAll);
  for (const t of await cat.locator('.badge').allTextContents()) expect(t).toBe('Used');
  await inv.locator('[data-filter="condition"]').selectOption('all');
  await inv.locator('[data-filter="min"]').fill('100');
  await inv.locator('[data-filter="max"]').fill('150');
  const inRange = (await cat.getByTestId('add-price').allTextContents()).map((t) => Number(t.replace(/[^0-9.]/g, '')));
  expect(inRange.length).toBeGreaterThan(0);
  for (const v of inRange) expect(v >= 100 && v <= 150, `+$${v} within $100-$150`).toBe(true);
  await inv.locator('[data-filter="min"]').fill('');
  await inv.locator('[data-filter="max"]').fill('');
  await inv.locator('[data-filter="sort"]').selectOption('price');
  const prices = (await cat.getByTestId('add-price').allTextContents()).map((t) => Number(t.replace(/[^0-9.]/g, '')));
  expect(prices).toEqual([...prices].sort((a, b) => a - b));

  // 2) place the pillow back on the sofa
  await inv.locator('[data-tab="stored"]').click();
  await card.getByTestId('place').click();
  await expect(inv).toBeHidden();
  expect((await st(page)).carry.key).toBe('LR-PILLOW-ACCENT#0');
  await teleport(page, spot.x, spot.y, spot.yaw);
  await lookAt(page, pillow0);
  await frames(page);
  await page.waitForFunction(() => ['ok', 'warn'].includes(window.__app.walk.state().carry?.status));
  await act(page, phone, 'drop');
  await expect(page.getByTestId('inv-count')).toHaveText('');
  expect(await page.evaluate(() => window.__app.layout.inventory.length)).toBe(0);
  await expectBudget(page, designer);

  // 3) Catalog: Add & place puts the price (with tax) in the budget; Esc takes it back out
  const addId = 'LR-FLOORLAMP-B';
  const withLamp = totalWith({}, [addId]);
  await act(page, phone, 'bag');
  await inv.locator('[data-tab="catalog"]').click();
  const lampCard = inv.locator(`[data-product="${addId}"]`);
  await expect(lampCard.getByTestId('add-price')).toHaveText(`+${money(withLamp - designer)}`);
  await lampCard.getByTestId('add-place').click();
  await expectBudget(page, withLamp);
  await act(page, phone, 'cancel');
  await expectBudget(page, designer);
  await act(page, phone, 'bag');
  await lampCard.getByTestId('add-place').click();
  await teleport(page, 187, 50, 0);
  await lookAt(page, { x: 100, y: 50, z: 0 });
  await frames(page);
  await page.waitForFunction(() => window.__app.walk.state().carry?.status === 'ok');
  await act(page, phone, 'drop');
  await expectBudget(page, withLamp);
  expect(await page.evaluate(() => window.__app.layout.extras.map((x) => x.product))).toEqual([addId]);

  // 4) store the throw and remove it from the plan (with a confirm): out of the budget, back in the Catalog
  await faceItem(page, 'LR-THROW#0');
  await act(page, phone, 'store');
  await act(page, phone, 'bag');
  await inv.locator('[data-tab="stored"]').click();
  const throwCard = inv.locator('[data-key="LR-THROW#0"]');
  await throwCard.getByTestId('remove').click();
  await expectBudget(page, withLamp); // nothing until confirmed
  await throwCard.getByTestId('remove-confirm').click();
  const noThrow = totalWith({ 'LR-THROW': null }, [addId]);
  await expectBudget(page, noThrow);
  await inv.locator('[data-tab="catalog"]').click();
  const throwId = products.slots.find((s) => s.slot_id === 'LR-THROW').default_option;
  await expect(inv.locator(`[data-product="${throwId}"]`)).toHaveCount(1);

  // 5) swap a stored piece from the inventory: the rug, to option B
  await inv.getByRole('button', { name: 'Close inventory' }).click();
  await expect(inv).toBeHidden();
  await page.evaluate(() => window.__app.storeKey('LR-RUG#0'));
  await act(page, phone, 'bag');
  await inv.locator('[data-tab="stored"]').click();
  const rugCard = inv.locator('[data-key="LR-RUG#0"]');
  await rugCard.getByTestId('swap').click();
  await rugCard.locator('.opt[data-option="LR-RUG-B"]').click();
  await expectBudget(page, totalWith({ 'LR-THROW': null, 'LR-RUG': 'LR-RUG-B' }, [addId]));

  // owned pieces can be stored, never removed
  await page.evaluate(() => window.__app.storeKey('EX-LR-DININGCHAIRS#0'));
  const chair = inv.locator('[data-key="EX-LR-DININGCHAIRS#0"]');
  await expect(chair).toContainText('Already yours');
  await expect(chair.getByTestId('remove')).toHaveCount(0);
  await expectBudget(page, totalWith({ 'LR-THROW': null, 'LR-RUG': 'LR-RUG-B' }, [addId]));
  expect(errors).toEqual([]);
});

test('undo and redo across 20 actions', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  const snaps = await page.evaluate(() => {
    const a = window.__app;
    const out = [JSON.stringify(a.layout)];
    const keys = a.items.filter((i) => !i.hidden && i.key !== 'LR-FLOORLAMP#0' && !i.supportId).map((i) => i.key);
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) a.storeKey(keys[i / 2]);
      else { const p = a.item('LR-FLOORLAMP#0').pose; a.placePieces('living', [{ key: 'LR-FLOORLAMP#0', pose: { ...p, x: 120 + i, y: 40 + i } }], 'Move'); }
      out.push(JSON.stringify(a.layout));
    }
    return out;
  });
  expect(new Set(snaps).size, '21 different layouts').toBe(21);
  for (let k = 19; k >= 0; k--) {
    await act(page, phone, 'undo');
    expect(await layoutOf(page), `undo to step ${k}`).toBe(snaps[k]);
  }
  for (let k = 1; k <= 20; k++) {
    await act(page, phone, 'redo');
    expect(await layoutOf(page), `redo to step ${k}`).toBe(snaps[k]);
  }
  expect(errors).toEqual([]);
});

test('warnings: real numbers, why, how to fix, Show me, dismiss, come back when worse, restore', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  await expect(page.getByTestId('warn-count')).toHaveText('');
  // the floor lamp into the front door swing (and the walkway), the plant in front of the window,
  // the WiFi cabinet against the coffee table
  await page.evaluate(() => {
    const a = window.__app;
    const at = (k, x, y) => ({ key: k, pose: { ...a.item(k).pose, x, y, rot: 0 } });
    a.placePieces('living', [at('LR-FLOORLAMP#0', 24, 140), at('LR-PLANT#0', 12, 60), at('LR-WIFI#0', 130, 50)], 'Move');
  });
  const ex = await page.evaluate(() => window.__app.explained().active.map((e) => ({ sig: e.sig, kind: e.kind, title: e.title, what: e.what, why: e.why, fix: e.fix, amount: e.amount, key: e.key })));
  expect(new Set(ex.map((e) => e.kind))).toEqual(new Set(['door', 'walkway', 'window', 'overlap']));
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length));
  // the on-screen stack: never over the center dot
  const stack = page.getByTestId('warn-stack');
  await expect(stack).toBeVisible();
  const box = await stack.boundingBox(), vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  expect(cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height, 'the stack leaves the center dot clear').toBe(false);
  // every card: title, what (with a number in inches), why (one sentence per type), fix
  await page.getByRole('button', { name: 'Fit warnings' }).click();
  const cards = page.locator('.modal').getByTestId('warning-card');
  await expect(cards).toHaveCount(ex.length);
  const whyByKind = {};
  for (const e of ex) {
    const c = page.locator(`.modal [data-testid="warning-card"]${sigSel(e.sig)}`);
    await expect(c.locator('.w-title')).toHaveText(e.title);
    await expect(c.locator('.w-what')).toHaveText(e.what);
    expect(e.what).toMatch(/\d+(\.\d+)? in/);
    await expect(c.locator('.w-why')).toContainText(e.why);
    await expect(c.locator('.w-fix')).toContainText(e.fix);
    expect(e.why).toMatch(/^[^.]+\.$/);
    if (e.kind !== 'walkway') { if (whyByKind[e.kind]) expect(e.why).toBe(whyByKind[e.kind]); whyByKind[e.kind] = e.why; }
  }
  expect(new Set(Object.values(whyByKind)).size, 'a different sentence per type').toBe(Object.keys(whyByKind).length);
  const door = ex.find((e) => e.kind === 'door');
  expect(door.title).toBe('Blocks the front door swing');
  expect(door.what).toBe('The LAUTERS floor lamp sits 24 in inside the area the front door needs to open (36 in swing).');
  await shot(page, `walk-warnings-${info.project.name}`);

  // Show me (Walk): look at the marked area
  await page.locator(`.modal ${sigSel(door.sig)}`).getByTestId('show-me').click();
  await expect(page.locator('.modal')).toBeHidden();
  expect(await page.evaluate(() => window.__app.room.highlight.children.length)).toBeGreaterThan(0);
  const s = await st(page);
  const zone = await page.evaluate(() => { const a = window.__app; const e = a.explained().active.find((x) => x.kind === 'door'); return e.highlight.zone; });
  const zc = { x: (zone.x0 + zone.x1) / 2, y: (zone.y0 + zone.y1) / 2 };
  const want = (Math.atan2(-(zc.x - s.x), zc.y - s.y) * 180) / Math.PI;
  expect(Math.abs(((s.yaw - want + 540) % 360) - 180)).toBeLessThan(1);
  await page.waitForTimeout(300);
  await shot(page, `walk-warning-card-${info.project.name}`);

  // dismiss the door warning: gone from the count and the stack, listed under Dismissed (1)
  await page.getByRole('button', { name: 'Fit warnings' }).click();
  await page.locator(`.modal ${sigSel(door.sig)}`).getByTestId('dismiss-warning').click();
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length - 1));
  await expect(page.locator('.modal summary')).toHaveText('Dismissed (1)');
  await expect(page.locator(`.modal .dismissed-list ${sigSel(door.sig)}`)).toHaveCount(1);
  // saved with the layout
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await loaded(page);
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length - 1));
  // 1 in deeper: stays dismissed; 3 in deeper (more than 2 in worse): comes back
  const nudge = (dx) => page.evaluate((dx) => { const a = window.__app; const p = a.item('LR-FLOORLAMP#0').pose; a.placePieces('living', [{ key: 'LR-FLOORLAMP#0', pose: { ...p, x: p.x + dx } }], 'Move'); }, dx);
  await nudge(-1);
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length - 1));
  await nudge(-2);
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length));
  // dismiss again and restore it from the list
  await page.getByRole('button', { name: 'Fit warnings' }).click();
  await page.locator(`.modal ${sigSel(door.sig)}`).first().getByTestId('dismiss-warning').click();
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length - 1));
  await page.locator(`.modal .dismissed-list ${sigSel(door.sig)}`).getByTestId('restore-warning').click();
  await expect(page.getByTestId('warn-count')).toHaveText(String(ex.length));
  await expect(page.locator('.modal summary')).toHaveText('Dismissed (0)');

  // Show me in Overview: the floor plan, with the piece selected
  await page.locator('.modal-head .icon-btn').click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Fit warnings' }).click();
  await page.locator(`.modal ${sigSel(door.sig)}`).getByTestId('show-me').click();
  await page.waitForFunction(() => !window.__app.tween);
  // the floor plan: the camera looks straight down, the piece is selected
  expect(await page.evaluate(() => -window.__app.camera.matrixWorld.elements[9])).toBeLessThan(-0.95);
  expect(await page.evaluate(() => window.__app.selected)).toBe('LR-FLOORLAMP#0');
  await shot(page, `overview-show-me-${info.project.name}`);
  expect(await page.evaluate(() => window.__app.room.highlight.children.length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('goals and score: 85 for the designer layout, best, how it works, a goal completes', async ({ page }, info) => {
  const phone = isPhone(info);
  const { errors } = await openWalk(page);
  const panel = page.getByTestId('goals-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('score')).toHaveText('85');
  await expect(panel.getByTestId('best-score')).toHaveText('85');
  if (phone) await panel.locator('.goals-head').click(); // collapsed on the phone
  await expect(panel.locator('li[data-goal]')).toHaveCount(8);
  await expect(panel.locator('li[data-goal="budget"]')).not.toHaveClass(/done/);
  await expect(panel.locator('li[data-goal="budget"]')).toContainText(`${money(expectedTotal({}).total)} of $1,000.00`);
  await shot(page, `walk-goals-${info.project.name}`);
  await panel.getByTestId('how-score').click();
  const rows = page.locator('.modal .how-table tr');
  await expect(rows).toHaveCount(10); // head, 8 goals, total
  await expect(page.locator('.modal .how-table tr.sum')).toContainText('100');
  await page.locator('.modal-head .icon-btn').click();
  // the bedroom also starts at 85
  await page.evaluate(() => window.__app.setRoom('bedroom'));
  await loaded(page);
  await expect(panel.getByTestId('score')).toHaveText('85');
  await page.evaluate(() => window.__app.setRoom('living'));
  await loaded(page);

  // take the throw out of the plan: back under the budget cap -> "On budget" completes (and the
  // throw's slot is now empty: 100 - 5)
  await page.evaluate(() => { window.__app.storeKey('LR-THROW#0'); window.__app.removeFromPlan('LR-THROW#0'); });
  await expect(page.locator('.toast').filter({ hasText: 'Goal complete: On budget' })).toBeVisible();
  await expect(panel.getByTestId('score')).toHaveText('95');
  await expect(panel.getByTestId('best-score')).toHaveText('95');
  expect(await page.locator('.sparkles *').count()).toBeGreaterThan(0);
  // undo: the score drops, the best stays
  await act(page, phone, 'undo');
  await act(page, phone, 'undo');
  await expect(panel.getByTestId('score')).toHaveText('85');
  await expect(panel.getByTestId('best-score')).toHaveText('95');
  // store a lamp (two goals drop), place it back: "Lamps in place" and "Everything placed" complete
  await page.evaluate(() => window.__app.storeKey('LR-FLOORLAMP#0'));
  await expect(panel.getByTestId('score')).not.toHaveText('85');
  await act(page, phone, 'undo');
  await expect(page.locator('.toast').filter({ hasText: 'Lamps in place' })).toBeVisible();
  await expect(panel.getByTestId('score')).toHaveText('85');
  expect(errors).toEqual([]);
});

test('saving: stored pieces, Catalog additions and dismissed warnings survive reload, export, import, compare and reset; old files load', async ({ page }, info) => {
  const { errors } = await openWalk(page);
  await page.evaluate(() => {
    const a = window.__app;
    a.storeKey('LR-PILLOW-ACCENT#0');
    const p = a.item('LR-PLANT#0').pose;
    a.placePieces('living', [{ key: 'LR-PLANT#0', pose: { ...p, x: 12, y: 60, rot: 0 } }], 'Move');
    a.dismissWarning(a.explained().active.find((e) => e.kind === 'window').sig);
  });
  // a Catalog addition, placed
  await page.evaluate(() => window.__app.addFromCatalog('LR-FLOORLAMP-B'));
  await teleport(page, 187, 50, 0);
  await lookAt(page, { x: 100, y: 50, z: 0 });
  await frames(page);
  await page.waitForFunction(() => window.__app.walk.state().carry?.status === 'ok');
  await page.evaluate(() => window.__app.walk.drop());
  const mine = JSON.parse(await layoutOf(page));
  expect(mine.inventory).toHaveLength(1);
  expect(mine.extras).toHaveLength(1);
  expect(mine.dismissed).toHaveLength(1);
  const total = await page.evaluate(() => window.__app.budget.totalCents);

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await loaded(page);
  expect(JSON.parse(await layoutOf(page))).toEqual(mine);
  await expectBudget(page, total);

  // save, export
  await page.getByRole('button', { name: 'Saved layouts' }).click();
  await page.getByTestId('layout-name').fill('Walked');
  await page.getByTestId('save-layout').click();
  await expect(page.locator('.saved-row[data-layout="Walked"]')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-current').click()]);
  const file = info.outputPath('walked.json');
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data.version).toBe(2);
  expect(data.layouts[0].layout.inventory).toEqual(mine.inventory);
  expect(data.layouts[0].layout.extras).toEqual(mine.extras);
  expect(data.layouts[0].layout.dismissed).toEqual(mine.dismissed);

  // reset to the designer's layout: nothing stored, nothing added, nothing dismissed
  await page.getByTestId('reset-designer').click();
  await page.getByTestId('reset-confirm').click();
  await loaded(page);
  const reset = JSON.parse(await layoutOf(page));
  expect([reset.inventory.length, reset.extras.length, reset.dismissed.length]).toEqual([0, 0, 0]);
  await expectBudget(page, expectedTotal({}).total);

  // compare the saved one with the current: the stored pillow and the added lamp show up
  await page.getByRole('button', { name: 'Saved layouts' }).click();
  await page.getByTestId('cmp-a').selectOption({ label: 'Current view' });
  await page.getByTestId('cmp-b').selectOption({ label: 'Walked' });
  await page.getByTestId('compare').click();
  const cmp = page.getByTestId('compare-out');
  await expect(cmp).toContainText('1 stored');
  await expect(cmp).toContainText('added from the Catalog');
  await expect(cmp.locator('tr.sum')).toContainText(money(total));

  // import the exported file back and load it
  const row = page.locator('.saved-row[data-layout="Walked"]');
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.locator('.confirm').getByRole('button', { name: 'Delete' }).click();
  await page.getByTestId('import-file').setInputFiles(file);
  await page.locator('.saved-row[data-layout="Walked"]').getByTestId('load-layout').click();
  await loaded(page);
  expect(JSON.parse(await layoutOf(page))).toEqual(mine);

  // an old (version 1) file: no inventory, extras or dismissed, poses without room/wall/stored
  const v1 = structuredClone(reset);
  delete v1.inventory; delete v1.extras; delete v1.dismissed; delete v1.schema;
  v1.slots['LR-FLOORLAMP'].poses[0] = { ...v1.slots['LR-FLOORLAMP'].poses[0], x: 40, y: 14 };
  const old = info.outputPath('old.json');
  fs.writeFileSync(old, JSON.stringify({ app: 'room-viewer-layouts', version: 1, exported: '2026-01-01T00:00:00.000Z', layouts: [{ name: 'Old file', layout: v1 }] }));
  await page.getByRole('button', { name: 'Saved layouts' }).click();
  await page.getByTestId('import-file').setInputFiles(old);
  await page.locator('.saved-row[data-layout="Old file"]').getByTestId('load-layout').click();
  await loaded(page);
  const loadedOld = JSON.parse(await layoutOf(page));
  expect(loadedOld.slots['LR-FLOORLAMP'].poses[0]).toMatchObject({ x: 40, y: 14 });
  expect([loadedOld.inventory, loadedOld.extras, loadedOld.dismissed]).toEqual([[], [], []]);
  await expectBudget(page, expectedTotal({}).total);
  expect(errors).toEqual([]);
});

test('tutorial: first visit, the five steps on a copy, the real layout unchanged; skip and replay', async ({ page }, info) => {
  const phone = isPhone(info);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90_000 });
  await loaded(page);
  const tut = page.getByTestId('tutorial');
  await expect(tut).toBeVisible();
  expect(await page.evaluate(() => window.__app.viewMode)).toBe('walk');
  const real = await page.evaluate(() => JSON.stringify(window.__app.saved.layout));
  const step = (id) => expect(tut.locator('.tut-text')).toHaveAttribute('data-step', id);
  await step('walk');
  await shot(page, `walk-tutorial-${info.project.name}`);
  // 1 walk to the coffee table
  await faceItem(page, 'LR-COFFEE#0');
  const s = await st(page);
  const t = await poseOf(page, 'LR-COFFEE#0');
  if (Math.hypot(s.x - t.x, s.y - t.y) >= 54) await walkFwd(page, phone, { pred: () => { const a = window.__app; const p = a.item('LR-COFFEE#0').pose; const w = a.walk.state(); return Math.hypot(w.x - p.x, w.y - p.y) < 54; } });
  await step('pick');
  // 2 pick it up, 3 drop it
  await faceItem(page, 'LR-COFFEE#0');
  await act(page, phone, 'pick');
  await step('drop');
  await teleport(page, 195, 50, 90);
  await lookAt(page, { x: 135, y: 50, z: 0 });
  await frames(page);
  await page.waitForFunction(() => ['ok', 'warn'].includes(window.__app.walk.state().carry?.status));
  await act(page, phone, 'drop');
  await step('store');
  // 4 store a pillow
  const pillow = await page.evaluate(() => { const it = window.__app.item('LR-PILLOW-NEUTRAL#0'); return { ...it.pose, z: (it.baseZ ?? 0) + 10 }; });
  await faceItem(page, 'LR-PILLOW-NEUTRAL#0');
  const spot = await st(page);
  await act(page, phone, 'store');
  await step('place');
  // 5 open the inventory and place it back
  await act(page, phone, 'bag');
  await page.getByTestId('inventory').locator('[data-key="LR-PILLOW-NEUTRAL#0"]').getByTestId('place').click();
  await teleport(page, spot.x, spot.y, spot.yaw);
  await lookAt(page, pillow);
  await frames(page);
  await page.waitForFunction(() => ['ok', 'warn'].includes(window.__app.walk.state().carry?.status));
  await act(page, phone, 'drop');
  await expect(tut).toBeHidden();
  await expect(page.locator('.toast').filter({ hasText: 'Tutorial done' })).toBeVisible();
  expect(await layoutOf(page), 'the real layout is unchanged').toBe(real);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomviewer.settings.v1')).tutorialDone)).toBe(true);

  // a later visit: no tutorial; replay from Settings, then skip
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await loaded(page);
  await expect(tut).toBeHidden();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('replay-tutorial').click();
  await expect(tut).toBeVisible();
  await faceItem(page, 'LR-COFFEE#0');
  await act(page, phone, 'store');
  await page.getByTestId('tutorial-skip').click();
  await expect(tut).toBeHidden();
  expect(await layoutOf(page), 'skipping also leaves the real layout as it was').toBe(real);
  expect(errors).toEqual([]);
});

test('Overview is unchanged, and switching keeps the same layout', async ({ page }) => {
  const { errors } = await openWalk(page);
  await page.evaluate(() => window.__app.storeKey('LR-PLANT#0'));
  const lay = await layoutOf(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  expect(await page.evaluate(() => [window.__app.viewMode, window.__app.controls.enabled])).toEqual(['overview', true]);
  await expect(page.getByRole('button', { name: 'Camera views' })).toBeVisible();
  await expect(page.getByTestId('crosshair')).toBeHidden();
  await expect(page.getByTestId('goals-panel')).toBeHidden();
  expect(await layoutOf(page)).toBe(lay);
  expect(await page.evaluate(() => window.__app.item('LR-PLANT#0'))).toBeNull();
  // the items list marks the stored plant; clicking it opens the inventory
  await page.getByRole('button', { name: 'Items list' }).click();
  await expect(page.locator('[data-slot="LR-PLANT"]')).toContainText('(stored)');
  await page.locator('[data-slot="LR-PLANT"]').click();
  await expect(page.getByTestId('inventory')).toBeVisible();
  await page.getByRole('button', { name: 'Close inventory' }).click();
  // Overview selection and editing still work as before
  await page.evaluate(() => window.__app.select('LR-FLOORLAMP#0'));
  await expect(page.getByTestId('item-card')).toBeVisible();
  await page.evaluate(() => window.__app.select(null));
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  expect(await page.evaluate(() => window.__app.viewMode)).toBe('walk');
  await expect(page.getByTestId('crosshair')).toBeVisible();
  expect(await layoutOf(page)).toBe(lay);
  expect(errors).toEqual([]);
});

test('phone in landscape: controls fit and the joystick walks', async ({ page }, info) => {
  test.skip(!isPhone(info), 'phone only');
  const { errors } = await openWalk(page);
  await page.setViewportSize({ width: 892, height: 412 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize();
  for (const sel of ['[data-testid="joystick"]', '.wbtn[data-act="primary"]', '.wbtn[data-act="store"]', '.wbtn[data-act="bag"]', '.wbtn[data-act="undo"]']) {
    const b = await page.locator(sel).boundingBox();
    expect(b, sel).toBeTruthy();
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${sel} on screen`).toBe(true);
  }
  // nothing clickable over the center dot
  const top = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el.tagName + '.' + el.className; }, [vp.width / 2, vp.height / 2]);
  expect(top).toMatch(/^CANVAS/);
  const s0 = await st(page);
  await walkFwd(page, true, { ms: 600 });
  await settle(page);
  expect((await st(page)).x - s0.x).toBeGreaterThan(8);
  await shot(page, 'walk-phone-landscape');
  expect(errors).toEqual([]);
});
