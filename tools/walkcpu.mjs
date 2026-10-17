// Dev helper: CPU profile of Walk mode while the camera turns; prints the top functions by self time.
// node tools/walkcpu.mjs [room] [day|night] [rate]   (needs npx vite --port 5199)
import { chromium } from '@playwright/test';
const [room = 'living', look = 'day', rate = '1'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:5199/?room=${room}&mode=walk`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
if (look === 'night') await p.evaluate(() => window.__app.setMode('night'));
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(rate) });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const fps = await p.evaluate(() => window.__app.measureWalkFps(3000));
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000);
});
console.log('fps', fps.toFixed(1));
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
await b.close();
