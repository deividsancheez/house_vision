// Day / night in both rooms. Day: sun through the east living-room window (morning) and the west
// bedroom window (afternoon), sky light at the windows, lamps off, curtains open.
// Night: every lamp in room-spec "lighting" on at its color temperature and lumens, window light off,
// curtains closed.
import { test, expect } from '@playwright/test';
import { openApp, setRoom, shot, spec } from './helpers.js';

/** Wait until the curtains have finished sliding. */
const settled = (page) => page.waitForFunction(() => { const r = window.__app.room; return r.curtainT === r.curtainTarget; });

const state = (page) => page.evaluate(() => {
  const a = window.__app, L = a.room.lighting;
  const toRoom = (v) => [v.x, -v.z, v.y]; // world (x, y-up, z) -> room (x, y, z-up)
  const d = L.sun.target.position.clone().sub(L.sun.position).normalize();
  return {
    mode: a.mode,
    curtainsClosed: a.curtainsClosed,
    curtainT: a.room.curtainT,
    sun: L.sun.visible,
    sunDir: toRoom(d),
    windows: L.windowLights.map((w) => w.visible),
    lamps: L.lamps.map((l) => ({ id: l.userData.spec.id, on: l.visible, power: l.power, rgb: [l.color.r, l.color.g, l.color.b] })),
  };
});

for (const room of ['living', 'bedroom']) {
  test(`${room}: day and night`, async ({ page }, info) => {
    const { errors } = await openApp(page, `room=${room}`);
    await setRoom(page, room);
    const lights = spec.lighting[room].filter((l) => l.position);
    const daylight = spec.rooms.find((r) => r.id === room).daylight;
    const vec = daylight.sun_vector_morning || daylight.sun_vector_afternoon;
    expect(room === 'living' ? !!daylight.sun_vector_morning : !!daylight.sun_vector_afternoon, 'morning sun in the living room, afternoon in the bedroom').toBe(true);

    // --- day
    let s = await state(page);
    expect(s.mode).toBe('day');
    expect(s.sun).toBe(true);
    expect(s.windows.length).toBeGreaterThan(0);
    expect(s.windows.every(Boolean)).toBe(true);
    expect(s.curtainsClosed).toBe(false);
    for (const l of s.lamps) expect(l.on, `${l.id} is off by day`).toBe(false);
    const n = Math.hypot(vec.x, vec.y, vec.z);
    expect(s.sunDir[0]).toBeCloseTo(vec.x / n, 3);
    expect(s.sunDir[1]).toBeCloseTo(vec.y / n, 3);
    expect(s.sunDir[2]).toBeCloseTo(vec.z / n, 3);
    await page.evaluate(() => window.__app.applyPreset('overview', false));
    await page.waitForTimeout(400);
    await shot(page, `${info.project.name}-${room}-day`);

    // --- night (from the top-bar button)
    await page.getByRole('button', { name: 'Day or night' }).click();
    await settled(page); // curtains slide closed
    s = await state(page);
    expect(s.mode).toBe('night');
    expect(s.sun).toBe(false);
    expect(s.windows.every((v) => !v)).toBe(true);
    expect(s.curtainsClosed).toBe(true);
    expect(s.curtainT).toBeCloseTo(1, 2);
    await expect(page.getByRole('button', { name: 'Open or close curtains' })).toContainText('Curtains closed');
    for (const l of lights) {
      const got = s.lamps.find((x) => x.id === l.id);
      const want = !/^off/i.test(l.night_mode || 'on');
      expect(got?.on, `${l.id} (${l.night_mode}) at night`).toBe(want);
      if (want) {
        expect(got.power, `${l.id} lumens`).toBe(l.lumens);
        expect(got.rgb[0] >= got.rgb[2], `${l.id} is warm (${l.color_temp_k}K)`).toBe(true);
      }
    }
    await shot(page, `${info.project.name}-${room}-night`);
    await page.getByRole('button', { name: 'Day or night' }).click();
    await settled(page);
    s = await state(page);
    expect(s.mode).toBe('day');
    expect(s.curtainT).toBeCloseTo(0, 2);
    expect(errors).toEqual([]);
  });
}

test('curtains toggle open/closed at 91.5" and closet doors toggle', async ({ page }) => {
  const { errors } = await openApp(page);
  for (const key of ['LR-CURTAIN#0', 'LR-CURTAIN#1']) {
    const size = await page.evaluate((k) => window.__app.modelSize(k), key);
    expect(size.h).toBeCloseTo(91.5, 0);
  }
  const w = (k) => page.evaluate((key) => window.__app.modelSize(key).w, k);
  const open = await w('LR-CURTAIN#0');
  await page.getByRole('button', { name: 'Open or close curtains' }).click();
  await settled(page);
  const closed = await w('LR-CURTAIN#0');
  expect(closed).toBeGreaterThan(open * 1.5);
  await setRoom(page, 'bedroom');
  await expect(page.getByRole('button', { name: 'Closet doors' })).toBeVisible();
  await page.getByRole('button', { name: 'Closet doors' }).click();
  expect(await page.evaluate(() => window.__app.room.rb.closetDoors.visible)).toBe(false);
  await page.getByRole('button', { name: 'Closet doors' }).click();
  expect(await page.evaluate(() => window.__app.room.rb.closetDoors.visible)).toBe(true);
  expect(errors).toEqual([]);
});
