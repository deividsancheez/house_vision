// Dev helper: finds materials whose shader program changes from frame to frame in Walk mode.
// node tools/walkprog.mjs [room]   (needs npx vite --port 5199)
import { chromium } from '@playwright/test';
const [room = 'living'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`http://localhost:5199/?room=${room}&mode=walk`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
const r = await p.evaluate(async () => {
  const a = window.__app;
  const snap = () => {
    const m = new Map();
    for (const sc of [a.scene, a.walk.hands.scene]) sc.traverse((o) => {
      if (!o.material) return;
      for (const mat of [].concat(o.material)) {
        const pr = a.renderer.properties.get(mat);
        m.set(mat.uuid, { name: `${sc === a.scene ? 'main' : 'hands'}:${o.name || o.parent?.name || o.type}:${mat.type}:${mat.name}`, prog: pr.currentProgram?.id, key: pr.currentProgram?.cacheKey?.slice(0, 400) });
      }
    });
    return m;
  };
  a.forceRender = true;
  await new Promise((r) => setTimeout(r, 500));
  const s1 = snap();
  await new Promise((r) => requestAnimationFrame(r));
  const s2 = snap();
  a.forceRender = false;
  const out = [];
  for (const [u, v] of s1) { const w = s2.get(u); if (w && v.prog !== w.prog) out.push({ name: v.name, a: v.prog, b: w.prog, ka: v.key, kb: w.key }); }
  let created = 0; const gl = a.renderer.getContext(); const o = gl.linkProgram.bind(gl); gl.linkProgram = (x) => { created++; return o(x); };
  const seen = []; const oc = a.room.updateCutaway.bind(a.room); a.room.updateCutaway = (c) => { const n0 = created; oc(c); if (created !== n0) seen.push(1); };
  const r0 = a.renderer.render.bind(a.renderer); a.renderer.render = (s, c) => { const n0 = created; r0(s, c); if (created !== n0) seen.push(s === a.scene ? 'main' : 'hands'); };
  const ids = (l) => new Set(l.map((x) => x.id)); let prev = [...a.renderer.info.programs]; const log = [];
  const r1 = a.renderer.render; a.renderer.render = (s, c) => { r1(s, c); const now = a.renderer.info.programs; const pi = ids(prev), ni = ids(now); for (const x of now) if (!pi.has(x.id)) log.push(['+', x.id, x.name, x.cacheKey.length, x.usedTimes]); for (const x of prev) if (!ni.has(x.id)) log.push(['-', x.id, x.name]); prev = [...now]; };
  await a.measureWalkFps(3000); a.__log = log;
  return { log: a.__log.slice(0, 40), seen: seen.slice(0, 20), changed: out.slice(0, 10), linksPerSecond: created, frames: a.frameCount };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
