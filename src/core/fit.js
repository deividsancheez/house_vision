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
    out.push({ id: c.check, label: friendlyCheck(c.check), zone: c.zone, obb: rectToObb(c.zone), window, sill });
  }
  return out;
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
        const top = Math.max(...boxes.filter((b) => obbPenetration(b.o, z.obb) > 0.05).map((b) => b.z1), -Infinity);
        if (top > (z.sill ?? 0) + 0.01) add({ type: 'zone', key: it.key, zoneId: z.id, zone: z.zone, message: `${short(it)} stands taller than the window sill (${z.sill}") in front of the window` });
        continue;
      }
      if (it.mount !== 'floor' || it.isRug || !it.collides) continue;
      if (boxes.some((b) => obbPenetration(b.o, z.obb) > 0.05)) add({ type: 'zone', key: it.key, zoneId: z.id, zone: z.zone, message: `${short(it)} is in the ${z.label}` });
    }
    for (const other of currentOverlaps(items, it)) {
      if (other.key < it.key) continue; // report each pair once
      add({ type: 'overlap', key: it.key, other: other.key, message: `${short(it)} overlaps ${short(other)}` });
    }
    if (it.mount === 'wall' && !['curtain', 'rod'].includes(it.productKind)) {
      const wall = room.walls.get(it.wallId);
      const ed = effDims(it);
      const { along } = wallCoords(wall, it.pose.x, it.pose.y);
      const a0 = along - ed.w / 2, a1 = along + ed.w / 2, z0 = it.pose.z - ed.h / 2, z1 = it.pose.z + ed.h / 2;
      for (const o of wall.openings) {
        const oz0 = o.sill_z ?? 0, oz1 = o.head_z ?? o.height ?? room.ceiling;
        if (Math.min(a1, o.along_to) - Math.max(a0, o.along_from) > 0.05 && Math.min(z1, oz1) - Math.max(z0, oz0) > 0.05) {
          add({ type: 'opening', key: it.key, message: `${short(it)} covers the ${openingName(o)}` });
        }
      }
    }
    if (it.unsupported) add({ type: 'support', key: it.key, message: `${short(it)} has nothing to sit on (its ${it.supportId} was removed)` });
  }
  return warnings;
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
