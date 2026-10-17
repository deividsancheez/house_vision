// Layout state + the placed "items" derived from it, with the placement rules:
//  - floor items stay inside the room outline (plus the closet recess) and can't pass through furniture
//  - wall items slide on their own wall and stay between floor, ceiling and the wall ends
//  - "on top of" items stay on the piece they rest on and move with it
// All coordinates are room coordinates in inches (see units.js).
import { obb, obbPenetration, obbInsideRegion, rotate2, normDeg } from './geom.js';
import { wallCoords, pointAlong, wallFacingYaw } from './catalog.js';

export const LAYOUT_SCHEMA = 1;

// ---------------------------------------------------------------------------------------------
// Product kinds (decide how a product is modeled and which size rules apply)

export function productKind(p) {
  const n = `${p.name}`.toLowerCase();
  const c = `${p.category}`.toLowerCase();
  if (c.startsWith('desk chair')) return 'chair';
  if (c.startsWith('desk lamp') || n.includes('work lamp')) return 'desklamp';
  if (c.startsWith('desk')) return 'desk';
  if (n.includes('rod set') || n.includes('curtain rod')) return 'rod';
  if (n.includes('curtain')) return 'curtain';
  if (n.includes('rug')) return 'rug';
  if (n.includes('throw')) return 'throw';
  if (n.includes('duvet')) return 'duvet';
  if (n.includes('inner cushion') || n.includes('insert')) return 'insert';
  if (n.includes('pillow') || n.includes('cushion')) return 'pillow';
  if (n.includes('sconce')) return 'sconce';
  if (n.includes('floor lamp')) return 'floorlamp';
  if (n.includes('lamp')) return 'tablelamp';
  if (n.includes('coffee table')) return 'coffeetable';
  if (n.includes('mirror')) return 'mirror';
  if (n.includes('wall art') || n.includes('picture') || n.includes('canvas')) return 'art';
  if (n.includes('olive tree')) return 'tree';
  if (n.includes('plant') || n.includes('olive')) return 'plant';
  if (n.includes('raceway')) return 'raceway';
  if (n.includes('candle')) return 'candle';
  if (n.includes('vase')) return 'vase';
  if (n.includes('nightstand')) return 'nightstand';
  if (n.includes('hamper')) return 'hamper';
  if (n.includes('cabinet') || n.includes('side table')) return 'cabinet';
  return 'box';
}

/** Products whose 3D state differs from their flat catalog size: they use the slot's placement box. */
const PLACED_STATE_KINDS = new Set(['curtain', 'throw', 'duvet']);
/** Kinds that never block other items (flat, soft or hidden). */
const NON_COLLIDING = new Set(['rug', 'curtain', 'rod', 'raceway', 'throw', 'duvet', 'pillow', 'insert']);

export function isLightSource(p) {
  return !!p.bulb_spec || /candle/i.test(p.name);
}

// Extra pieces for multi-piece products whose slot only gives one placement.
// BR-ART-B (PJÄTTERYD) is a set of 3 canvases; design-notes: "hang one above the bed and two on
// the desk wall". products.json gives no position for the other two, so the app puts them on the
// desk wall west of the desk, centered at the 57" art height with the 1.5" gap the notes use.
// These two positions are the app's choice (listed in the test report) and can be moved.
export const EXTRA_PIECE_PLACEMENTS = {
  'BR-ART-B': [
    { wall: 'BR-W-SOUTH', x: 120.5, y: 19.25, z: 57, rot: 90 },
    { wall: 'BR-W-SOUTH', x: 120.5, y: 42.75, z: 57, rot: 90 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Layout

export function defaultLayout(cat) {
  const layout = { schema: LAYOUT_SCHEMA, slots: {}, existing: {} };
  for (const s of cat.slots.values()) layout.slots[s.slot_id] = { option: s.default_option, poses: defaultSlotPoses(cat, s, s.default_option) };
  for (const e of cat.existing.values()) {
    if (e.keep === false) continue;
    layout.existing[e.id] = { hidden: false, poses: defaultExistingPoses(e) };
  }
  return layout;
}

export function defaultSlotPoses(cat, slot, productId) {
  const poses = slot.placements.map((pl) => ({
    x: pl.position_center.x,
    y: pl.position_center.y,
    z: slot.mount === 'wall' ? pl.position_center.z : pl.bbox.min.z,
    rot: pl.rotation_deg_z ?? 0,
    spin: 0,
  }));
  for (const extra of EXTRA_PIECE_PLACEMENTS[productId] || []) poses.push({ ...extra, spin: 0 });
  return poses;
}

function bboxCenter(b) {
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
}

function existingBox(e) {
  if (e.bbox) return e.bbox;
  if (e.components) {
    const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const c of e.components) for (const k of ['x', 'y', 'z']) { min[k] = Math.min(min[k], c.bbox.min[k]); max[k] = Math.max(max[k], c.bbox.max[k]); }
    return { min, max };
  }
  return null;
}

export function defaultExistingPoses(e) {
  const boxes = e.instances ? e.instances.map((i) => ({ bbox: i.bbox, rot: i.rotation_deg_z ?? 0 })) : [{ bbox: existingBox(e), rot: e.components ? 0 : e.rotation_deg_z ?? 0 }];
  return boxes.filter((b) => b.bbox).map(({ bbox, rot }) => {
    const c = bboxCenter(bbox);
    return { x: c.x, y: c.y, z: e.mount === 'wall' ? c.z : bbox.min.z, rot, spin: 0 };
  });
}

/** Fill in anything a stored/imported layout lacks and drop ids that no longer exist. */
export function normalizeLayout(cat, raw) {
  const def = defaultLayout(cat);
  const out = { schema: LAYOUT_SCHEMA, slots: {}, existing: {} };
  const dropped = [];
  for (const [id, d] of Object.entries(def.slots)) {
    const r = raw?.slots?.[id];
    const slot = cat.slots.get(id);
    if (!r) { out.slots[id] = d; continue; }
    let option = r.option === null ? null : slot.options.includes(r.option) ? r.option : slot.default_option;
    if (r.option && !slot.options.includes(r.option)) dropped.push(r.option);
    const want = defaultSlotPoses(cat, slot, option ?? slot.default_option);
    const poses = want.map((p, i) => (validPose(r.poses?.[i]) ? { ...p, ...pick(r.poses[i]) } : p));
    out.slots[id] = { option, poses };
  }
  for (const id of Object.keys(raw?.slots || {})) if (!def.slots[id]) dropped.push(id);
  for (const [id, d] of Object.entries(def.existing)) {
    const r = raw?.existing?.[id];
    if (!r) { out.existing[id] = d; continue; }
    out.existing[id] = { hidden: !!r.hidden, poses: d.poses.map((p, i) => (validPose(r.poses?.[i]) ? { ...p, ...pick(r.poses[i]) } : p)) };
  }
  return { layout: out, dropped };
}

const validPose = (p) => p && ['x', 'y', 'z', 'rot'].every((k) => Number.isFinite(p[k]));
const pick = (p) => ({ x: p.x, y: p.y, z: p.z, rot: p.rot, spin: Number.isFinite(p.spin) ? p.spin : 0 });

// ---------------------------------------------------------------------------------------------
// Items

function slotMount(slot) {
  if (slot.anchor === 'on top of') return /not visible/i.test(slot.notes || '') ? 'hidden' : 'top';
  if (slot.mount === 'wall') return 'wall';
  return 'floor';
}

function existingMount(e) {
  const a = `${e.anchor || ''}`;
  if (/^on\s+/i.test(a)) return 'top';
  if (e.mount === 'wall') return 'wall';
  return 'floor';
}

function unrotatedDims(bbox, rotDeg) {
  const dx = bbox.max.x - bbox.min.x, dy = bbox.max.y - bbox.min.y, h = bbox.max.z - bbox.min.z;
  const s = Math.abs(Math.sin((rotDeg * Math.PI) / 180));
  return s > 0.5 ? { w: dy, d: dx, h } : { w: dx, d: dy, h };
}

/** Size (w along local x, d along local y = front, h up) the product is drawn and tested at. */
export function productDims(product, slot, index = 0) {
  const kind = productKind(product);
  const pl = slot.placements[Math.min(index, slot.placements.length - 1)];
  if (PLACED_STATE_KINDS.has(kind)) return unrotatedDims(pl.bbox, pl.rotation_deg_z ?? 0);
  return { ...product.dimensions_in };
}

/** Build the list of items placed in one room for the given layout. */
export function buildItems(cat, layout, roomId) {
  const items = [];
  for (const slot of cat.slotsByRoom[roomId] || []) {
    const sel = layout.slots[slot.slot_id];
    if (!sel?.option) continue;
    const product = cat.products.get(sel.option);
    const kind = productKind(product);
    const mount = slotMount(slot);
    sel.poses.forEach((pose, i) => {
      const dims = productDims(product, slot, i);
      items.push({
        key: `${slot.slot_id}#${i}`,
        kind: 'product',
        id: slot.slot_id,
        index: i,
        roomId,
        slot,
        product,
        productKind: kind,
        name: product.name,
        mount,
        wallId: mount === 'wall' ? pose.wall || slot.wall : null,
        supportId: mount === 'top' || mount === 'hidden' ? slot.on_top_of : null,
        dims,
        localParts: null,
        collides: mount !== 'hidden' && mount !== 'top' && !NON_COLLIDING.has(kind),
        isRug: kind === 'rug',
        hidden: mount === 'hidden',
        defaultZ: defaultSlotPoses(cat, slot, product.id)[i]?.z ?? 0,
        pose,
      });
    });
  }
  for (const e of cat.existingByRoom[roomId] || []) {
    const st = layout.existing[e.id];
    if (!st || st.hidden) continue;
    const mount = existingMount(e);
    const defaults = defaultExistingPoses(e);
    st.poses.forEach((pose, i) => {
      const def = defaults[i];
      const box = e.instances ? e.instances[i].bbox : existingBox(e);
      // The bbox is the placed extent (e.g. the leaning mirror needs 10" of floor depth, not its 1.5" frame).
      const dims = box ? unrotatedDims(box, def.rot) : { ...e.dims };
      let localParts = null;
      if (e.components) {
        localParts = e.components.map((c) => {
          const cc = bboxCenter(c.bbox);
          const o = rotate2(cc.x - def.x, cc.y - def.y, -def.rot);
          const u = unrotatedDims(c.bbox, def.rot);
          return { ox: o.x, oy: o.y, hw: u.w / 2, hd: u.d / 2, z0: c.bbox.min.z - box.min.z, z1: c.bbox.max.z - box.min.z };
        });
      }
      items.push({
        key: `${e.id}#${i}`,
        kind: 'existing',
        id: e.id,
        index: i,
        roomId,
        piece: e,
        name: e.name,
        mount,
        wallId: mount === 'wall' ? e.wall : null,
        supportId: mount === 'top' ? `${e.anchor}`.replace(/^on\s+/i, '').trim() : null,
        dims,
        localParts,
        collides: mount !== 'top',
        isRug: false,
        hidden: false,
        defaultZ: def.z,
        pose,
      });
    });
  }
  resolveSupports(items);
  return items;
}

export function supportOf(items, item) {
  if (!item.supportId) return null;
  return items.find((o) => o.id === item.supportId && o.index === 0) || null;
}

/** Bottom z of every item (dependents sit on their support's top; wall items hang by their center). */
export function resolveSupports(items) {
  for (const it of items) it.unsupported = false;
  const order = [...items].sort((a, b) => (a.supportId ? 1 : 0) - (b.supportId ? 1 : 0));
  for (const it of order) it.baseZ = baseZFor(items, it, it.pose);
}

export function baseZFor(items, it, pose) {
  if (it.mount === 'wall') return pose.z - effDims(it, pose).h / 2;
  if (it.mount === 'top' || it.mount === 'hidden') {
    const sup = supportOf(items, it);
    if (!sup) { it.unsupported = it.mount === 'top'; return 0; }
    // Product supports can be swapped for a different height; existing ones keep the designer's z.
    if (sup.kind === 'product') return (sup.baseZ ?? 0) + sup.dims.h;
    return it.defaultZ;
  }
  return pose.z ?? 0;
}

/** Wall items can be turned a quarter turn in the wall plane ("spin"), which swaps width and height. */
export function effDims(it, pose = it.pose) {
  const d = it.dims;
  return (Math.abs(pose.spin || 0) / 90) % 2 === 1 ? { w: d.h, d: d.d, h: d.w } : d;
}

/** Footprint boxes (room coords) and z ranges of an item at a pose. */
export function itemBoxes(it, pose = it.pose, baseZ = it.baseZ ?? 0) {
  const parts = it.localParts || [{ ox: 0, oy: 0, hw: effDims(it, pose).w / 2, hd: it.dims.d / 2, z0: 0, z1: effDims(it, pose).h }];
  return parts.map((p) => {
    const o = rotate2(p.ox, p.oy, pose.rot);
    return { o: obb(pose.x + o.x, pose.y + o.y, p.hw, p.hd, pose.rot), z0: baseZ + p.z0, z1: baseZ + p.z1 };
  });
}

export function dependentsOf(items, item) {
  return items.filter((o) => o.supportId === item.id && item.index === 0 && o.key !== item.key);
}

function overlapPairs(items, it, pose, baseZ) {
  const mine = itemBoxes(it, pose, baseZ);
  const hits = [];
  for (const other of items) {
    if (other.key === it.key || !other.collides || other.hidden) continue;
    if (other.supportId === it.id || it.supportId === other.id) continue;
    const theirs = itemBoxes(other);
    let hit = false;
    for (const a of mine) {
      for (const b of theirs) {
        const zo = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        if (zo > 0.1 && obbPenetration(a.o, b.o) > 0.1) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) hits.push(other);
  }
  return hits;
}

/** Items this item currently overlaps (only possible after a swap to a bigger option). */
export function currentOverlaps(items, it) {
  if (!it.collides) return [];
  return overlapPairs(items, it, it.pose, it.baseZ);
}

/**
 * Can `it` stand at `pose`? Walls and the room outline are hard limits. Furniture blocks too,
 * except pieces it already overlapped before the move, so an overlap left by a swap can be
 * dragged apart.
 */
export function checkPose(room, items, it, pose, prevPose = it.pose) {
  const baseZ = baseZFor(items, it, pose);
  const ed = effDims(it, pose);
  if (it.mount === 'floor') {
    for (const b of itemBoxes(it, pose, baseZ)) if (!obbInsideRegion(b.o, room.regions)) return { ok: false, reason: 'wall' };
    if (baseZ + it.dims.h > room.ceiling + 0.01) return { ok: false, reason: 'ceiling' };
  } else if (it.mount === 'wall') {
    const wall = room.walls.get(it.wallId);
    const { along } = wallCoords(wall, pose.x, pose.y);
    if (along - ed.w / 2 < -0.01 || along + ed.w / 2 > wall.len + 0.01) return { ok: false, reason: 'wall-end' };
    if (pose.z - ed.h / 2 < -0.01 || pose.z + ed.h / 2 > room.ceiling + 0.01) return { ok: false, reason: 'ceiling' };
  } else if (it.mount === 'top') {
    const sup = supportOf(items, it);
    if (sup && !itemBoxes(sup).some((b) => pointInObb(pose.x, pose.y, b.o))) return { ok: false, reason: 'support' };
  }
  if (it.collides) {
    const now = overlapPairs(items, it, pose, baseZ);
    if (now.length) {
      const before = new Set(overlapPairs(items, it, prevPose, baseZFor(items, it, prevPose)).map((o) => o.key));
      const blockers = now.filter((o) => !before.has(o.key));
      if (blockers.length) return { ok: false, reason: 'furniture', blockers };
    }
  }
  return { ok: true };
}

function pointInObb(x, y, o) {
  const dx = x - o.cx, dy = y - o.cy;
  return Math.abs(dx * o.ux[0] + dy * o.ux[1]) <= o.hw + 1e-6 && Math.abs(dx * o.uy[0] + dy * o.uy[1]) <= o.hd + 1e-6;
}

// ---------------------------------------------------------------------------------------------
// Edits. Each returns { ok, ... } and mutates the layout (the caller re-renders and saves).

function posesOf(layout, it) {
  return it.kind === 'product' ? layout.slots[it.id].poses : layout.existing[it.id].poses;
}

function setPose(layout, items, it, pose) {
  const old = it.pose;
  const poses = posesOf(layout, it);
  poses[it.index] = pose;
  it.pose = pose;
  // Pieces resting on this one move and turn with it.
  const dRot = pose.rot - old.rot;
  for (const dep of dependentsOf(items, it)) {
    const rel = rotate2(dep.pose.x - old.x, dep.pose.y - old.y, dRot);
    setPose(layout, items, dep, { ...dep.pose, x: pose.x + rel.x, y: pose.y + rel.y, rot: normDeg(dep.pose.rot + dRot) });
  }
  resolveSupports(items);
}

/**
 * Slide an item toward a target in small steps; when blocked it slides along the obstacle
 * (tries each axis alone), so it can never jump through a wall or another piece.
 * target: {x, y} for floor/top items, {along, z} for wall items.
 */
export function moveToward(room, layout, items, it, target) {
  if (it.mount === 'hidden') return { ok: false, reason: 'hidden' };
  const wall = it.mount === 'wall' ? room.walls.get(it.wallId) : null;
  const toPose = (a, b) => {
    if (!wall) return { ...it.pose, x: a, y: b };
    const p = pointAlong(wall, a);
    const off = wallCoords(wall, it.pose.x, it.pose.y).off;
    return { ...it.pose, x: p.x + wall.normal.x * off, y: p.y + wall.normal.y * off, z: b };
  };
  let [ca, cb] = wall ? [wallCoords(wall, it.pose.x, it.pose.y).along, it.pose.z] : [it.pose.x, it.pose.y];
  const [ta, tb] = wall ? [target.along, target.z] : [target.x, target.y];
  const start = it.pose;
  let lastBlock = null;
  for (let iter = 0; iter < 600; iter++) {
    const da = ta - ca, db = tb - cb;
    const dist = Math.hypot(da, db);
    if (dist < 0.01) break;
    const k = Math.min(1, 1.5 / dist);
    const cands = [[ca + da * k, cb + db * k], [ca + da * k, cb], [ca, cb + db * k]];
    let moved = false;
    for (const [a, b] of cands) {
      if (Math.abs(a - ca) < 1e-6 && Math.abs(b - cb) < 1e-6) continue;
      const pose = toPose(a, b);
      const r = checkPose(room, items, it, pose, it.pose);
      if (r.ok) { ca = a; cb = b; it.pose = pose; moved = true; break; }
      lastBlock = r;
    }
    if (!moved) break;
  }
  const end = it.pose;
  it.pose = start;
  if (end !== start) setPose(layout, items, it, end);
  const reached = Math.hypot((wall ? wallCoords(wall, end.x, end.y).along : end.x) - ta, (wall ? end.z : end.y) - tb) < 0.05;
  return { ok: true, moved: end !== start, reached, blocked: reached ? null : lastBlock };
}

/** Turn a floor/top item by stepDeg (wall items: quarter turn in the wall plane). */
export function rotateItem(room, layout, items, it, stepDeg) {
  if (it.mount === 'hidden') return { ok: false, reason: 'hidden' };
  const pose = it.mount === 'wall'
    ? { ...it.pose, spin: ((it.pose.spin || 0) + (stepDeg > 0 ? 90 : 270)) % 360 }
    : { ...it.pose, rot: normDeg(it.pose.rot + stepDeg) };
  const r = checkPose(room, items, it, pose, it.pose);
  if (!r.ok) return r;
  setPose(layout, items, it, pose);
  return { ok: true };
}

export function resetItemPose(cat, layout, items, it) {
  const def = it.kind === 'product' ? defaultSlotPoses(cat, it.slot, it.product.id)[it.index] : defaultExistingPoses(it.piece)[it.index];
  setPose(layout, items, it, { ...def });
}

/** Replace the slot's product in place. Alternates keep the slot's center; walls are hard limits. */
export function swapOption(cat, layout, slotId, productId) {
  const slot = cat.slots.get(slotId);
  if (productId !== null && !slot.options.includes(productId)) throw new Error(`${productId} is not an option of ${slotId}`);
  const sel = layout.slots[slotId];
  const want = defaultSlotPoses(cat, slot, productId ?? slot.default_option);
  const poses = want.map((p, i) => sel.poses[i] && i < slot.placements.length ? sel.poses[i] : p);
  layout.slots[slotId] = { option: productId, poses };
  if (productId === null) return { ok: true };
  const room = cat.rooms.get(slot.room);
  const items = buildItems(cat, layout, slot.room);
  const changed = [];
  for (const it of items.filter((i) => i.id === slotId)) {
    const fixed = fitInsideRoom(room, items, it);
    if (fixed) { layout.slots[slotId].poses[it.index] = fixed; it.pose = fixed; changed.push(it.key); }
  }
  // Things resting on this slot stay on the (possibly smaller) new top.
  resolveSupports(items);
  for (const it of items.filter((i) => i.supportId === slotId)) {
    const sup = supportOf(items, it);
    const b = itemBoxes(sup)[0].o;
    const rel = rotate2(it.pose.x - b.cx, it.pose.y - b.cy, -sup.pose.rot);
    const cx = Math.max(-b.hw, Math.min(b.hw, rel.x)), cy = Math.max(-b.hd, Math.min(b.hd, rel.y));
    if (cx !== rel.x || cy !== rel.y) {
      const back = rotate2(cx, cy, sup.pose.rot);
      layout.slots[it.id].poses[it.index] = { ...it.pose, x: b.cx + back.x, y: b.cy + back.y };
    }
  }
  return { ok: true, adjusted: changed };
}

/** If an item pokes through a wall/ceiling, shift it the shortest distance back inside (ignores furniture). */
export function fitInsideRoom(room, items, it) {
  const inside = (pose) => {
    if (it.mount === 'floor') return itemBoxes(it, pose, 0).every((b) => obbInsideRegion(b.o, room.regions));
    if (it.mount === 'wall') {
      const wall = room.walls.get(it.wallId);
      const ed = effDims(it, pose);
      const { along } = wallCoords(wall, pose.x, pose.y);
      return along - ed.w / 2 >= -0.01 && along + ed.w / 2 <= wall.len + 0.01 && pose.z - ed.h / 2 >= -0.01 && pose.z + ed.h / 2 <= room.ceiling + 0.01;
    }
    return true;
  };
  if (inside(it.pose)) return null;
  const wall = it.mount === 'wall' ? room.walls.get(it.wallId) : null;
  for (let r = 0.25; r <= 48; r += 0.25) {
    const dirs = wall ? [[wall.dir.x, wall.dir.y, 0], [-wall.dir.x, -wall.dir.y, 0], [0, 0, 1], [0, 0, -1]] : [];
    if (!wall) for (let a = 0; a < 360; a += 15) dirs.push([Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180), 0]);
    for (const [dx, dy, dz] of dirs) {
      const pose = { ...it.pose, x: it.pose.x + dx * r, y: it.pose.y + dy * r, z: it.pose.z + dz * r };
      if (inside(pose)) return pose;
    }
  }
  return null;
}

export function setExistingHidden(layout, id, hidden) {
  if (layout.existing[id]) layout.existing[id].hidden = hidden;
}

export { wallFacingYaw };
