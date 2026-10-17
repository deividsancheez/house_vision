// Run alone (npm run test:perf, one worker): other browsers running at the same time would share the CPU.
// Frame rate while the camera orbits (render-on-demand pauses when nothing moves, so this measures the
// worst case). Phone: 412x892 at 2x pixels with the CPU slowed 4x through DevTools. On this laptop
// (Ryzen 5 5500U) that is slower than a current mid-range phone CPU, so it is a conservative check;
// the GPU cannot be throttled this way (see the report).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openApp, setRoom, root } from './helpers.js';

// recording a trace takes snapshots during the run and would cost frames
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

for (const room of ['living', 'bedroom']) {
  test(`frame rate: ${room} @perf`, async ({ page }, info) => {
    const phone = info.project.name === 'phone';
    const { errors } = await openApp(page, `room=${room}`);
    await setRoom(page, room);
    let cdp = null;
    if (phone) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.evaluate(() => window.__app.applyPreset('overview', false));
    await page.evaluate(() => window.__app.measureFps(1500)); // warm-up (lets adaptive resolution settle)
    // median of five 3-second runs: this laptop's speed varies a lot from run to run (background load)
    const samples = { day: [], night: [] };
    const median = async (k) => { for (let i = 0; i < 5; i++) samples[k].push(Math.round((await page.evaluate(() => window.__app.measureFps(3000))) * 10) / 10); return [...samples[k]].sort((x, y) => x - y)[2]; };
    const fps = await median('day');
    const pr = await page.evaluate(() => window.__app.renderer.getPixelRatio());
    await page.evaluate(() => window.__app.setMode('night'));
    await page.evaluate(() => window.__app.measureFps(1500)); // warm-up: the new lights compile new shaders once
    const fpsNight = await median('night');
    if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const out = path.join(root, 'test-results', 'perf');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${info.project.name}-${room}.json`), JSON.stringify({ room, project: info.project.name, cpuThrottle: phone ? 4 : 1, fps: Math.round(fps * 10) / 10, fpsNight: Math.round(fpsNight * 10) / 10, samples, pixelRatio: pr }, null, 2));
    test.info().annotations.push({ type: 'fps', description: `${room}: ${fps.toFixed(1)} fps day, ${fpsNight.toFixed(1)} night, pixel ratio ${pr}` });
    expect(fps).toBeGreaterThanOrEqual(30);
    expect(fpsNight).toBeGreaterThanOrEqual(30);
    expect(errors).toEqual([]);
  });
}
