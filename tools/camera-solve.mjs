// Recovers each photo's camera (position, direction, lens) from tests/camera/points.json by
// minimizing reprojection error, then prints presets for src/scene/views.js.
// Model: pinhole + radial distortion k1 (phone wide lenses bend straight lines); the app renders
// the pinhole part, so the comparison images show the photos' own lens bending at the edges.
// Run: node tools/camera-solve.mjs [--write]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(fs.readFileSync(path.join(root, 'tests/camera/points.json'), 'utf8'));
const W = 1024, H = 768;
const rad = Math.PI / 180;

const FACING = {
  living: { north: [0, -1], south: [0, 1], east: [-1, 0], west: [1, 0] },
  bedroom: { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1] },
};
const BOUNDS = { living: [0, 222, 0, 261], bedroom: [0, 121, 0, 136] };

function basis([, , , yaw, pitch, roll]) {
  const f = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  let r = [f[1], -f[0], 0];
  const rl = Math.hypot(r[0], r[1]) || 1;
  r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const c = Math.cos(roll), s = Math.sin(roll);
  return { f, r: r.map((v, i) => v * c + u[i] * s), u: u.map((v, i) => v * c - r[i] * s) };
}

export function project(p, P) {
  const { f, r, u } = basis(p);
  const v = [P[0] - p[0], P[1] - p[1], P[2] - p[2]];
  const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
  if (zc < 1) return null;
  const x = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / zc, y = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / zc;
  const fpx = H / 2 / Math.tan((p[6] * rad) / 2);
  const r2 = (x * x + y * y) * (fpx * fpx) / (W * W / 4); // normalized to the half-width
  const d = 1 + p[7] * r2;
  return [W / 2 + fpx * x * d, H / 2 - fpx * y * d];
}

function residuals(p, pts) {
  return pts.map((pt) => {
    if (pt.p) {
      const q = project(p, pt.p);
      return q ? Math.hypot(q[0] - pt.px[0], q[1] - pt.px[1]) : 2000;
    }
    const [a, b] = pt.line;
    let best = 2000;
    for (let i = -40; i <= 240; i++) {
      const t = i / 200;
      const q = project(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      if (q) best = Math.min(best, Math.hypot(q[0] - pt.px[0], q[1] - pt.px[1]));
    }
    return best;
  });
}

function cost(p, pts, room, lens, bounds) {
  const res = residuals(p, pts);
  let c = 0;
  res.forEach((e, i) => { const w = pts[i].w ?? 1; c += w * (e < 20 ? e * e : 40 * e - 400); });
  const [x0, x1, y0, y1] = bounds || BOUNDS[room];
  const out = Math.max(0, x0 - 10 - p[0]) + Math.max(0, p[0] - x1 - 10) + Math.max(0, y0 - 10 - p[1]) + Math.max(0, p[1] - y1 - 10);
  c += out * out * 50;
  if (p[2] < 15 || p[2] > 92) c += 1e5;
  if (p[6] < 35 || p[6] > 110) c += 1e5;
  if (Math.abs(p[7]) > 0.6) c += 1e5;
  if (lens) c += 400 * (p[6] - lens) ** 2;
  return c;
}

function nelderMead(fn, x0, step, iters = 4000) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: fn(x) }));
  for (let k = 0; k < iters; k++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i].x[j] / n;
    const at = (t) => c.map((v, j) => v + t * (worst.x[j] - v));
    const xr = at(-1), fr = fn(xr);
    if (fr < best.f) { const xe = at(-2), fe = fn(xe); simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr }; }
    else if (fr < second.f) simplex[n] = { x: xr, f: fr };
    else {
      const xc = at(0.5), fc = fn(xc);
      if (fc < worst.f) simplex[n] = { x: xc, f: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])), f: fn(s.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]))) }));
    }
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-9 && k > 500) break;
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

export function solve(id, pts, lens = data._lens?.[id], bounds = data._bounds?.[id]) {
  const room = id.startsWith('living') ? 'living' : 'bedroom';
  const facing = id.match(/facing-(\w+)$/)[1];
  const dir = facing.split(/(?=east|west)/).filter(Boolean).reduce((acc, w) => { const d = FACING[room][w]; return [acc[0] + d[0], acc[1] + d[1]]; }, [0, 0]);
  const yaw0 = Math.atan2(dir[1], dir[0]);
  const [x0, x1, y0, y1] = bounds || BOUNDS[room];
  let best = null;
  // coarse search over positions, then refine the best few
  const starts = [];
  for (let gx = 0; gx <= 8; gx++) for (let gy = 0; gy <= 8; gy++) for (const z of [40, 60]) for (const fov of [55, 85]) {
    const p = [x0 + ((x1 - x0) * gx) / 8, y0 + ((y1 - y0) * gy) / 8, z, yaw0, -0.05, 0, fov, 0];
    starts.push({ p, f: cost(p, pts, room, lens, bounds) });
  }
  starts.sort((a, b) => a.f - b.f);
  for (const s of starts.slice(0, 14)) {
    let r = nelderMead((p) => cost(p, pts, room, lens, bounds), s.p, [12, 12, 8, 0.25, 0.15, 0.05, 8, 0.05]);
    r = nelderMead((p) => cost(p, pts, room, lens, bounds), r.x, [3, 3, 3, 0.05, 0.05, 0.02, 3, 0.03]);
    if (!best || r.f < best.f) best = r;
  }
  const p = best.x;
  const res = residuals(p, pts);
  return { id, room, p, res, rms: Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length) };
}

function toPreset(s) {
  const [x, y, z, yaw, pitch] = s.p;
  const d = 100;
  const t = { x: x + Math.cos(pitch) * Math.cos(yaw) * d, y: y + Math.cos(pitch) * Math.sin(yaw) * d, z: z + Math.sin(pitch) * d };
  const r1 = (v) => Math.round(v * 10) / 10;
  return { pos: { x: r1(x), y: r1(y), z: r1(z) }, target: { x: r1(t.x), y: r1(t.y), z: r1(t.z) }, vfov: r1(s.p[6]), roll: Math.round(s.p[5] / rad * 100) / 100, k1: Math.round(s.p[7] * 1000) / 1000 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = {};
  for (const [id, pts] of Object.entries(data)) {
    if (id.startsWith('_')) continue;
    const s = solve(id, pts);
    out[id] = { ...toPreset(s), rmsPx: Math.round(s.rms * 10) / 10 };
    console.log(id.padEnd(44), JSON.stringify(out[id]), 'residuals:', s.res.map((r) => r.toFixed(0)).join(' '));
  }
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'tests/camera/solved.json'), JSON.stringify(out, null, 2));
}
