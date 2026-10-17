// Dev helper: Walk-mode frame-time breakdown at phone size with the CPU slowed 4x.
// node tools/walkprof.mjs [room] [day|night] [port]   (needs npx vite --port 5199)
import { chromium } from '@playwright/test';
const [room = 'living', look = 'day', tweak = '', rate = '4', port = '5199'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:${port}/?room=${room}&mode=walk`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
if (look === 'night') await p.evaluate(() => window.__app.setMode('night'));
const cdp = await ctx.newCDPSession(p);
if (tweak) await p.evaluate(tweak);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(rate) });
const r = await p.evaluate(async () => {
  const a = window.__app;
  await a.measureWalkFps(2000);
  const wrap = (obj, name, acc) => { const o = obj[name].bind(obj); obj[name] = (...args) => { const t = performance.now(); const v = o(...args); acc[name] = (acc[name] || 0) + performance.now() - t; return v; }; return () => { obj[name] = o; }; };
  const acc = {};
  const origR = a.renderer.render.bind(a.renderer);
  let shadowUpdates = 0, mainCalls = 0, mainTris = 0;
  a.renderer.render = (sc, cam) => {
    const t = performance.now();
    if (a.renderer.shadowMap.needsUpdate && sc === a.scene) shadowUpdates++;
    origR(sc, cam);
    const k = sc === a.scene ? 'main' : 'hands';
    acc[k] = (acc[k] || 0) + performance.now() - t;
    if (sc === a.scene) { mainCalls = a.renderer.info.render.calls; mainTris = a.renderer.info.render.triangles; }
  };
  const undo = [() => { a.renderer.render = origR; }, wrap(a.walk, 'update', acc), wrap(a.walk, 'updateAim', acc), wrap(a.ui.walkHud, 'update', acc), wrap(a.walk.hands, 'update', acc)];
  const f0 = a.frameCount;
  const calls = [];
  const fps = await a.measureWalkFps(4000);
  const n = a.frameCount - f0;
  undo.forEach((u) => u());
  const i = a.renderer.info;
  const per = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round((v / n) * 100) / 100]));
  return { fps: Math.round(fps * 10) / 10, perFrameMs: per, shadowUpdates, mainCalls, mainTris, frames: n, calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, pr: a.renderer.getPixelRatio(), size: [a.canvas.width, a.canvas.height] };
});
console.log(JSON.stringify(r));
await b.close();
