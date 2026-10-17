// Warnings that explain themselves: a title, what's wrong (with the real numbers from room-spec
// fit_checks, the openings and the piece's size), why it matters (one plain sentence per kind of
// warning) and how to fix it. Also the "dismiss" rules. No three.js.
//
// To change a sentence, edit WHY / the builders below. Every number shown comes from the data
// files or is measured from the layout (rounded to the inch or half inch).
import { effDims } from './items.js';

/** One plain sentence per kind of warning. */
export const WHY = {
  door: () => 'You couldn’t fully open the door.',
  walkway: (n) => (n ? `This path is planned ${n} in wide; anything in it makes it cramped and hard to pass.` : 'Anything in this path makes it cramped and hard to pass.'),
  hallway: () => 'It’s the way to the hallway (to the bedroom and bath), so it has to stay open.',
  kitchen: (n) => `You need this ${n ? `${n} in ` : ''}path to get from the dining nook into the kitchen.`,
  closet: (n, doors) => `You need ${n ? `${n} in ` : 'room '}in front of the closet to open its ${doors || 'doors'} and reach inside.`,
  chair: (n) => `The desk chair needs ${n ? `${n} in ` : 'room '}behind it to roll back so you can stand up.`,
  window: (sill) => `Anything taller than the ${sill} in window sill blocks light and the view.`,
  overlap: () => 'Two pieces can’t fill the same space, so this layout couldn’t be set up for real.',
  'opening-window': () => 'It would block light and the view.',
  'opening-door': () => 'You couldn’t use the door.',
  opening: () => 'It would cover the opening.',
  support: () => 'It needs something to rest on.',
};

/** Round a length for display: whole inches, "less than 1" below that. */
export function inches(v) {
  if (v < 0.95) return 'less than 1';
  return String(Math.round(v));
}
const num = (v) => String(Math.round(v * 10) / 10);
/** Lower-case the first letter of a sentence-case name ("Queen bed frame" -> "queen bed frame"),
 *  but leave names that start with a brand or acronym ("UCLA flag", "LAUTERS ...") alone. */
const lc = (s) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]*[A-Z]/.test(s.split(' ')[0]) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** A piece's name for sentences: product names as sold, owned pieces in lower case. */
export function nameOf(it) {
  if (!it) return 'piece';
  const n = (it.kind === 'product' ? it.product.name : it.piece.name).split(/[,(]/)[0].trim();
  return it.kind === 'product' ? n : lc(n);
}
const the = (it) => `the ${nameOf(it)}`;
const sizeOf = (it) => { const d = effDims(it); return `${num(d.w)} x ${num(d.d)} x ${num(d.h)} in`; };

/** The number in a check's text like 'walkway: ... (36")' or 'closet access (30" in front ...)'. */
export function checkWidth(check) {
  const m = /(\d+(?:\.\d+)?)"/.exec(check || '');
  return m ? Number(m[1]) : null;
}

/** The opening (door / cased opening) a zone belongs to: the one whose middle is on the zone's edge. */
export function openingForZone(room, zone, types) {
  for (const o of room.openings) {
    if (!types.includes(o.type)) continue;
    const w = room.walls.get(o.wall);
    const mid = (o.along_from + o.along_to) / 2;
    const p = { x: w.from.x + w.dir.x * mid, y: w.from.y + w.dir.y * mid };
    if (p.x >= Math.min(zone.x0, zone.x1) - 0.5 && p.x <= Math.max(zone.x0, zone.x1) + 0.5 && p.y >= Math.min(zone.y0, zone.y1) - 0.5 && p.y <= Math.max(zone.y0, zone.y1) + 0.5) return o;
  }
  return null;
}

function walkwaySubkind(check) {
  if (/hallway/i.test(check)) return 'hallway';
  if (/kitchen/i.test(check)) return 'kitchen';
  if (/closet access/i.test(check)) return 'closet';
  if (/chair/i.test(check)) return 'chair';
  return 'walkway';
}

/** Short place name from a check's text: 'walkway: behind sectional, door to dining/hall (36")' -> 'behind sectional, door to dining/hall'. */
function placeOf(check) {
  return check.replace(/^walkway:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Signature of a warning, for dismissing it: same kind, same piece, same zone/opening/other piece. */
export function warningSig(w) {
  const ref = w.zoneId || w.other || w.openingId || w.supportId || '';
  return `${w.type}|${w.key}|${ref}`;
}

/**
 * Explain one warning from fit.computeWarnings. items: the room's items (to name pieces).
 * Returns {sig, amount, kind, title, what, why, fix, highlight} where highlight is what "Show me"
 * marks: {zone} on the floor, {wallId, along, zRange} on a wall, or {keys} (pieces).
 */
export function explainWarning(cat, roomId, w, items) {
  const room = cat.rooms.get(roomId);
  const it = items.find((i) => i.key === w.key);
  const base = { sig: warningSig(w), amount: w.amount ?? 0, key: w.key, type: w.type, room: roomId };
  if (w.type === 'zone' && w.kind === 'door') {
    const o = openingForZone(room, w.zone, ['door']);
    const doorName = placeOf(w.zoneId).replace(/\s*swing$/i, '');
    const r = o?.swing_radius ?? o?.width;
    return { ...base, kind: 'door', title: `Blocks the ${doorName} swing`,
      what: `${cap(the(it))} sits ${inches(w.depth)} in inside the area the ${doorName} needs to open${r ? ` (${r} in swing)` : ''}.`,
      why: WHY.door(), fix: `Move it about ${inches(w.depth)} in out of the marked area, or store it (F).`, highlight: { zone: w.zone } };
  }
  if (w.type === 'zone' && w.kind === 'window') {
    const win = room.openings.find((o) => o.type === 'window');
    const strip = checkWidth(w.zoneId);
    const top = w.top;
    return { ...base, kind: 'window', title: 'Blocks the window',
      what: `${cap(the(it))} reaches ${num(top)} in high, ${inches(top - w.sill)} in above the ${w.sill} in sill, inside the ${strip ? `${strip} in ` : ''}strip in front of ${win?.id || 'the window'}.`,
      why: WHY.window(w.sill), fix: `Move it out of the marked strip, or pick something under ${w.sill} in tall there.`, highlight: { zone: w.zone } };
  }
  if (w.type === 'zone') {
    const sub = walkwaySubkind(w.zoneId);
    const n = checkWidth(w.zoneId);
    const place = placeOf(w.zoneId);
    const closet = room.openings.find((o) => o.type === 'closet');
    const hall = sub === 'hallway' ? openingForZone(room, w.zone, ['cased opening']) : null;
    const title = { hallway: 'Blocks the way to the hallway', kitchen: 'Blocks the way to the kitchen', closet: 'Blocks the closet', chair: 'Crowds the desk chair', walkway: `Narrows the walkway ${place}` }[sub];
    const where = { hallway: `the space in front of the hallway opening${hall ? ` (${hall.width} in wide)` : ''}`, kitchen: `the ${place}`, closet: `the ${place}`, chair: `the ${n ? `${n} in ` : ''}clearance behind the desk chair`, walkway: `the walkway ${place}` }[sub];
    const why = sub === 'closet' ? WHY.closet(n, closet?.lower?.type) : WHY[sub](n);
    return { ...base, kind: 'walkway', sub, title,
      what: `${cap(the(it))} (${sizeOf(it)}) sits ${inches(w.depth)} in into ${where}.`,
      why, fix: `Move it about ${inches(w.depth)} in out of the marked area, or store it (F).`, highlight: { zone: w.zone } };
  }
  if (w.type === 'overlap') {
    const other = items.find((i) => i.key === w.other);
    return { ...base, kind: 'overlap', title: `Overlaps the ${nameOf(other)}`,
      what: `${cap(the(it))} and ${the(other)} overlap by ${inches(w.depth)} in.`,
      why: WHY.overlap(), fix: `Move one of them about ${inches(w.depth)} in apart, or swap to a smaller option.`, highlight: { keys: [w.key, w.other] } };
  }
  if (w.type === 'opening') {
    const o = room.openings.find((x) => x.id === w.openingId);
    const what = o?.type === 'window' ? 'window' : o?.type === 'door' ? 'door' : 'opening';
    const covered = w.along[1] - w.along[0];
    return { ...base, kind: 'opening', title: `Covers the ${what}`,
      what: `${cap(the(it))} (${sizeOf(it)}) covers ${inches(covered)} in of the ${what} ${w.openingId} along the wall.`,
      why: (WHY[`opening-${what}`] || WHY.opening)(), fix: `Slide it about ${inches(w.depth)} in along the wall, or hang it on another wall.`,
      highlight: { wallId: w.wallId, along: w.along, zRange: w.zRange, keys: [w.key] } };
  }
  if (w.type === 'support') {
    const sup = cat.existing.get(w.supportId)?.name || cat.slots.get(w.supportId)?.label || w.supportId;
    return { ...base, kind: 'support', title: 'Has nothing to sit on',
      what: `${cap(the(it))} rests on the ${lc(sup.split(/[,(]/)[0].trim())}, which isn’t in this room.`,
      why: WHY.support(), fix: `Put the ${lc(sup.split(/[,(]/)[0].trim())} back in this room, or store this piece too (F).`, highlight: { keys: [w.key] } };
  }
  return { ...base, kind: w.type, title: 'Fit warning', what: w.message, why: '', fix: '', highlight: { keys: [w.key] } };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A problem comes back after it was dismissed if it got worse by more than this (inches). */
export const COME_BACK_IN = 2;

/** Is this explained warning dismissed in the layout? (A different zone has a different signature.) */
export function isDismissed(layout, ex) {
  const d = (layout.dismissed || []).find((x) => x.sig === ex.sig);
  return !!d && ex.amount <= d.amount + COME_BACK_IN;
}

export function dismiss(layout, ex) {
  layout.dismissed = (layout.dismissed || []).filter((x) => x.sig !== ex.sig);
  layout.dismissed.push({ sig: ex.sig, amount: Math.round(ex.amount * 100) / 100, title: ex.title });
}

export function restore(layout, sig) {
  layout.dismissed = (layout.dismissed || []).filter((x) => x.sig !== sig);
}

/** All warnings of a room, explained and split into active and dismissed. */
export function roomWarnings(cat, layout, roomId, items, warnings) {
  const all = warnings.map((w) => explainWarning(cat, roomId, w, items));
  return { active: all.filter((e) => !isDismissed(layout, e)), dismissed: all.filter((e) => isDismissed(layout, e)), all };
}
