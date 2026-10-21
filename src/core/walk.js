// First-person walking in room coordinates (inches, z up). No three.js here: the body, its
// collisions, where you start, the doorway between the rooms and what you are aiming at.
//  - The body is a vertical cylinder (radius WALK.radius) that can't cross walls, closed doors,
//    windows or furniture, and stays inside the room's floor outline (the closet recess is not
//    walkable; you reach into it from its front).
//  - Rugs, curtains, rods, cord raceways and anything under 2" tall don't block; pieces resting on
//    furniture (lamps, candles, pillows, the TV) don't block on their own.
//  - The hallway was never measured, so there is no hallway: walking into the living room's hallway
//    opening puts you just inside the bedroom door, and back.
import { obbCorners, pointInPolygon, rotate2 } from './geom.js';
import { itemBoxes } from './items.js';
import { pointAlong } from './catalog.js';

export const WALK = {
  radius: 9, // body cylinder, inches
  eyeHeight: 68, // default eye height (owner is 6'0")
  headroom: 4, // body top above the eyes
  walkSpeed: 48, // 4 ft/s
  runSpeed: 84, // 7 ft/s
  accel: 220, // inches/s² toward the wanted speed
  decel: 300, // inches/s² when letting go
  reach: 96, // you can pick up things within 8 ft
  minBlockHeight: 2, // anything lower doesn't block
  approach: 54, // the doorway label shows within this distance
};

/** Kinds that never block the body (soft, flat or hung on the wall above head height doesn't matter). */
const SOFT_KINDS = new Set(['rug', 'curtain', 'rod', 'raceway', 'throw', 'duvet', 'pillow', 'insert']);

/** The one link between the rooms (there's no hallway model). */
export const DOOR_LINKS = [{ a: { room: 'living', opening: 'LR-HALL' }, b: { room: 'bedroom', opening: 'BR-DOOR' } }];

/** Where you start in each room: just past this door, facing this way (room-spec compass). */
export const START = {
  living: { opening: 'LR-DOOR-ENTRY', facing: 'west' },
  bedroom: { opening: 'BR-DOOR', facing: 'south' },
};
/** Facing when you arrive through the doorway link. */
const ARRIVE_FACING = { 'LR-HALL': 'east', 'BR-DOOR': 'south' };

// ---------------------------------------------------------------------------------------------
// Directions and yaw. Yaw is in degrees, counter-clockwise from above; at yaw 0 you look along +y
// (the same convention as rotation_deg_z: a piece's front at rotation 0 faces +y).

export const fwdOf = (yawDeg) => rotate2(0, 1, yawDeg);
export const yawOf = (dx, dy) => (Math.atan2(-dx, dy) * 180) / Math.PI;

/** Unit vector (room coords) for a compass word, read from room-spec origin.axes ("+x": "west, ..."). */
export function compassDir(room, word) {
  const axes = room.origin?.axes || {};
  const w = word.toLowerCase();
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (const [axis, text] of Object.entries(axes)) {
    const first = String(text).split(/[ ,]/)[0].toLowerCase();
    const v = { '+x': { x: 1, y: 0 }, '+y': { x: 0, y: 1 } }[axis];
    if (!v) continue;
    if (first === w) return v;
    if (first === opposite[w]) return { x: -v.x, y: -v.y };
  }
  throw new Error(`room ${room.id}: no compass direction "${word}" in origin.axes`);
}

// ---------------------------------------------------------------------------------------------
// The world the body collides with

/** The outline's edges as wall segments (closed doors and windows are part of the walls). */
export function outlineSegments(room) {
  const segs = [];
  const poly = room.poly;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const wall = [...room.walls.values()].find((w) => samePt(w.from, a) && samePt(w.to, b) || samePt(w.from, b) && samePt(w.to, a));
    segs.push({ a, b, wallId: wall?.id || null, open: !!wall?.open });
  }
  return segs;
}
const samePt = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

/** Does this item block the body? */
export function blocksBody(it, headZ) {
  if (it.hidden || it.isRug || it.mount === 'top' || it.mount === 'hidden' || it.mount === 'surface') return false;
  if (it.productKind && SOFT_KINDS.has(it.productKind)) return false;
  const boxes = itemBoxes(it);
  const top = Math.max(...boxes.map((b) => b.z1));
  const bottom = Math.min(...boxes.map((b) => b.z0));
  return top >= WALK.minBlockHeight && bottom < headZ;
}

/** Footprint boxes that block the body (each {o, key}), skipping `exclude` keys (a carried piece). */
export function bodyObstacles(items, headZ, exclude = new Set()) {
  const out = [];
  for (const it of items) {
    if (exclude.has(it.key) || !blocksBody(it, headZ)) continue;
    for (const b of itemBoxes(it)) if (b.z1 >= WALK.minBlockHeight && b.z0 < headZ) out.push({ o: b.o, key: it.key });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Collision

function closestOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Push a circle out of one oriented box; returns the push normal or null. */
function pushOutOfBox(p, r, o) {
  const dx = p.x - o.cx, dy = p.y - o.cy;
  const lx = dx * o.ux[0] + dy * o.ux[1], ly = dx * o.uy[0] + dy * o.uy[1];
  const cx = Math.max(-o.hw, Math.min(o.hw, lx)), cy = Math.max(-o.hd, Math.min(o.hd, ly));
  let nx, ny, depth;
  if (cx === lx && cy === ly) {
    // center inside the box: leave by the nearest face
    const px = o.hw - Math.abs(lx), py = o.hd - Math.abs(ly);
    if (px < py) { nx = Math.sign(lx) || 1; ny = 0; depth = px + r; } else { nx = 0; ny = Math.sign(ly) || 1; depth = py + r; }
  } else {
    const ex = lx - cx, ey = ly - cy, d = Math.hypot(ex, ey);
    if (d >= r) return null;
    nx = ex / d; ny = ey / d; depth = r - d;
  }
  const wx = nx * o.ux[0] + ny * o.uy[0], wy = nx * o.ux[1] + ny * o.uy[1];
  p.x += wx * depth; p.y += wy * depth;
  return { x: wx, y: wy };
}

/** Move the circle out of walls and obstacles. Returns the contacts ({x, y} normals, plus wall info). */
export function resolveBody(p, r, segs, obstacles) {
  const contacts = [];
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of segs) {
      const q = closestOnSeg(p, s.a, s.b);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d >= r - 1e-6) continue;
      let nx, ny;
      if (d > 1e-6) { nx = (p.x - q.x) / d; ny = (p.y - q.y) / d; } else { const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y, l = Math.hypot(ex, ey); nx = -ey / l; ny = ex / l; }
      p.x = q.x + nx * r; p.y = q.y + ny * r;
      contacts.push({ x: nx, y: ny, wallId: s.wallId, open: s.open });
      moved = true;
    }
    for (const ob of obstacles) {
      const n = pushOutOfBox(p, r, ob.o);
      if (n) { contacts.push({ ...n, key: ob.key }); moved = true; }
    }
    if (!moved) break;
  }
  return contacts;
}

/** Is the circle fully clear of walls, obstacles and inside the outline? */
export function bodyClear(p, r, room, segs, obstacles) {
  if (!pointInPolygon(p.x, p.y, room.poly)) return false;
  for (const s of segs) { const q = closestOnSeg(p, s.a, s.b); if (Math.hypot(p.x - q.x, p.y - q.y) < r - 0.01) return false; }
  for (const ob of obstacles) if (circleHitsBox(p, r - 0.01, ob.o)) return false;
  return true;
}

export function circleHitsBox(p, r, o) {
  const dx = p.x - o.cx, dy = p.y - o.cy;
  const lx = dx * o.ux[0] + dy * o.ux[1], ly = dx * o.uy[0] + dy * o.uy[1];
  const cx = Math.max(-o.hw, Math.min(o.hw, lx)), cy = Math.max(-o.hd, Math.min(o.hd, ly));
  return Math.hypot(lx - cx, ly - cy) < r;
}

/**
 * One walking step. state {x, y, vx, vy} (inches, inches/s); input {x, y} wanted direction in room
 * coords (length 0..1), run; world {room, segs, obstacles, r}. Returns the new state and contacts.
 */
export function stepBody(state, input, dt, world) {
  const r = world.r ?? WALK.radius;
  const speed = input.run ? WALK.runSpeed : WALK.walkSpeed;
  const len = Math.min(1, Math.hypot(input.x, input.y));
  const tx = len ? (input.x / Math.hypot(input.x, input.y)) * speed * len : 0;
  const ty = len ? (input.y / Math.hypot(input.x, input.y)) * speed * len : 0;
  let vx = state.vx, vy = state.vy;
  const dvx = tx - vx, dvy = ty - vy, dv = Math.hypot(dvx, dvy);
  const rate = (len ? WALK.accel : WALK.decel) * dt;
  if (dv <= rate) { vx = tx; vy = ty; } else { vx += (dvx / dv) * rate; vy += (dvy / dv) * rate; }
  const dist = Math.hypot(vx, vy) * dt;
  const n = Math.max(1, Math.ceil(dist / 2)); // 2" sub-steps: never tunnel through a thin piece
  const p = { x: state.x, y: state.y };
  const contacts = [];
  for (let i = 0; i < n; i++) {
    const prev = { x: p.x, y: p.y };
    p.x += (vx * dt) / n; p.y += (vy * dt) / n;
    const c = resolveBody(p, r, world.segs, world.obstacles);
    contacts.push(...c);
    // a corner the push-out couldn't settle: stay where we were
    if (!bodyClear(p, r, world.room, world.segs, world.obstacles)) { p.x = prev.x; p.y = prev.y; vx = 0; vy = 0; break; }
    for (const k of c) {
      const into = vx * k.x + vy * k.y;
      if (into < 0) { vx -= into * k.x; vy -= into * k.y; }
    }
  }
  return { x: p.x, y: p.y, vx, vy, contacts };
}

// ---------------------------------------------------------------------------------------------
// Start spots and the doorway link

function openingOf(room, id) {
  const o = room.openings.find((x) => x.id === id);
  if (!o) throw new Error(`room ${room.id}: no opening ${id}`);
  const wall = room.walls.get(o.wall);
  const mid = (o.along_from + o.along_to) / 2;
  const c = pointAlong(wall, mid);
  return { o, wall, center: c, normal: wall.normal, mid };
}

/**
 * A clear standing spot just inside an opening: on the room side, past the door's swing
 * (swing_radius from room-spec) so you don't stand where the door opens, the nearest spot to the
 * opening's center line that is clear of walls and furniture.
 */
export function spotInside(cat, roomId, openingId, items, { r = WALK.radius, headZ = WALK.eyeHeight + WALK.headroom } = {}) {
  const room = cat.rooms.get(roomId);
  const { o, wall, normal, mid } = openingOf(room, openingId);
  const segs = outlineSegments(room);
  const obstacles = bodyObstacles(items, headZ);
  const swing = o.type === 'door' ? o.swing_radius ?? o.width : 0;
  // past a door's swing; an open doorway (no door) leaves a step's room so you don't walk straight back
  const d0 = swing + r + (o.type === 'door' ? 3 : 12);
  const half = (o.along_to - o.along_from) / 2;
  for (let extra = 0; extra <= 60; extra += 1) {
    for (let lat = 0; lat <= half + 24; lat += 1) {
      for (const s of lat ? [-1, 1] : [1]) {
        const at = pointAlong(wall, mid + s * lat);
        const p = { x: at.x + normal.x * (d0 + extra), y: at.y + normal.y * (d0 + extra) };
        if (bodyClear(p, r + 1, room, segs, obstacles)) return p;
      }
    }
  }
  throw new Error(`no clear spot inside ${openingId}`);
}

/** Start position and facing yaw for a room (room switch, first visit). */
export function startPose(cat, roomId, items, opts) {
  const room = cat.rooms.get(roomId);
  const s = START[roomId];
  const p = spotInside(cat, roomId, s.opening, items, opts);
  const f = compassDir(room, s.facing);
  return { x: p.x, y: p.y, yaw: yawOf(f.x, f.y) };
}

/** The doorway links that start in this room: [{openingId, center, normal, toRoom, toOpening, label}]. */
export function doorways(cat, roomId) {
  const out = [];
  for (const l of DOOR_LINKS) {
    for (const [here, there] of [[l.a, l.b], [l.b, l.a]]) {
      if (here.room !== roomId) continue;
      const room = cat.rooms.get(roomId);
      const { o, wall, center, normal } = openingOf(room, here.opening);
      out.push({ openingId: o.id, wallId: wall.id, wall, along: [o.along_from, o.along_to], center, normal, toRoom: there.room, toOpening: there.opening, label: there.room === 'bedroom' ? 'To bedroom' : 'To living room' });
    }
  }
  return out;
}

/** Where you arrive when you come through a doorway into `roomId` at `openingId`. */
export function arrivalPose(cat, roomId, openingId, items, opts) {
  const room = cat.rooms.get(roomId);
  const p = spotInside(cat, roomId, openingId, items, opts);
  const f = compassDir(room, ARRIVE_FACING[openingId]);
  return { x: p.x, y: p.y, yaw: yawOf(f.x, f.y) };
}

/**
 * Is the body walking into a linked doorway? True when it presses against the wall inside the
 * opening's width while moving toward it.
 */
export function doorwayHit(cat, roomId, p, move, r = WALK.radius) {
  for (const d of doorways(cat, roomId)) {
    const vx = p.x - d.wall.from.x, vy = p.y - d.wall.from.y;
    const along = vx * d.wall.dir.x + vy * d.wall.dir.y, off = vx * d.normal.x + vy * d.normal.y;
    const into = -(move.x * d.normal.x + move.y * d.normal.y);
    if (off < r + 2.5 && along > d.along[0] + 3 && along < d.along[1] - 3 && into > 0.1) return d;
  }
  return null;
}

/** The doorway label to show, if you are near one: {label, center, dist}. */
export function nearDoorway(cat, roomId, p) {
  let best = null;
  for (const d of doorways(cat, roomId)) {
    const dist = Math.hypot(p.x - d.center.x, p.y - d.center.y);
    if (dist < WALK.approach && (!best || dist < best.dist)) best = { ...d, dist };
  }
  return best;
}

/** The open (unmodeled) edge you are pushing against, from this step's contacts. */
export function openEdgeContact(contacts) {
  return contacts.find((c) => c.open) || null;
}

// ---------------------------------------------------------------------------------------------
// Aiming: a ray from the eye against movable pieces' boxes and the room's walls/floor.

/** Ray (o, d unit) against an item box {o: OBB, z0, z1} grown to at least `minHalf`; entry/exit t or null. */
export function rayBoxT(o, d, b, minHalf = 1.5) {
  const { cx, cy, ux, uy } = b.o;
  const hw = Math.max(b.o.hw, minHalf), hd = Math.max(b.o.hd, minHalf);
  const zc = (b.z0 + b.z1) / 2, hz = Math.max((b.z1 - b.z0) / 2, minHalf);
  const rel = [o.x - cx, o.y - cy, o.z - zc];
  const oo = [rel[0] * ux[0] + rel[1] * ux[1], rel[0] * uy[0] + rel[1] * uy[1], rel[2]];
  const dd = [d.x * ux[0] + d.y * ux[1], d.x * uy[0] + d.y * uy[1], d.z];
  const half = [hw, hd, hz];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (Math.abs(oo[i]) > half[i]) return null; continue; }
    let a = (-half[i] - oo[i]) / dd[i], c = (half[i] - oo[i]) / dd[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return { t0, t1 };
}

/**
 * The room surfaces a ray can hit: walls (vertical, floor to ceiling, with holes where an opening
 * lets you look through), the closet recess walls, the floor and the ceiling.
 *  closetOpen: the closet's sliding doors are open, so you can see and reach into it.
 */
export function roomSurfaces(room, { closetOpen = false } = {}) {
  const walls = [];
  for (const w of room.walls.values()) {
    const holes = [];
    for (const o of w.openings) {
      if (o.type === 'cased opening' || o.type === 'interior opening' || o.type === 'open boundary') holes.push({ a0: o.along_from, a1: o.along_to, z0: o.sill_z ?? 0, z1: o.head_z ?? o.height ?? room.ceiling });
      if (o.type === 'closet' && closetOpen) holes.push({ a0: o.along_from, a1: o.along_to, z0: o.lower?.z_from ?? 0, z1: o.lower?.z_to ?? room.ceiling });
    }
    walls.push({ id: w.id, from: w.from, to: w.to, dir: w.dir, normal: w.normal, len: w.len, open: w.open, holes });
  }
  for (const poly of room.extraRegions) {
    // closet recess: the three walls other than its front (the first edge is the front)
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      walls.push({ id: null, from: a, to: b, dir, normal: { x: -dir.y, y: dir.x }, len, open: false, holes: [], recess: true });
    }
  }
  return { walls, ceiling: room.ceiling, regions: room.regions };
}

/** First wall hit by the ray: {t, wall, along, z, point} or null. */
export function rayWalls(surfaces, o, d, { horizontal = false } = {}) {
  let best = null;
  for (const w of surfaces.walls) {
    if (w.open) continue;
    // segment intersection in plan
    const ex = w.to.x - w.from.x, ey = w.to.y - w.from.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((w.from.x - o.x) * ey - (w.from.y - o.y) * ex) / den;
    const s = ((w.from.x - o.x) * d.y - (w.from.y - o.y) * d.x) / den;
    if (t <= 1e-6 || s < -1e-6 || s > 1 + 1e-6) continue;
    const z = horizontal ? o.z : o.z + d.z * t;
    if (!horizontal && (z < 0 || z > surfaces.ceiling)) continue;
    const along = s * w.len;
    if (!horizontal && w.holes.some((h) => along > h.a0 && along < h.a1 && z > h.z0 && z < h.z1)) continue;
    if (!best || t < best.t) best = { t, wall: w, along, z, point: { x: o.x + d.x * t, y: o.y + d.y * t, z } };
  }
  return best;
}

/**
 * What the eye is aiming at, within `reach`: {key, t, point} for the nearest movable piece whose
 * box the ray enters before any wall; a piece resting on another (a pillow on the sofa) wins over
 * the piece under it when the ray reaches it inside that piece's box.
 */
export function aimAt(items, surfaces, o, d, { reach = WALK.reach, exclude = new Set() } = {}) {
  const wall = rayWalls(surfaces, o, d);
  const floorT = d.z < -1e-6 ? -o.z / d.z : Infinity;
  const limit = Math.min(reach, wall ? wall.t : Infinity, floorT + 2);
  const hits = [];
  for (const it of items) {
    if (it.hidden || exclude.has(it.key)) continue;
    let best = null;
    for (const b of itemBoxes(it)) {
      const h = rayBoxT(o, d, b, 1.5);
      if (h && h.t0 <= limit && (!best || h.t0 < best.t0)) best = h;
    }
    if (best) hits.push({ it, ...best });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.t0 - b.t0);
  let pick = hits[0];
  // prefer something resting on the first piece hit, if the ray reaches it inside that piece
  const onTop = hits.filter((h) => h.it.supportId && h.it.supportId === pick.it.id && h.t0 <= pick.t1);
  if (onTop.length) pick = onTop[0];
  // a rug is a last resort: anything standing on it wins
  if (pick.it.isRug) { const other = hits.find((h) => !h.it.isRug); if (other) pick = other; }
  return { key: pick.it.key, t: pick.t0, point: { x: o.x + d.x * pick.t0, y: o.y + d.y * pick.t0, z: o.z + d.z * pick.t0 } };
}

/** Is a floor point on a rug? (soft footsteps) */
export function onRug(items, p) {
  for (const it of items) {
    if (!it.isRug) continue;
    for (const b of itemBoxes(it)) {
      const dx = p.x - b.o.cx, dy = p.y - b.o.cy;
      if (Math.abs(dx * b.o.ux[0] + dy * b.o.ux[1]) <= b.o.hw && Math.abs(dx * b.o.uy[0] + dy * b.o.uy[1]) <= b.o.hd) return true;
    }
  }
  return false;
}

export { obbCorners };
