// Dev helper: GPU+CPU cost of each piece in a fixed Walk-mode view (render + gl.finish, with and
// without the piece). node tools/walkcost.mjs [room] [x y yaw pitch] (needs npx vite --port 5199)
import { chromium } from '@playwright/test';
const [room = 'living', x = '48', y = '140', yaw = '-90', pitch = '-8'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:5199/?room=${room}&mode=walk`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
const r = await p.evaluate(([x, y, yaw, pitch]) => {
  const a = window.__app;
  a.walk.teleport(x, y, yaw, pitch);
  a.room.updateCutaway(a.camera);
  const gl = a.renderer.getContext(); const px = new Uint8Array(4); const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const time = (n = 12) => {
    a.renderer.render(a.scene, a.camera); sync();
    const t = performance.now();
    for (let i = 0; i < n; i++) { a.renderer.render(a.scene, a.camera); }
    sync();
    return (performance.now() - t) / n;
  };
  const base = time();
  const out = [];
  for (const [k, o] of a.room.objects) {
    if (!o.model || !o.group.visible) continue;
    o.model.visible = false;
    out.push([k, Math.round((base - time()) * 100) / 100]);
    o.model.visible = true;
  }
  out.sort((p, q) => q[1] - p[1]);
  const mats = [];
  a.scene.traverse((m) => { if (m.isMesh && m.visible && m.material && (m.material.transmission > 0 || m.material.transparent || m.material.alphaTest > 0)) mats.push([m.name || m.parent?.name, m.material.type, m.material.transmission || 0, m.material.transparent, m.material.alphaTest]); });
  return { base: Math.round(base * 100) / 100, pr: a.renderer.getPixelRatio(), top: out.slice(0, 12), special: mats.slice(0, 30) };
}, [Number(x), Number(y), Number(yaw), Number(pitch)]);
console.log(JSON.stringify(r, null, 1));
await b.close();
