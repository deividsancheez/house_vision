import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog } from '../../src/core/catalog.js';
import { computeBudget, fmtMoney } from '../../src/core/budget.js';
import { defaultLayout, buildItems, checkPose, moveToward, swapOption, rotateItem, currentOverlaps, normalizeLayout, productKind } from '../../src/core/items.js';
import { computeWarnings } from '../../src/core/fit.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const cat = () => buildCatalog(read('room-spec.json'), read('products.json'));

test('input files index without problems', () => {
  const c = cat();
  assert.deepEqual(c.problems, []);
  assert.equal(c.products.size, 49);
  assert.equal(c.slots.size, 30);
});

test('default layout budget is exactly $1,018.17', () => {
  const c = cat();
  const b = computeBudget(c, defaultLayout(c));
  assert.equal(b.taxedCents, 71815);
  assert.equal(b.untaxedCents, 23000);
  assert.equal(b.taxCents, 7002);
  assert.equal(fmtMoney(b.totalCents), '$1,018.17');
  assert.equal(b.over, true);
  assert.equal(fmtMoney(b.remainingCents), '-$18.17');
});

test('budget swap combinations', () => {
  const c = cat();
  const expect = (swaps) => {
    const l = defaultLayout(c);
    for (const [s, p] of swaps) swapOption(c, l, s, p);
    // independent recomputation straight from products.json
    let taxed = 0, used = 0;
    for (const s of c.productsDoc.slots) {
      const pid = l.slots[s.slot_id].option;
      if (!pid) continue;
      const p = c.products.get(pid);
      const cents = Math.round(p.price * 100) * p.qty;
      if (p.taxed) taxed += cents; else used += cents;
    }
    const total = taxed + used + Math.round(taxed * 0.0975);
    return [computeBudget(c, l).totalCents, total];
  };
  // 1) rug B + coffee B (used) : taxed 718.15-149.99+249.99=818.15 -> tax 79.77; used 230-45+100=285
  let [got, want] = expect([['LR-RUG', 'LR-RUG-B'], ['LR-COFFEE', 'LR-COFFEE-B']]);
  assert.equal(got, want); assert.equal(got, 81815 + 28500 + 7977);
  // 2) remove WiFi cabinet: $25 used item off -> 993.17, under budget
  [got] = expect([['LR-WIFI', null]]);
  assert.equal(got, 99317);
  // 3) curtains B, sconce B, desk chair B, nightstand B
  [got, want] = expect([['LR-CURTAIN', 'LR-CURTAIN-B'], ['LR-SCONCE', 'LR-SCONCE-B'], ['BR-CHAIR', 'BR-CHAIR-B'], ['BR-NIGHTSTAND', 'BR-NIGHTSTAND-B']]);
  assert.equal(got, want);
  // 4) every slot set to its last option
  [got, want] = expect([...c.slots.values()].map((s) => [s.slot_id, s.options.at(-1)]));
  assert.equal(got, want);
});

test('default layout: everything inside, nothing overlapping, no fit warnings', () => {
  const c = cat();
  const l = defaultLayout(c);
  for (const roomId of ['living', 'bedroom']) {
    const room = c.rooms.get(roomId);
    const items = buildItems(c, l, roomId);
    for (const it of items) {
      const r = checkPose(room, items, it, it.pose);
      assert.ok(r.ok, `${it.key} invalid at default pose: ${JSON.stringify(r.reason)} ${r.blockers?.map((b) => b.key)}`);
      assert.deepEqual(currentOverlaps(items, it).map((o) => o.key), [], `${it.key} overlaps`);
    }
    assert.deepEqual(computeWarnings(c, roomId, items).map((w) => w.message), []);
  }
});

test('moving the floor lamp into the front door swing warns but is allowed', () => {
  const c = cat();
  const l = defaultLayout(c);
  const room = c.rooms.get('living');
  let items = buildItems(c, l, 'living');
  // Remove the sectional from the path so the lamp can travel along the window wall.
  const lamp = items.find((i) => i.key === 'LR-FLOORLAMP#0');
  // walk it down the gap between window wall and sectional (x 4..36), then into the door swing
  moveToward(room, l, items, lamp, { x: 22, y: 16 });
  moveToward(room, l, items, lamp, { x: 22, y: 140 });
  items = buildItems(c, l, 'living');
  const w = computeWarnings(c, 'living', items);
  assert.ok(w.some((x) => /front door swing/.test(x.message)), JSON.stringify(w.map((x) => x.message)));
});

test('items cannot pass through walls or furniture', () => {
  const c = cat();
  const l = defaultLayout(c);
  const room = c.rooms.get('living');
  const items = buildItems(c, l, 'living');
  const table = items.find((i) => i.key === 'LR-COFFEE#0');
  // drag the coffee table north through the TV console and the north wall
  const r = moveToward(room, l, items, table, { x: 124, y: -50 });
  assert.equal(r.reached, false);
  const after = buildItems(c, l, 'living');
  for (const it of after) assert.deepEqual(currentOverlaps(after, it), []);
  const t = after.find((i) => i.key === 'LR-COFFEE#0');
  assert.ok(t.pose.y - 18 >= 18 - 0.01 || t.pose.x - 18 >= 150 || t.pose.x + 18 <= 98, `table ended inside the console at ${JSON.stringify(t.pose)}`);
  // the candle on the table moved with it
  const candle = after.find((i) => i.key === 'LR-DECOR#0');
  assert.ok(Math.abs(candle.pose.y - (t.pose.y - 0.03)) < 0.1);
});

test('rotation is blocked when it would hit a wall', () => {
  const c = cat();
  const l = defaultLayout(c);
  const room = c.rooms.get('bedroom');
  const items = buildItems(c, l, 'bedroom');
  const desk = items.find((i) => i.key === 'BR-DESK#0');
  const r = rotateItem(room, l, items, desk, 90); // 44" desk turned to stick out from the wall, hits chair/wall
  assert.equal(r.ok, false);
});

test('swapping WiFi cabinet B keeps it inside the walls and reports the overlap', () => {
  const c = cat();
  const l = defaultLayout(c);
  swapOption(c, l, 'LR-WIFI', 'LR-WIFI-B');
  const items = buildItems(c, l, 'living');
  const cab = items.find((i) => i.key === 'LR-WIFI#0');
  assert.ok(cab.pose.x + 12 <= 222.01);
  const w = computeWarnings(c, 'living', items);
  assert.ok(w.some((x) => x.type === 'overlap'));
});

test('product kinds cover every product', () => {
  const c = cat();
  for (const p of c.products.values()) assert.notEqual(productKind(p), 'box', p.id);
});

test('normalizeLayout drops unknown ids', () => {
  const c = cat();
  const l = defaultLayout(c);
  l.slots['NOPE'] = { option: 'X', poses: [] };
  l.slots['LR-RUG'].option = 'LR-RUG-Z';
  const { layout, dropped } = normalizeLayout(c, l);
  assert.equal(layout.slots['LR-RUG'].option, 'LR-RUG-A');
  assert.ok(dropped.includes('NOPE') && dropped.includes('LR-RUG-Z'));
});
