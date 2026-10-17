// Pure 2D/3D geometry helpers in room coordinates (inches). No Three.js here so it runs in Node tests.
export const DEG = Math.PI / 180;

/** Oriented box on the floor plane. yawDeg is CCW from above; local +y is the object's front. */
export function obb(cx, cy, hw, hd, yawDeg = 0) {
  const a = yawDeg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  return { cx, cy, hw, hd, ux: [c, s], uy: [-s, c] };
}

export function obbCorners(o) {
  const pts = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pts.push({
      x: o.cx + sx * o.hw * o.ux[0] + sy * o.hd * o.uy[0],
      y: o.cy + sx * o.hw * o.ux[1] + sy * o.hd * o.uy[1],
    });
  }
  return pts;
}

/** Penetration depth along the separating-axis test; > 0 means the boxes overlap by that much. */
export function obbPenetration(a, b) {
  let min = Infinity;
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const n of [a.ux, a.uy, b.ux, b.uy]) {
    const ra = a.hw * Math.abs(a.ux[0] * n[0] + a.ux[1] * n[1]) + a.hd * Math.abs(a.uy[0] * n[0] + a.uy[1] * n[1]);
    const rb = b.hw * Math.abs(b.ux[0] * n[0] + b.ux[1] * n[1]) + b.hd * Math.abs(b.uy[0] * n[0] + b.uy[1] * n[1]);
    const d = Math.abs(dx * n[0] + dy * n[1]);
    min = Math.min(min, ra + rb - d);
    if (min <= 0) return min;
  }
  return min;
}

export function obbOverlap(a, b, eps = 0.05) {
  return obbPenetration(a, b) > eps;
}

export function rectToObb(r) {
  return obb((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, Math.abs(r.x1 - r.x0) / 2, Math.abs(r.y1 - r.y0) / 2, 0);
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInRegion(x, y, polys) {
  return polys.some((p) => pointInPolygon(x, y, p));
}

/**
 * True when the whole box lies inside the union of polygons. Samples the box outline every
 * 2 inches (pulled 0.05" toward the center so boxes flush against a wall still count as inside).
 */
export function obbInsideRegion(o, polys) {
  const c = obbCorners(o);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      let x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const vx = o.cx - x, vy = o.cy - y, vl = Math.hypot(vx, vy) || 1;
      x += (vx / vl) * 0.05; y += (vy / vl) * 0.05;
      if (!pointInRegion(x, y, polys)) return false;
    }
  }
  return pointInRegion(o.cx, o.cy, polys);
}

export function rotate2(x, y, deg) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

export const normDeg = (d) => {
  let r = d % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 1000) / 1000;
};
