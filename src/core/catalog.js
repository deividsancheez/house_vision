// Indexes room-spec.json + products.json into lookup tables the rest of the app uses.
// Nothing here invents measurements: every number comes from the two JSON files.
import { pointInPolygon } from './geom.js';

export async function loadCatalog(base = 'data/') {
  const [spec, products] = await Promise.all(
    ['room-spec.json', 'products.json'].map(async (f) => {
      const res = await fetch(base + f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${f} (${res.status})`);
      return res.json();
    }),
  );
  return buildCatalog(spec, products);
}

export function buildCatalog(spec, productsDoc) {
  const problems = [];
  const rooms = new Map();
  for (const r of spec.rooms) rooms.set(r.id, { ...indexRoom(r, problems), lights: spec.lighting?.[r.id] || [] });

  const products = new Map(productsDoc.products.map((p) => [p.id, p]));
  const slots = new Map(productsDoc.slots.map((s) => [s.slot_id, s]));
  const slotsByRoom = {};
  for (const s of productsDoc.slots) {
    (slotsByRoom[s.room] ||= []).push(s);
    if (!rooms.has(s.room)) problems.push(`Slot ${s.slot_id}: unknown room "${s.room}"`);
    for (const o of s.options) if (!products.has(o)) problems.push(`Slot ${s.slot_id}: option ${o} is not in products`);
    if (!s.options.includes(s.default_option)) problems.push(`Slot ${s.slot_id}: default ${s.default_option} is not one of its options`);
    if (!s.placements?.length) problems.push(`Slot ${s.slot_id}: no placements`);
    if (s.mount === 'wall' && !rooms.get(s.room)?.walls.has(s.wall)) problems.push(`Slot ${s.slot_id}: unknown wall ${s.wall}`);
  }
  for (const p of productsDoc.products) {
    if (!slots.has(p.slot)) problems.push(`Product ${p.id}: slot ${p.slot} does not exist`);
    const d = p.dimensions_in;
    if (!d || !(d.w > 0 && d.d > 0 && d.h > 0)) problems.push(`Product ${p.id}: missing dimensions`);
    if (typeof p.price !== 'number') problems.push(`Product ${p.id}: missing price`);
  }

  const existing = new Map(spec.existing_pieces.map((e) => [e.id, e]));
  const existingByRoom = {};
  for (const e of spec.existing_pieces) (existingByRoom[e.room] ||= []).push(e);

  return {
    spec,
    productsDoc,
    rooms,
    products,
    slots,
    slotsByRoom,
    existing,
    existingByRoom,
    lighting: spec.lighting,
    budgetMeta: productsDoc.budget,
    taxRate: productsDoc.tax_rate ?? productsDoc.budget?.tax_rate,
    problems,
  };
}

function indexRoom(r, problems) {
  const poly = r.floor_polygon.map((p) => ({ x: p.x, y: p.y }));
  const walls = new Map();
  for (const w of r.walls) {
    const dx = w.to.x - w.from.x, dy = w.to.y - w.from.y;
    const len = Math.hypot(dx, dy);
    if (Math.abs(len - w.length) > 0.5) problems.push(`Wall ${w.id}: endpoints give ${len.toFixed(1)}" but length says ${w.length}"`);
    const dir = { x: dx / len, y: dy / len };
    // Inward normal: whichever perpendicular points into the floor polygon.
    let normal = { x: -dir.y, y: dir.x };
    const mx = (w.from.x + w.to.x) / 2, my = (w.from.y + w.to.y) / 2;
    if (!pointInPolygon(mx + normal.x * 2, my + normal.y * 2, poly)) normal = { x: dir.y, y: -dir.x };
    walls.set(w.id, { ...w, len, dir, normal, open: !!w.open, openings: [], fixtures: [] });
  }
  for (const o of r.openings) {
    const w = walls.get(o.wall);
    if (!w) { problems.push(`Opening ${o.id}: unknown wall ${o.wall}`); continue; }
    w.openings.push(o);
  }
  for (const e of [...(r.electrical || []), ...(r.hvac || [])]) {
    if (!e.wall) continue;
    const w = walls.get(e.wall);
    if (w) w.fixtures.push(e);
    else problems.push(`${e.id}: unknown wall ${e.wall}`);
  }

  // Extra floor that belongs to the room but sits outside the drawn outline: a closet recess
  // (opening type "closet" with a depth). Items such as the hamper live there.
  const extraRegions = [];
  for (const o of r.openings) {
    if (o.type !== 'closet' || !o.depth) continue;
    const w = walls.get(o.wall);
    const a = pointAlong(w, o.along_from), b = pointAlong(w, o.along_to);
    const out = { x: -w.normal.x * o.depth, y: -w.normal.y * o.depth };
    extraRegions.push([a, b, { x: b.x + out.x, y: b.y + out.y }, { x: a.x + out.x, y: a.y + out.y }]);
  }
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return {
    ...r,
    poly,
    walls,
    regions: [poly, ...extraRegions],
    extraRegions,
    ceiling: r.ceiling_height.value,
    bounds: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
  };
}

export function pointAlong(wall, along) {
  return { x: wall.from.x + wall.dir.x * along, y: wall.from.y + wall.dir.y * along };
}

/** Yaw (deg) that turns an object's front (+y local) to face into the room from this wall. */
export function wallFacingYaw(wall) {
  // local +y rotated by yaw = (-sin, cos) must equal the inward normal
  return Math.round((Math.atan2(-wall.normal.x, wall.normal.y) * 180) / Math.PI);
}

/** Distance along the wall of a room point, and its signed distance from the wall plane (into the room). */
export function wallCoords(wall, x, y) {
  const vx = x - wall.from.x, vy = y - wall.from.y;
  return { along: vx * wall.dir.x + vy * wall.dir.y, off: vx * wall.normal.x + vy * wall.normal.y };
}

export function roomOfProduct(cat, productId) {
  return cat.slots.get(cat.products.get(productId)?.slot)?.room;
}
