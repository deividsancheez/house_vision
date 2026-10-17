// Goals and the room score (0-100). Every goal is computed from the data files and the layout;
// nothing is made up. To add a goal: add an entry to GOALS (points must still add up to 100) and
// compute it in roomGoals below.
import { buildItems, productKind, poseRef } from './items.js';
import { zonesForRoom } from './fit.js';
import { computeWarnings } from './fit.js';
import { computeBudget, fmtMoney } from './budget.js';

/** Points per goal. Partial goals (walkways, door swings, windows, lighting) earn their share. */
export const GOALS = [
  { id: 'walkways', label: 'Walkways clear', points: 25, help: 'Every walkway and clearance in room-spec fit_checks has nothing standing in it.' },
  { id: 'doors', label: 'Door swings clear', points: 20, help: 'Every door swing in fit_checks is clear, so each door opens all the way.' },
  { id: 'windows', label: 'Windows clear', points: 15, help: 'Nothing taller than the sill stands in the strip in front of the window.' },
  { id: 'budget', label: 'On budget', points: 15, help: 'The total (both rooms) is at or under the budget cap in products.json.' },
  { id: 'lighting', label: 'Lamps in place', points: 10, help: 'Every lamp and sconce slot of the room has its piece placed.' },
  { id: 'placed', label: 'Everything placed', points: 5, help: 'Nothing from this room is waiting in the inventory.' },
  { id: 'slots', label: 'Every slot filled', points: 5, help: 'Every slot of the room has a product.' },
  { id: 'warnings', label: 'All warnings fixed', points: 5, help: 'No fit warnings in the room. Dismissed warnings still count as not fixed.' },
];

const LAMP_KINDS = new Set(['floorlamp', 'tablelamp', 'sconce', 'desklamp']);

/** Lamp and sconce slots of a room (by the kind of their products). */
export function lampSlots(cat, roomId) {
  return (cat.slotsByRoom[roomId] || []).filter((s) => s.options.every((pid) => LAMP_KINDS.has(productKind(cat.products.get(pid)))));
}

/**
 * The goals of one room: [{id, label, points, earned, done, detail, help}] and score (0-100).
 * The budget goal uses the whole plan's total; everything else looks at this room.
 */
export function roomGoals(cat, layout, roomId) {
  const items = buildItems(cat, layout, roomId);
  const warnings = computeWarnings(cat, roomId, items);
  const zones = zonesForRoom(cat, roomId);
  const blocked = new Set(warnings.filter((w) => w.type === 'zone').map((w) => w.zoneId));
  const share = (list) => ({ n: list.length, ok: list.filter((z) => !blocked.has(z.id)).length });
  const walk = share(zones.filter((z) => z.kind === 'walkway'));
  const doors = share(zones.filter((z) => z.kind === 'door'));
  const wins = share(zones.filter((z) => z.kind === 'window'));
  const b = computeBudget(cat, layout);
  const lamps = lampSlots(cat, roomId);
  const lampOk = lamps.filter((s) => { const sel = layout.slots[s.slot_id]; return sel.option && sel.poses.every((p) => !p.stored); }).length;
  const waiting = layout.inventory.filter((g) => g.from === roomId).reduce((a, g) => a + g.keys.length, 0);
  const slots = cat.slotsByRoom[roomId] || [];
  const filled = slots.filter((s) => layout.slots[s.slot_id].option).length;
  const frac = { walkways: walk, doors, windows: wins, lighting: { n: lamps.length, ok: lampOk } };
  const detail = {
    walkways: `${walk.ok} of ${walk.n} clear`,
    doors: `${doors.ok} of ${doors.n} clear`,
    windows: `${wins.ok} of ${wins.n} clear`,
    budget: `${fmtMoney(b.totalCents)} of ${fmtMoney(b.capCents)}`,
    lighting: `${lampOk} of ${lamps.length} placed`,
    placed: waiting ? `${waiting} piece${waiting > 1 ? 's' : ''} in the inventory` : 'inventory empty',
    slots: `${filled} of ${slots.length} filled`,
    warnings: warnings.length ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : 'none',
  };
  const doneOf = {
    walkways: walk.ok === walk.n, doors: doors.ok === doors.n, windows: wins.ok === wins.n, budget: !b.over,
    lighting: lampOk === lamps.length, placed: waiting === 0, slots: filled === slots.length, warnings: warnings.length === 0,
  };
  const goals = GOALS.map((g) => {
    const f = frac[g.id];
    const part = f ? (f.n ? f.ok / f.n : 1) : doneOf[g.id] ? 1 : 0;
    return { ...g, earned: g.points * part, done: doneOf[g.id], detail: detail[g.id] };
  });
  const score = Math.round(goals.reduce((a, g) => a + g.earned, 0));
  return { goals, score };
}

/** Score of a room for the designer's default layout (the first "best"). */
export function scoreOf(cat, layout, roomId) {
  return roomGoals(cat, layout, roomId).score;
}

export { poseRef };
