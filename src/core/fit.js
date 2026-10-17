// Fit warnings, from room-spec.json "fit_checks" plus the placement rules.
// A warning never blocks placement; it only tells the owner what the move breaks.
import { obbPenetration, rectToObb } from './geom.js';
import { itemBoxes, currentOverlaps, effDims } from './items.js';
import { wallCoords } from './catalog.js';

/** Parse the fit_checks that carry a zone rectangle for this room. */
export function zonesForRoom(cat, roomId) {
  const room = cat.rooms.get(roomId);
  const out = [];
  for (const c of cat.spec.fit_checks?.checks || []) {
    if (c.room !== roomId || !c.zone) continue;
    const window = /sill/i.test(c.check);
    let sill = null;
    if (window) {
      const win = room.openings.find((o) => o.type === 'window');
      sill = win?.sill_z ?? null;
      const m = /sill (\d+(?:\.\d+)?) in/i.exec(c.detail || '');
      if (m) sill = Number(m[1]);
    }
    out.push({ id: c.check, check: c.check, label: friendlyCheck(c.check), kind: zoneKind(c.check, window), zone: c.zone, obb: rectToObb(c.zone), window, sill });
  }
  return out;
}

/** What a fit_checks zone protects: 'window', 'door' (a door swing) or 'walkway' (walkways and
 *  clearances: hallway approach, kitchen/closet access, room behind the desk chair). */
export function zoneKind(check, window = /sill/i.test(check)) {
  if (window) return 'window';
  if (/door swing/i.test(check)) return 'door';
  return 'walkway';
}

export function friendlyCheck(text) {
  return text
    .replace(/^walkway:\s*/i, 'walkway ')
    .replace(/\(24" zone\)/, '(24" in front of the window)')
    .replace(/^nothing above the sill in front of (\S+)/i, 'window zone: nothing taller than the sill in front of $1');
}

/**
 * Warnings for the current items of one room:
 *  - a floor piece inside a door swing / walkway / closet-access / chair-clearance zone
 *  - anything taller than the sill inside a window zone
 *  - pieces overlapping each other (possible after swapping to a bigger option)
 *  - wall pieces over a door, window or opening (curtains and rods excepted)
 *  - something whose support was removed
 */
export function computeWarnings(cat, roomId, items) {
  const room = cat.rooms.get(roomId);
  const zones = zonesForRoom(cat, roomId);
  const warnings = [];
  const add = (w) => warnings.push(w);
  for (const it of items) {
    if (it.hidden) continue;
    const boxes = itemBoxes(it);
    for (const z of zones) {
      if (z.window) {
        if (it.mount === 'wall' || it.isRug) continue;
        const inZone = boxes.filter((b) => obbPenetration(b.o, z.obb) > 0.05);
        const top = Math.max(...inZone.map((b) => b.z1), -Infinity);
        if (top > (z.sill ?? 0) + 0.01) add({ type: 'zone', kind: 'window', key: it.key, zoneId: z.id, zone: z.zone, top, sill: z.sill, depth: Math.max(...inZone.map((b) => obbPenetration(b.o, z.obb))), amount: top - (z.sill ?? 0), message: `${short(it)} stands taller than the window sill (${z.sill}") in front of the window` });
        continue;
      }
      if (it.mount !== 'floor' || it.isRug || !it.collides) continue;
      const depth = Math.max(...boxes.map((b) => obbPenetration(b.o, z.obb)));
      if (depth > 0.05) add({ type: 'zone', kind: z.kind, key: it.key, zoneId: z.id, zone: z.zone, depth, amount: depth, message: `${short(it)} is in the ${z.label}` });
    }
    for (const other of currentOverlaps(items, it)) {
      if (other.key < it.key) continue; // report each pair once
      const depth = overlapDepth(it, other);
      add({ type: 'overlap', key: it.key, other: other.key, depth, amount: depth, message: `${short(it)} overlaps ${short(other)}` });
    }
    if (it.mount === 'wall' && !['curtain', 'rod'].includes(it.productKind)) {
      const wall = room.walls.get(it.wallId);
      const ed = effDims(it);
      const { along } = wallCoords(wall, it.pose.x, it.pose.y);
      const a0 = along - ed.w / 2, a1 = along + ed.w / 2, z0 = it.pose.z - ed.h / 2, z1 = it.pose.z + ed.h / 2;
      for (const o of wall.openings) {
        const oz0 = o.sill_z ?? 0, oz1 = o.head_z ?? o.height ?? room.ceiling;
        const da = Math.min(a1, o.along_to) - Math.max(a0, o.along_from), dz = Math.min(z1, oz1) - Math.max(z0, oz0);
        if (da > 0.05 && dz > 0.05) {
          // how far it must slide along the wall to clear the opening (the shorter way)
          const slide = Math.min(a1 - o.along_from, o.along_to - a0);
          add({ type: 'opening', key: it.key, openingId: o.id, openingType: o.type, wallId: wall.id, along: [Math.max(a0, o.along_from), Math.min(a1, o.along_to)], zRange: [Math.max(z0, oz0), Math.min(z1, oz1)], depth: slide, amount: slide, message: `${short(it)} covers the ${openingName(o)}` });
        }
      }
    }
    if (it.unsupported) add({ type: 'support', key: it.key, supportId: it.supportId, amount: 0, message: `${short(it)} has nothing to sit on (its ${it.supportId} was removed)` });
  }
  return warnings;
}

/** Deepest overlap (inches) between the boxes of two items that also overlap in height. */
function overlapDepth(a, b) {
  let d = 0;
  for (const p of itemBoxes(a)) for (const q of itemBoxes(b)) {
    if (Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0) > 0.1) d = Math.max(d, obbPenetration(p.o, q.o));
  }
  return d;
}

function openingName(o) {
  if (o.type === 'window') return `window (${o.id})`;
  if (o.type === 'door') return `door (${o.id})`;
  return `${o.type} (${o.id})`;
}

function short(it) {
  const n = it.kind === 'product' ? it.product.name : it.piece.name;
  return n.split(/[,(]/)[0].trim();
}
