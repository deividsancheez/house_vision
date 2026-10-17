// Dev helper: frame-time breakdown at phone size with the CPU slowed 4x. node tools/profile.mjs [room] [port]
import { chromium } from '@playwright/test';
const [room = 'living', port = '5199', setup = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:${port}/?room=${room}`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
const cdp = await ctx.newCDPSession(p);
if (setup) await p.evaluate(setup);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const r = await p.evaluate(async () => {
  const a = window.__app;
  a.applyPreset('overview', false);
  await a.measureFps(2000);
  const orig = a.renderer.render.bind(a.renderer);
  let rt = 0, n = 0;
  a.renderer.render = (s, c) => { const t = performance.now(); orig(s, c); rt += performance.now() - t; n++; };
  const fps = await a.measureFps(4000);
  a.renderer.render = orig;
  const i = a.renderer.info;
  return { fps, renderMs: rt / n, frames: n, calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, pr: a.renderer.getPixelRatio(), size: [a.canvas.width, a.canvas.height] };
});
console.log(JSON.stringify(r));
await b.close();
