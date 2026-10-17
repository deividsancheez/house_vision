// Walk mode core: body collisions, start spots, the doorway link, aiming, carrying previews,
// inventory + budget, warning explanations and dismissals, goals and score, undo/redo, old layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog } from '../../src/core/catalog.js';
import { computeBudget } from '../../src/core/budget.js';
import { defaultLayout, buildItems, normalizeLayout, pieceByKey, poseRef, roomOfKey, swapOption } from '../../src/core/items.js';
import { computeWarnings } from '../../src/core/fit.js';
import { WALK, outlineSegments, bodyObstacles, stepBody, startPose, arrivalPose, doorwayHit, nearDoorway, roomSurfaces, aimAt, fwdOf, bodyClear, onRug } from '../../src/core/walk.js';
import { previewPlacement, isSmall } from '../../src/core/carry.js';
import { storePiece, placePieces, removeFromPlan, addFromCatalog, catalogEntries, storedEntries, filterCards, ungroup } from '../../src/core/inventory.js';
import { explainWarning, isDismissed, dismiss, restore, roomWarnings } from '../../src/core/explain.js';
import { roomGoals, GOALS } from '../../src/core/goals.js';
import { History } from '../../src/core/history.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const spec = read('room-spec.json');
const cat = () => buildCatalog(spec, read('products.json'));
const zoneOf = (check) => spec.fit_checks.checks.find((c) => c.check === check).zone;

function world(c, l, roomId) {
  const room = c.rooms.get(roomId);
  const items = buildItems(c, l, roomId);
  return { room, segs: outlineSegments(room), obstacles: bodyObstacles(items, WALK.eyeHeight + WALK.headroom), r: WALK.radius, items };
}
/** Walk with a fixed wanted direction for `secs` at 60 steps a second. */
function walkFor(st, dir, secs, w, run = false) {
  let s = { ...st, vx: 0, vy: 0 };
  const contacts = [];
  for (let i = 0; i < secs * 60; i++) { s = stepBody(s, { ...dir, run }, 1 / 60, w); contacts.push(...s.contacts); }
  return { ...s, contacts };
}

test('start spots: just past the door, facing into the room, clear of the door swing and furniture', () => {
  const c = cat(), l = defaultLayout(c);
  const lr = startPose(c, 'living', buildItems(c, l, 'living'));
  // living: +x is west (room-spec origin.axes), so facing west is yaw -90 (looking along +x)
  assert.deepEqual(fwdOf(lr.yaw).x.toFixed(3), '1.000');
  const swing = zoneOf('front door swing');
  assert.ok(lr.x - WALK.radius >= swing.x1, `living start ${lr.x} clears the ${swing.x1}" swing`);
  assert.ok(lr.y > swing.y0 && lr.y < swing.y1, 'in line with the front door');
  const br = startPose(c, 'bedroom', buildItems(c, l, 'bedroom'));
  assert.equal(fwdOf(br.yaw).x.toFixed(3), '1.000'); // bedroom: +x is south
  const bs = zoneOf('bedroom door swing');
  assert.ok(br.x - WALK.radius >= bs.x1);
  for (const [roomId, p] of [['living', lr], ['bedroom', br]]) {
    const w = world(c, l, roomId);
    assert.ok(bodyClear(p, WALK.radius, w.room, w.segs, w.obstacles), `${roomId} start is clear`);
  }
});

test('walls, furniture and the kitchen edge stop the body', () => {
  const c = cat(), l = defaultLayout(c);
  const w = world(c, l, 'living');
  // east (front door wall, -x): stops one radius from the wall
  let s = walkFor({ x: 48, y: 140 }, { x: -1, y: 0 }, 3, w);
  assert.ok(Math.abs(s.x - WALK.radius) < 0.05, `stopped at x=${s.x}`);
  // north into the sectional (its back at y=124)
  s = walkFor({ x: 100, y: 140 }, { x: 0, y: -1 }, 3, w);
  assert.ok(Math.abs(s.y - (124 + WALK.radius)) < 0.05, `stopped at y=${s.y}`);
  // the kitchen edge (open, x=113 beside the dining nook) stops you too, and says so
  s = walkFor({ x: 125, y: 180 }, { x: -1, y: 0 }, 3, w);
  assert.ok(Math.abs(s.x - (113 + WALK.radius)) < 0.05, `kitchen edge at x=${s.x}`);
  assert.ok(s.contacts.some((k) => k.open), 'contact with the open kitchen edge');
  // running is faster than walking (4 ft/s vs 7 ft/s), with smooth acceleration
  const a = walkFor({ x: 30, y: 140 }, { x: 1, y: 0 }, 1, w);
  const b = walkFor({ x: 30, y: 140 }, { x: 1, y: 0 }, 1, w, true);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - WALK.walkSpeed) < 0.01 && Math.abs(Math.hypot(b.vx, b.vy) - WALK.runSpeed) < 0.01);
  assert.ok(a.x - 30 < WALK.walkSpeed, 'accelerates: less than a full second of top speed');
  // a rug and pillows never block
  assert.ok(!w.obstacles.some((o) => /RUG|PILLOW|THROW|CURTAIN/.test(o.key)));
  // nowhere does a random walk end inside furniture or outside the outline
  let p = { x: 48, y: 140, vx: 0, vy: 0 };
  for (let i = 0; i < 4000; i++) {
    const a2 = Math.sin(i * 0.37) * 3 + i * 0.01;
    p = stepBody(p, { x: Math.cos(a2), y: Math.sin(a2), run: i % 3 === 0 }, 1 / 30, w);
    assert.ok(bodyClear(p, WALK.radius - 0.05, w.room, w.segs, w.obstacles), `step ${i} at ${p.x},${p.y}`);
  }
});

test('the bedroom closet is walkable only up to its front', () => {
  const c = cat(), l = defaultLayout(c);
  const w = world(c, l, 'bedroom');
  const s = walkFor({ x: 95, y: 120 }, { x: 0, y: 1 }, 3, w);
  assert.ok(Math.abs(s.y - (136 - WALK.radius)) < 0.05, `stops at the closet front, y=${s.y}`);
});

test('doorway link: hallway opening <-> bedroom door, with labels', () => {
  const c = cat(), l = defaultLayout(c);
  const w = world(c, l, 'living');
  const arrive = arrivalPose(c, 'living', 'LR-HALL', w.items);
  assert.equal(fwdOf(arrive.yaw).x.toFixed(3), '-1.000', 'facing east (-x in the living room)');
  assert.equal(nearDoorway(c, 'living', arrive)?.label, 'To bedroom');
  assert.equal(doorwayHit(c, 'living', arrive, { x: -1, y: 0 }), null, 'walking away does nothing');
  const s = walkFor(arrive, { x: 1, y: 0 }, 1, w);
  const hit = doorwayHit(c, 'living', s, { x: 1, y: 0 });
  assert.equal(hit?.toRoom, 'bedroom');
  assert.equal(hit.toOpening, 'BR-DOOR');
  // and back
  const wb = world(c, l, 'bedroom');
  const inBed = arrivalPose(c, 'bedroom', 'BR-DOOR', wb.items);
  assert.equal(nearDoorway(c, 'bedroom', inBed)?.label, 'To living room');
  const s2 = walkFor(inBed, { x: -1, y: 0 }, 2, wb);
  assert.equal(doorwayHit(c, 'bedroom', s2, { x: -1, y: 0 })?.toOpening, 'LR-HALL');
  // the front door and the closet door are not linked
  const front = walkFor({ x: 48, y: 140 }, { x: -1, y: 0 }, 2, w);
  assert.equal(doorwayHit(c, 'living', front, { x: -1, y: 0 }), null);
});

test('aiming picks the piece in front, and a pillow over the sofa under it', () => {
  const c = cat(), l = defaultLayout(c);
  const items = buildItems(c, l, 'living');
  const surf = roomSurfaces(c.rooms.get('living'));
  const eye = { x: 112, y: 140, z: 68 };
  const toward = (p) => { const d = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z }; const n = Math.hypot(d.x, d.y, d.z); return { x: d.x / n, y: d.y / n, z: d.z / n }; };
  // the pillow on the long leg (center 140,102.5, 19-39 high) wins over the sectional around it
  assert.equal(aimAt(items, surf, eye, toward({ x: 140, y: 102.5, z: 30 }))?.key, 'LR-PILLOW-NEUTRAL#0');
  // the sectional's arm with nothing on it
  assert.equal(aimAt(items, surf, eye, toward({ x: 160, y: 110, z: 30 }))?.key, 'EX-LR-SECTIONAL#0');
  // more than 8 ft away: nothing
  assert.equal(aimAt(items, surf, { x: 200, y: 240, z: 68 }, toward({ x: 56, y: 16, z: 30 })), null);
  // on the rug with nothing standing there
  assert.ok(onRug(items, { x: 140, y: 80 }) && !onRug(items, { x: 48, y: 140 }));
});

function carryCtx(c, l, roomId, key, body, aimPoint, extra = {}) {
  const items = buildItems(c, l, roomId);
  const it = pieceByKey(c, l, key);
  const deps = items.filter((o) => o.supportId === it.id && it.index === 0);
  const skip = new Set([key, ...deps.map((d) => d.key)]);
  const eye = { x: body.x, y: body.y, z: 68 };
  const d = { x: aimPoint.x - eye.x, y: aimPoint.y - eye.y, z: aimPoint.z - eye.z };
  const n = Math.hypot(d.x, d.y, d.z);
  const dir = { x: d.x / n, y: d.y / n, z: d.z / n };
  const yaw = (Math.atan2(-dir.x, dir.y) * 180) / Math.PI;
  return { cat: c, roomId, items: items.filter((o) => !skip.has(o.key)), it, deps, surfaces: roomSurfaces(c.rooms.get(roomId)), eye, dir, yaw, relRot: 0, body, ...extra };
}

test('carrying: green, yellow (with the warning title) and red previews', () => {
  const c = cat(), l = defaultLayout(c);
  // small floor lamp? no: 59" tall -> carried as a ghost. A small piece (the hamper) lands where you aim.
  assert.equal(isSmall(pieceByKey(c, l, 'LR-FLOORLAMP#0')), false);
  assert.equal(isSmall(pieceByKey(c, l, 'BR-NIGHTSTAND#0')), true);
  // floor lamp ahead of you in open floor west of the sectional: green
  let p = previewPlacement(carryCtx(c, l, 'living', 'LR-FLOORLAMP#0', { x: 120, y: 150 }, { x: 190, y: 150, z: 0 }));
  assert.equal(p.status, 'warn', 'in the walkway behind the sectional: fits, with a warning');
  assert.match(p.warnings.map((w) => explainWarning(c, 'living', w, buildItems(c, l, 'living').map((i) => (i.key === w.key ? { ...i, pose: p.pose } : i))).title).join(), /walkway/i);
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-FLOORLAMP#0', { x: 180, y: 40 }, { x: 180, y: 120, z: 0 }));
  assert.equal(p.status, 'warn'); // walkway west of the sectional to the hallway
  // on the rug between the coffee table and the TV wall's west end: clear
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-FLOORLAMP#0', { x: 187, y: 50 }, { x: 100, y: 50, z: 0 }));
  assert.deepEqual([p.pose.x, p.pose.y], [145, 50]);
  assert.equal(p.status, 'ok', JSON.stringify(p.warnings.map((w) => w.message)));
  // into the front door swing: yellow, "Blocks the front door swing"
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-FLOORLAMP#0', { x: 60, y: 140 }, { x: 0, y: 140, z: 0 }));
  assert.equal(p.status, 'warn');
  const items = buildItems(c, l, 'living').map((i) => (i.key === 'LR-FLOORLAMP#0' ? { ...i, pose: p.pose } : i));
  const ex = p.warnings.map((w) => explainWarning(c, 'living', w, items));
  assert.ok(ex.some((e) => e.title === 'Blocks the front door swing'), ex.map((e) => e.title).join());
  // into the sectional: red, refused with a reason
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-FLOORLAMP#0', { x: 100, y: 140 }, { x: 100, y: 100, z: 0 }));
  assert.equal(p.status, 'bad');
  assert.match(p.reason, /sectional/i);
  // a wall piece goes flat on the wall you face, at its height
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-ART#0', { x: 150, y: 140 }, { x: 150, y: 261, z: 60 }));
  assert.equal(p.wallId, 'LR-W-SOUTH');
  assert.equal(p.pose.z, 57);
  // through the kitchen edge there's no wall to hang it on
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-ART#0', { x: 140, y: 200 }, { x: 0, y: 200, z: 60 }));
  assert.equal(p.status, 'bad');
  assert.match(p.reason, /kitchen/i);
  // a lamp needs its table: aimed at the floor it is refused
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-TABLELAMP#0', { x: 150, y: 150 }, { x: 150, y: 175, z: 0 }));
  assert.equal(p.status, 'bad');
  p = previewPlacement(carryCtx(c, l, 'living', 'LR-TABLELAMP#0', { x: 150, y: 170 }, { x: 160, y: 210, z: 30 }));
  assert.equal(p.status, 'ok');
  // the nightstand carries its lamp and candle along
  p = previewPlacement(carryCtx(c, l, 'bedroom', 'BR-NIGHTSTAND#0', { x: 30, y: 110 }, { x: 60, y: 110, z: 0 }));
  assert.notEqual(p.status, 'bad', p.reason);
  assert.deepEqual(p.deps.map((d) => d.key).sort(), ['BR-BEDLAMP#0', 'BR-DECOR#0']);
});

test('inventory: store keeps the budget, remove lowers it, Catalog adds the price with tax', () => {
  const c = cat(), l = defaultLayout(c);
  const total = () => computeBudget(c, l).totalCents;
  assert.equal(total(), 101817);
  // 1) store the nightstand: lamp and candle go with it, budget unchanged
  const r = storePiece(c, l, 'bedroom', 'BR-NIGHTSTAND#0');
  assert.deepEqual(r.keys, ['BR-NIGHTSTAND#0', 'BR-BEDLAMP#0', 'BR-DECOR#0']);
  assert.equal(total(), 101817);
  assert.equal(buildItems(c, l, 'bedroom').some((i) => i.key === 'BR-NIGHTSTAND#0'), false);
  assert.equal(storedEntries(c, l)[0].members.length, 2);
  // 2) place the group in the living room
  const it = pieceByKey(c, l, 'BR-NIGHTSTAND#0');
  placePieces(c, l, 'living', [{ key: it.key, pose: { ...it.pose, x: 205, y: 250, rot: 0 } }, ...['BR-BEDLAMP#0', 'BR-DECOR#0'].map((k) => ({ key: k, pose: { ...poseRef(l, k), x: 205, y: 250 } }))]);
  assert.equal(roomOfKey(c, l, 'BR-NIGHTSTAND#0'), 'living');
  assert.equal(roomOfKey(c, l, 'BR-BEDLAMP#0'), 'living');
  assert.equal(l.inventory.length, 0);
  assert.ok(buildItems(c, l, 'living').some((i) => i.key === 'BR-BEDLAMP#0' && !i.unsupported));
  assert.equal(total(), 101817);
  // 3) store, then remove the WiFi cabinet from the plan: -$25 (used, no tax)
  storePiece(c, l, 'living', 'LR-WIFI#0');
  assert.equal(total(), 101817);
  const rm = removeFromPlan(c, l, 'LR-WIFI#0');
  assert.ok(rm.ok);
  assert.equal(total(), 99317);
  assert.equal(l.inventory.length, 0);
  assert.ok(catalogEntries(c, l).some((e) => e.productId === 'LR-WIFI-A'), 'back in the Catalog');
  // 4) Catalog: TARVA nightstand, new, $79.99 + tax as an extra next to the nightstand slot's pick
  const tarva = catalogEntries(c, l).find((e) => e.productId === 'BR-NIGHTSTAND-B');
  const before = total();
  const add = addFromCatalog(c, l, 'BR-NIGHTSTAND-B');
  assert.equal(total() - before, tarva.addCents);
  // $79.99 plus the tax it adds to the taxed subtotal (same rounding as the budget)
  assert.equal(tarva.addCents, 7999 + Math.floor(((71815 + 7999) * 975 + 5000) / 10000) - Math.floor((71815 * 975 + 5000) / 10000));
  assert.ok(!catalogEntries(c, l).some((e) => e.productId === 'BR-NIGHTSTAND-B'));
  assert.equal(l.inventory[0].keys[0], add.keys[0]);
  // existing pieces can't be removed
  assert.equal(removeFromPlan(c, l, 'EX-LR-SECTIONAL#0').ok, false);
  // swap works on a stored piece: rug B while the rug is stored keeps it stored
  storePiece(c, l, 'living', 'LR-RUG#0');
  swapOption(c, l, 'LR-RUG', 'LR-RUG-B');
  assert.equal(poseRef(l, 'LR-RUG#0').stored, true);
  // search, filter and sort
  const cards = catalogEntries(c, l);
  assert.ok(filterCards(cards, { q: 'stoense' }).length === 0, 'rug B is in the plan now');
  assert.ok(filterCards(cards, { q: 'ikea' }).every((x) => /ikea/i.test(x.brand)));
  assert.ok(filterCards(cards, { condition: 'used' }).every((x) => x.condition === 'used'));
  assert.ok(filterCards(cards, { room: 'bedroom' }).every((x) => x.homeRoom === 'bedroom'));
  // the Catalog sorts and filters on the price it shows: +$X with tax
  const byPrice = filterCards(cards, { sort: 'price' }).map((x) => x.addCents);
  assert.deepEqual(byPrice, [...byPrice].sort((a, b) => a - b));
  assert.ok(filterCards(cards, { min: 50, max: 100 }).every((x) => x.addCents >= 5000 && x.addCents <= 10000));
});

test('ungroup splits a stored group', () => {
  const c = cat(), l = defaultLayout(c);
  storePiece(c, l, 'living', 'LR-COFFEE#0');
  assert.deepEqual(l.inventory[0].keys, ['LR-COFFEE#0', 'LR-DECOR#0']);
  assert.ok(ungroup(l, l.inventory[0].uid));
  assert.deepEqual(l.inventory.map((g) => g.keys), [['LR-COFFEE#0'], ['LR-DECOR#0']]);
  assert.notEqual(l.inventory[0].uid, l.inventory[1].uid);
});

test('warnings explain themselves with the real numbers', () => {
  const c = cat(), l = defaultLayout(c);
  const set = (key, xy) => Object.assign(poseRef(l, key), xy);
  // floor lamp (24x24) 6" into the front door swing (zone x 0-36): center at x = 36 - 6 + 12
  set('LR-FLOORLAMP#0', { x: 42, y: 140 });
  let items = buildItems(c, l, 'living');
  let w = computeWarnings(c, 'living', items);
  let ex = w.map((x) => explainWarning(c, 'living', x, items));
  const door = ex.find((e) => e.kind === 'door');
  assert.equal(door.title, 'Blocks the front door swing');
  assert.equal(door.what, 'The LAUTERS floor lamp sits 6 in inside the area the front door needs to open (36 in swing).');
  assert.equal(door.why, 'You couldn’t fully open the door.');
  assert.match(door.fix, /6 in/);
  assert.deepEqual(door.highlight.zone, zoneOf('front door swing'));
  // the same lamp is also in the 36" walkway behind the sectional
  const walk = ex.find((e) => e.kind === 'walkway');
  assert.match(walk.why, /36 in wide/);
  // window: the lamp (59" tall) in front of the window LR-WIN-1 (sill 30)
  set('LR-FLOORLAMP#0', { x: 22, y: 20 });
  items = buildItems(c, l, 'living');
  ex = computeWarnings(c, 'living', items).map((x) => explainWarning(c, 'living', x, items));
  const win = ex.find((e) => e.kind === 'window');
  assert.equal(win.title, 'Blocks the window');
  assert.match(win.what, /59 in high, 29 in above the 30 in sill, inside the 24 in strip in front of the window/);
  assert.equal(win.why, 'Anything taller than the 30 in window sill blocks light and the view.');
  // overlap (WiFi cabinet B is bigger and overlaps the plant)
  const l2 = defaultLayout(c);
  swapOption(c, l2, 'LR-WIFI', 'LR-WIFI-B');
  items = buildItems(c, l2, 'living');
  ex = computeWarnings(c, 'living', items).map((x) => explainWarning(c, 'living', x, items));
  const ov = ex.find((e) => e.kind === 'overlap');
  assert.match(ov.title, /^Overlaps the /);
  assert.match(ov.what, /overlap by \d+ in\./);
  // a picture over the window
  const l3 = defaultLayout(c);
  Object.assign(poseRef(l3, 'LR-ART#0'), { wall: 'LR-W-EAST', x: 0.75, y: 60, z: 57, rot: -90 });
  items = buildItems(c, l3, 'living');
  ex = computeWarnings(c, 'living', items).map((x) => explainWarning(c, 'living', x, items));
  const op = ex.find((e) => e.kind === 'opening');
  assert.equal(op.title, 'Covers the window');
  assert.match(op.what, /covers 48 in of the window along the wall/);
  // support: the coffee table stored away leaves the candle with nothing under it? No: it goes along.
  // Removing the table from the plan leaves the candle unsupported.
  const l4 = defaultLayout(c);
  swapOption(c, l4, 'LR-COFFEE', null);
  items = buildItems(c, l4, 'living');
  ex = computeWarnings(c, 'living', items).map((x) => explainWarning(c, 'living', x, items));
  const sup = ex.find((e) => e.kind === 'support');
  assert.equal(sup.title, 'Has nothing to sit on');
  assert.ok(ex.every((e) => e.title && e.what && e.why && e.fix));
});

test('dismissed warnings stay dismissed until the problem changes', () => {
  const c = cat(), l = defaultLayout(c);
  const at = (x) => { Object.assign(poseRef(l, 'LR-FLOORLAMP#0'), { x, y: 140 }); const items = buildItems(c, l, 'living'); return roomWarnings(c, l, 'living', items, computeWarnings(c, 'living', items)); };
  let r = at(42);
  const door = r.active.find((e) => e.kind === 'door');
  dismiss(l, door);
  r = at(42);
  assert.ok(r.dismissed.some((e) => e.sig === door.sig) && !r.active.some((e) => e.sig === door.sig));
  r = at(40); // 2" deeper: still dismissed (not worse by more than 2)
  assert.ok(!r.active.some((e) => e.sig === door.sig));
  r = at(37); // 5" deeper: back
  assert.ok(r.active.some((e) => e.sig === door.sig));
  dismiss(l, r.active.find((e) => e.sig === door.sig));
  restore(l, door.sig);
  assert.ok(at(37).active.some((e) => e.sig === door.sig));
  assert.equal(isDismissed(l, door), false);
});

test('goals and score: the designer layout scores 85 in each room, and changes recompute', () => {
  const c = cat(), l = defaultLayout(c);
  assert.equal(GOALS.reduce((a, g) => a + g.points, 0), 100);
  for (const roomId of ['living', 'bedroom']) {
    const g = roomGoals(c, l, roomId);
    assert.equal(g.score, 85, roomId);
    assert.deepEqual(g.goals.filter((x) => !x.done).map((x) => x.id), ['budget']);
  }
  // storing the desk lamp: lighting 1 of 2, inventory not empty -> 85 - 5 - 5
  storePiece(c, l, 'bedroom', 'BR-DESKLAMP#0');
  let g = roomGoals(c, l, 'bedroom');
  assert.equal(g.score, 75);
  // removing the WiFi cabinet: budget goal done in both rooms (+15)
  const l2 = defaultLayout(c);
  swapOption(c, l2, 'LR-WIFI', null);
  g = roomGoals(c, l2, 'living');
  assert.ok(g.goals.find((x) => x.id === 'budget').done);
  assert.equal(g.goals.find((x) => x.id === 'slots').done, false);
  assert.equal(g.score, 95);
  // a lamp in the front door swing: door swings 1 of 2 (-10), walkway 4 of 5 (-5), warnings (-5)
  const l3 = defaultLayout(c);
  Object.assign(poseRef(l3, 'LR-FLOORLAMP#0'), { x: 42, y: 140 });
  g = roomGoals(c, l3, 'living');
  assert.equal(g.score, 85 - 10 - 5 - 5);
});

test('undo/redo across 25 actions', () => {
  const c = cat(), l = defaultLayout(c);
  const h = new History();
  h.reset(l);
  const states = [JSON.stringify(l)];
  let cur = l;
  for (let i = 0; i < 25; i++) {
    poseRef(cur, 'LR-FLOORLAMP#0').x = 44 + i;
    h.record(cur, `move ${i}`);
    states.push(JSON.stringify(cur));
  }
  for (let i = 24; i >= 0; i--) { cur = h.undo(cur).layout; assert.equal(JSON.stringify(cur), states[i]); }
  assert.equal(h.undo(cur), null);
  for (let i = 1; i <= 25; i++) { cur = h.redo(cur).layout; assert.equal(JSON.stringify(cur), states[i]); }
  assert.equal(h.redo(cur), null);
});

test('old (version 1) layouts load; version 2 keeps inventory, extras and dismissed', () => {
  const c = cat();
  const v1 = defaultLayout(c);
  delete v1.extras; delete v1.inventory; delete v1.dismissed;
  v1.schema = 1;
  v1.slots['LR-RUG'].option = 'LR-RUG-B';
  const { layout, dropped } = normalizeLayout(c, v1);
  assert.deepEqual(dropped, []);
  assert.equal(layout.schema, 2);
  assert.equal(layout.slots['LR-RUG'].option, 'LR-RUG-B');
  assert.deepEqual([layout.extras, layout.inventory, layout.dismissed], [[], [], []]);
  const l = defaultLayout(c);
  storePiece(c, l, 'living', 'LR-COFFEE#0');
  addFromCatalog(c, l, 'LR-FLOORLAMP-B');
  dismiss(l, { sig: 'zone|LR-PLANT#0|front door swing', amount: 3, title: 'x' });
  const back = normalizeLayout(c, JSON.parse(JSON.stringify(l))).layout;
  assert.deepEqual(back, l);
  // junk is dropped, not guessed
  const bad = { ...JSON.parse(JSON.stringify(l)), extras: [{ uid: 'X9', product: 'NOPE' }], inventory: [{ uid: 'G1', keys: ['LR-RUG#0'] }] };
  const n = normalizeLayout(c, bad);
  assert.ok(n.dropped.includes('NOPE'));
  assert.ok(!n.layout.inventory.some((g) => g.keys.includes('LR-RUG#0')), 'the rug is not stored, so it is not in the inventory');
});
