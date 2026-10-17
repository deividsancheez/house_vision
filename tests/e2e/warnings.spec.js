// Fit warnings: dragging a piece into a door swing or a walkway (room-spec fit_checks) shows a
// warning, but the move is still allowed. Done with real pointer input from the floor-plan view:
// the mouse on desktop, one finger on the phone.
import { test, expect } from '@playwright/test';
import { openApp, setRoom, clickSelect, dragTo, shot, spec } from './helpers.js';

const zone = (room, label) => spec.fit_checks.checks.find((c) => c.room === room && c.check === label).zone;
const center = (z) => ({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2, z: 0 });

const CASES = [
  { room: 'living', key: 'LR-FLOORLAMP#0', check: 'front door swing', expectText: 'front door swing' },
  { room: 'living', key: 'LR-PLANT#0', check: 'walkway: west of sectional to hallway (58")', expectText: 'walkway' },
  { room: 'living', key: 'LR-FLOORLAMP#0', check: 'walkway: behind short leg along window (32" clear of curtains)', expectText: 'walkway' },
  { room: 'bedroom', key: 'BR-CHAIR#0', check: 'walkway: door to closet/desk, between bed and mirror (50")', expectText: 'walkway' },
  { room: 'bedroom', key: 'EX-BR-MIRROR#0', check: 'bedroom door swing', expectText: 'bedroom door swing' },
];

for (const c of CASES) {
  test(`${c.room}: ${c.key} dragged into "${c.check}" warns but is allowed`, async ({ page }, info) => {
    const touch = info.project.name === 'phone';
    const { errors } = await openApp(page, `room=${c.room}`);
    await setRoom(page, c.room);
    expect(await page.evaluate(() => window.__app.warnings.length), 'the designer layout has no warnings').toBe(0);
    await page.evaluate(() => window.__app.applyPreset('top', false));
    await page.waitForTimeout(300);
    const sel = await clickSelect(page, c.key, { touch });
    expect(sel).toBe(c.key);
    await page.evaluate(() => window.__app.applyPreset('top', false));
    await page.waitForTimeout(300);
    const z = zone(c.room, c.check);
    const target = c.target ? { ...c.target, z: 0 } : center(z);
    // drag in two legs (around the furniture in between), as a person would
    await dragTo(page, c.key, target, { touch });
    let w = await page.evaluate((k) => window.__app.warnings.filter((x) => x.key === k && x.type === 'zone').map((x) => x.message), c.key);
    if (!w.some((m) => m.includes(c.expectText))) {
      await dragTo(page, c.key, target, { touch });
      w = await page.evaluate((k) => window.__app.warnings.filter((x) => x.key === k && x.type === 'zone').map((x) => x.message), c.key);
    }
    expect(w.join(' | '), 'zone warning for the dragged piece').toContain(c.expectText);
    const banner = page.locator('.banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(c.expectText);
    // allowed: the piece stays where it was dropped, inside the zone
    const pose = await page.evaluate((k) => window.__app.item(k).pose, c.key);
    expect(pose.x > z.x0 - 30 && pose.x < z.x1 + 30 && pose.y > z.y0 - 30 && pose.y < z.y1 + 30).toBeTruthy();
    await shot(page, `warning-${info.project.name}-${c.key.replace('#', '_')}`);
    // and the warning clears once it is put back
    await page.getByRole('button', { name: 'Reset spot' }).click();
    expect(await page.evaluate((k) => window.__app.warnings.filter((x) => x.key === k).length, c.key)).toBe(0);
    expect(errors).toEqual([]);
  });
}
