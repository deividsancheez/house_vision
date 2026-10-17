// One camera preset per photo: each places the camera where the photo was taken, with its lens.
// Screenshots go to test-results/shots; tools/compare.mjs puts them next to the photos (the photos
// stay on this computer and are never part of the app).
import { test, expect } from '@playwright/test';
import { openApp, shot } from './helpers.js';
import { PRESETS } from '../../src/scene/views.js';

for (const pr of PRESETS) {
  test(`preset ${pr.id}`, async ({ page }, info) => {
    const phone = info.project.name === 'phone';
    test.skip(phone && !['living-05-window-wall-facing-east', 'bedroom-01-closet-wall-facing-east'].includes(pr.id), 'phone checks two presets');
    const { errors } = await openApp(page, `room=${pr.room}`);
    // pick it from the Views menu
    await page.getByRole('button', { name: 'Camera views' }).click();
    await page.locator(`.menu [data-view="${pr.id}"]`).click();
    await page.waitForFunction(() => !window.__app.tween); // the camera glides there
    await page.waitForTimeout(300);
    const c = await page.evaluate(() => { const a = window.__app; const p = a.camera.position; return { p: [p.x, p.y, p.z], fov: a.camera.fov, aspect: a.camera.aspect }; });
    const k = 0.0254;
    expect(c.p[0]).toBeCloseTo(pr.pos.x * k, 2);
    expect(c.p[1]).toBeCloseTo(pr.pos.z * k, 2);
    expect(c.p[2]).toBeCloseTo(-pr.pos.y * k, 2);
    if (c.aspect >= 4 / 3) expect(c.fov).toBeCloseTo(pr.vfov, 3);
    else expect(c.fov).toBeGreaterThanOrEqual(pr.vfov); // portrait phones widen the view to keep the photo's width
    if (phone) await page.locator('.menu').evaluate((m) => { m.hidden = true; });
    else await page.locator('.menu .close').click();
    await shot(page, `${info.project.name}-preset-${pr.id}`);
    expect(errors).toEqual([]);
  });
}
