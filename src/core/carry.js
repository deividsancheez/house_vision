// Carrying a piece in Walk mode: where it would land and whether it may go there. No three.js.
// The landing spot follows the rules in items.js:
//  - floor pieces land on the floor in front of you
//  - wall pieces go flat against the wall you face, at their current height
//  - "on top of" pieces land on the piece they rest on (the slot's on_top_of), where you aim
//  - "surface" pieces (lookbook pieces placed freely) land on whatever you look down at, or the floor
// Green: fits. Yellow: fits but makes a fit warning. Red: can't go there (a wall, another piece,
// your own feet, no wall to hang it on, or nothing to rest on), and the drop is refused.
import { checkPose, effDims, baseZFor, itemBoxes, resolveSupports, supportOf, wallFacingYaw } from './items.js';
import { pointAlong, wallCoords } from './catalog.js';
import { computeWarnings } from './fit.js';
import { normDeg, rotate2, pointInPolygon } from './geom.js';
import { WALK, fwdOf, rayWalls, circleHitsBox } from './walk.js';
import { nameOf } from './explain.js';

/** Pieces carried "in the hands" (largest side under 30"); bigger ones float ahead as a ghost. */
export const HAND_LIMIT = 30;
export const isSmall = (it) => Math.max(it.dims.w, it.dims.d, it.dims.h) < HAND_LIMIT;

/** How far ahead a big piece floats: its near edge 30" (2.5 ft) in front of you. */
export const GHOST_GAP = 30;

/** Plain-language name of a piece for messages. */
export function shortName(it) {
  const n = it.kind === 'product' ? it.product.name : it.piece.name;
  return n.split(/[,(]/)[0].trim();
}

/** Copy of an item for trying out poses without touching the layout. */
export function probe(it, pose, roomId, wallId) {
  return { ...it, pose, roomId, wallId: wallId ?? it.wallId };
}

/** Poses of the pieces resting on `base` after it moves from oldPose to newPose. */
export function carryAlong(deps, oldPose, newPose) {
  const dRot = newPose.rot - oldPose.rot;
  return deps.map((dep) => {
    const rel = rotate2(dep.pose.x - oldPose.x, dep.pose.y - oldPose.y, dRot);
    return { key: dep.key, pose: { ...dep.pose, x: newPose.x + rel.x, y: newPose.y + rel.y, rot: normDeg(dep.pose.rot + dRot) } };
  });
}

/**
 * Where the carried piece would land and whether it may.
 * ctx: {cat, roomId, items (standing in this room, the carried pieces left out), it (carried item),
 *       deps (items resting on it), surfaces (walk.roomSurfaces), eye {x,y,z}, dir {x,y,z} (unit),
 *       yaw (deg), relRot (deg, the piece's turn relative to you), body {x, y}}
 * Returns {pose, wallId, status: 'ok'|'warn'|'bad', reason, warnings, deps: [{key, pose}]}.
 */
export function previewPlacement(ctx) {
  const { cat, roomId, items, it, eye, dir, yaw, relRot = 0, body } = ctx;
  const room = cat.rooms.get(roomId);
  const flat = Math.hypot(dir.x, dir.y) > 1e-6 ? { x: dir.x / Math.hypot(dir.x, dir.y), y: dir.y / Math.hypot(dir.x, dir.y) } : fwdOf(yaw);
  let pose, wallId = it.wallId;
  const bad = (reason, p = pose) => ({ pose: p, wallId, status: 'bad', reason, warnings: [], deps: [] });

  if (it.mount === 'wall') {
    // the wall straight ahead (in plan), at the piece's current height
    const hit = rayWalls(ctx.surfaces, eye, { x: flat.x, y: flat.y, z: 0 }, { horizontal: true });
    const openHit = !hit && ctx.surfaces.walls.some((w) => w.open);
    if (!hit || !hit.wall.id || hit.wall.recess) return bad(openHit ? 'No wall here to hang it on (the kitchen isn’t modeled).' : 'Face a wall to hang it.', { ...it.pose });
    const wall = room.walls.get(hit.wall.id);
    const ed = effDims(it);
    const along = Math.max(ed.w / 2, Math.min(wall.len - ed.w / 2, hit.along));
    const at = pointAlong(wall, along);
    const off = it.dims.d / 2;
    wallId = wall.id;
    pose = { ...it.pose, x: at.x + wall.normal.x * off, y: at.y + wall.normal.y * off, z: it.pose.z, rot: wallFacingYaw(wall) };
    if (wall.len < ed.w) return bad(`It's wider than this wall (${fmt(ed.w)} in on a ${fmt(wall.len)} in wall).`);
  } else if (it.mount === 'top') {
    const sup = supportOf(items, it);
    if (!sup) {
      const name = cat.existing.get(it.supportId)?.name || cat.slots.get(it.supportId)?.label || it.supportId;
      return bad(`It sits on the ${shortLabel(name)}, which isn't in this room.`, { ...it.pose });
    }
    const z = baseZFor(items, it, it.pose);
    let p = null;
    if (dir.z < -1e-6) {
      const t = (z - eye.z) / dir.z;
      if (t > 0 && t <= WALK.reach * 1.5) p = { x: eye.x + dir.x * t, y: eye.y + dir.y * t };
    }
    if (!p || !itemBoxes(sup).some((b) => inBox(p, b.o))) return bad(`Aim at the ${nameOf(sup)} to set it down there.`, { ...it.pose });
    pose = { ...it.pose, x: p.x, y: p.y, rot: normDeg(yaw + relRot) };
  } else if (it.mount === 'surface') {
    // a lookbook piece placed freely: on top of whatever you look down at, or on the floor
    const s = surfaceUnderAim(room, items, ctx.surfaces, eye, dir);
    if (!s) return bad('Look down at a table, the bed, a shelf or the floor to set it there.', { ...it.pose });
    pose = { ...it.pose, x: s.x, y: s.y, z: s.z, rot: normDeg(yaw + relRot) };
    if (s.on) pose.on = s.on; else delete pose.on;
  } else {
    // floor: big pieces float with their near edge GHOST_GAP ahead; small ones land where you aim
    const rot = normDeg(yaw + relRot);
    let c;
    if (isSmall(it)) {
      let dist = 48;
      if (dir.z < -1e-6) dist = (-eye.z / dir.z) * Math.hypot(dir.x, dir.y);
      dist = Math.max(18 + WALK.radius, Math.min(WALK.reach, dist));
      c = { x: eye.x + flat.x * dist, y: eye.y + flat.y * dist };
    } else {
      const dist = GHOST_GAP + halfExtentAlong(it, rot, flat);
      c = { x: body.x + flat.x * dist, y: body.y + flat.y * dist };
    }
    pose = { ...it.pose, x: c.x, y: c.y, z: 0, rot };
  }

  const tryIt = { ...it, pose, roomId, wallId };
  const others = items.filter((o) => o.key !== it.key);
  const r = checkPose(room, [...others, tryIt], tryIt, pose, pose, { strict: true });
  if (!r.ok) {
    const reason = r.reason === 'furniture' ? `It would hit the ${r.blockers.map((b) => nameOf(b)).join(' and the ')}.`
      : r.reason === 'wall' ? 'It would go through a wall.'
      : r.reason === 'ceiling' ? 'It doesn’t fit under the ceiling here.'
      : r.reason === 'wall-end' ? 'It runs past the end of the wall.'
      : r.reason === 'support' ? 'It has to sit on the piece it rests on.' : 'It can’t go there.';
    return bad(reason);
  }
  if (tryIt.collides && it.mount === 'floor' && itemBoxes(tryIt, pose, 0).some((b) => circleHitsBox(body, WALK.radius, b.o))) return bad('You’re standing there.');

  // fit warnings this drop would cause (for the piece itself and anything riding on it)
  const deps = carryAlong(ctx.deps || [], it.pose, pose);
  const depItems = (ctx.deps || []).map((d, i) => ({ ...d, pose: deps[i].pose, roomId }));
  const trial = [...others, tryIt, ...depItems];
  resolveSupports(trial);
  const mine = new Set([it.key, ...depItems.map((d) => d.key)]);
  const warnings = computeWarnings(cat, roomId, trial).filter((w) => mine.has(w.key) || mine.has(w.other));
  return { pose, wallId, status: warnings.length ? 'warn' : 'ok', reason: null, warnings, deps };
}

/**
 * The nearest top face (or the floor) under the line of sight, within reach and in front of any
 * wall: {x, y, z, on} where `on` is the piece it would rest on (null: the floor). Rugs count as floor.
 */
export function surfaceUnderAim(room, items, surfaces, eye, dir) {
  if (dir.z >= -1e-6) return null;
  const wall = rayWalls(surfaces, eye, dir);
  const limit = Math.min(WALK.reach * 1.5, wall ? wall.t : Infinity);
  let best = null;
  for (const it of items) {
    if (it.hidden || it.isRug || it.mount === 'wall' || it.index !== 0) continue;
    for (const b of itemBoxes(it)) {
      if (eye.z <= b.z1 + 0.1) continue;
      const t = (b.z1 - eye.z) / dir.z;
      if (t <= 0 || t > limit || (best && t >= best.t)) continue;
      const p = { x: eye.x + dir.x * t, y: eye.y + dir.y * t };
      if (inBox(p, b.o)) best = { t, x: p.x, y: p.y, z: b.z1, on: it.id };
    }
  }
  const tf = -eye.z / dir.z;
  if (tf > 0 && tf <= limit && (!best || tf < best.t)) {
    const p = { x: eye.x + dir.x * tf, y: eye.y + dir.y * tf };
    if (room.regions.some((poly) => pointInPolygon(p.x, p.y, poly))) best = { t: tf, x: p.x, y: p.y, z: 0, on: null };
  }
  return best;
}

function inBox(p, o) {
  const dx = p.x - o.cx, dy = p.y - o.cy;
  return Math.abs(dx * o.ux[0] + dy * o.ux[1]) <= o.hw && Math.abs(dx * o.uy[0] + dy * o.uy[1]) <= o.hd;
}

/** Half the piece's extent (all its parts) along a direction, at yaw `rot`, around its center. */
function halfExtentAlong(it, rot, f) {
  const parts = it.localParts || [{ ox: 0, oy: 0, hw: it.dims.w / 2, hd: it.dims.d / 2 }];
  let m = 0;
  for (const p of parts) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = rotate2(p.ox + sx * p.hw, p.oy + sy * p.hd, rot);
      m = Math.max(m, -(c.x * f.x + c.y * f.y));
    }
  }
  return m;
}

function shortLabel(n) { return String(n).split(/[,(]/)[0].trim().toLowerCase(); }
const fmt = (v) => String(Math.round(v * 10) / 10);

export { wallCoords };
