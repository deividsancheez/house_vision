// The lookbook: products.json is valid, the cart math matches the designer's package totals, and the
// picks reach the 3D rooms (budget, slots, free placement, un-picking) without touching the 3D plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalog } from '../../src/core/catalog.js';
import { computeBudget, fmtMoney as fmt3d } from '../../src/core/budget.js';
import { defaultLayout, normalizeLayout, swapOption, buildItems } from '../../src/core/items.js';
import { syncLookbookProducts, canSwapInto, freeSlot, lookbookCards, findRef, lookbookLink } from '../../src/core/lookbook.js';
import { addLookbookFree, removeFromPlan, lookbookAddCents, catalogEntries } from '../../src/core/inventory.js';
import { emptyPicks, cleanPicks, pickRef, tryRef, parseRef, refsOf, refsInLayout } from '../../src/shared/lbstore.js';
import * as C from '../../src/lookbook/core.js';

const lbDir = new URL('../../../../Lookbook Handoff/', import.meta.url);
const read3d = (f) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const lbDoc = () => JSON.parse(fs.readFileSync(new URL('products.json', lbDir), 'utf8'));
const index = () => C.buildIndex(lbDoc(), read3d('products.json').slots);
const cat = (picks = emptyPicks()) => {
  const c = buildCatalog(read3d('room-spec.json'), read3d('products.json'), lbDoc());
  syncLookbookProducts(c, picks);
  return c;
};
const cents = (d) => Math.round(d * 100);
const halfUpTax = (taxed, rate) => Math.floor((taxed * Math.round(rate * 10000) + 5000) / 10000);

// ---------------------------------------------------------------------------------------------
// products.json

test('lookbook products.json is valid', (t) => {
  const d = lbDoc();
  const problems = [];
  const gaps = []; // empty text the designer left out: shown as nothing, never filled in, listed in the report
  const ids = new Set();
  const slots3d = new Set(read3d('products.json').slots.map((s) => s.slot_id));
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const isUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);
  const hasImage = (f) => typeof f === 'string' && fs.existsSync(new URL(f, lbDir));
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
  assert.equal(d.tax_rate, 0.0975);
  assert.equal(d.budget.aim_total, 1000);
  assert.equal(d.budget.hard_ceiling, 1200);
  for (const p of d.products) {
    const bad = (m) => problems.push(`${p.id}: ${m}`);
    if (ids.has(p.id)) bad('duplicate id');
    ids.add(p.id);
    if (!cats.has(p.category)) bad(`unknown category ${p.category}`);
    else if (!cats.get(p.category).product_ids.includes(p.id)) bad('not listed in its category');
    if (!['living', 'bedroom', 'both'].includes(p.room)) bad(`room ${p.room}`);
    for (const k of ['name', 'brand', 'store', 'why_this']) if (typeof p[k] !== 'string' || !p[k].trim()) bad(`missing ${k}`);
    if (typeof p.short_description !== 'string') bad('short_description');
    else if (!p.short_description.trim()) gaps.push(`${p.id}: no short_description`);
    if (!(typeof p.price === 'number' && p.price > 0)) bad('price');
    if (p.on_sale && !(p.regular_price > p.price)) bad('on sale without a higher regular price');
    if (!isDate(p.price_checked_date) || !isDate(p.stock_checked_date)) bad('checked dates');
    if (typeof p.in_stock !== 'boolean') bad('in_stock');
    if (!isUrl(p.product_url)) bad('product_url');
    if (p.backup_search_url !== null && !isUrl(p.backup_search_url)) bad('backup_search_url');
    if (!hasImage(p.image_file)) bad(`image ${p.image_file} missing`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(p.main_color_hex)) bad('main_color_hex');
    if (!['new', 'used'].includes(p.condition)) bad('condition');
    if (p.taxed !== (p.condition === 'new')) bad('taxed must be true for new and false for used');
    if (p.condition === 'used' && !p.used_label) bad('used without used_label');
    if (!(Number.isInteger(p.qty_suggested) && p.qty_suggested > 0)) bad('qty_suggested');
    if (!['slot', 'free placement'].includes(p.placement_3d)) bad(`placement_3d ${p.placement_3d}`);
    if (p.placement_3d === 'slot') for (const s of String(p.slot_3d || '').split('|')) if (!slots3d.has(s)) bad(`slot_3d ${s} is not a 3D slot`);
    if (p.model_3d_url !== null && !isUrl(p.model_3d_url)) bad('model_3d_url');
    for (const k of ['w_in', 'd_in', 'h_in']) { const v = p.dimensions?.[k]; if (v !== null && !(typeof v === 'number' && v > 0)) bad(`dimension ${k}=${v}`); }
    if (!Array.isArray(p.tags) || !Array.isArray(p.notes) || !Array.isArray(p.color_variants)) bad('tags/notes/color_variants must be arrays');
    for (const v of p.color_variants) {
      if (!v.color || !/^#[0-9A-Fa-f]{6}$/.test(v.hex)) bad(`variant ${v.color}: color/hex`);
      if (!isUrl(v.product_url)) bad(`variant ${v.color}: product_url`);
      if (!(typeof v.price === 'number' && v.price > 0)) bad(`variant ${v.color}: price`);
      if (!hasImage(v.image_file)) bad(`variant ${v.color}: image ${v.image_file} missing`);
      if (typeof v.in_stock !== 'boolean') bad(`variant ${v.color}: in_stock`);
    }
  }
  for (const c of d.categories) {
    for (const id of c.product_ids) if (!ids.has(id)) problems.push(`category ${c.id}: ${id} is not a product`);
    if (c.product_ids.length < 5 || c.product_ids.length > 7) problems.push(`category ${c.id}: ${c.product_ids.length} options (5-7 expected)`);
    if (!c.rule) gaps.push(`category ${c.id}: no rule note`);
  }
  for (const [id, pkg] of Object.entries(d.packages)) for (const it of pkg.items) if (!ids.has(it.id)) problems.push(`package ${id}: ${it.id} is not a product`);
  // the 3D plan's ids are kept: every 3D product id in the lookbook is the same product
  const p3 = new Map(read3d('products.json').products.map((p) => [p.id, p]));
  for (const p of d.products) if (p3.has(p.id) && !p.in_3d_plan) problems.push(`${p.id} is a 3D id but in_3d_plan is false`);
  for (const p of d.products) if (!p3.has(p.id) && !p.id.startsWith('LB-')) problems.push(`${p.id}: new products use LB- ids`);
  const insp = JSON.parse(fs.readFileSync(new URL('inspiration.json', lbDir), 'utf8'));
  for (const room of ['living', 'bedroom']) for (const x of insp[room]) if (!x.creator || !isUrl(x.source_url)) problems.push(`inspiration ${x.title}: creator/link`);
  assert.deepEqual(problems, []);
  for (const g of gaps) t.diagnostic(`data gap: ${g}`);
  fs.mkdirSync(new URL('../../test-results/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../../test-results/lookbook-data-gaps.json', import.meta.url), JSON.stringify(gaps, null, 2));
});

// ---------------------------------------------------------------------------------------------
// Cart math

test('package totals match the designer: $908.30, $988.16, $1,186.77', () => {
  const ix = index();
  const want = { save: '$908.30', balanced: '$988.16', upgrade: '$1,186.77' };
  for (const [id, total] of Object.entries(want)) {
    const t = C.packageTotals(ix, id);
    assert.equal(C.fmtMoney(t.totalCents), total, id);
    assert.ok(t.matchesStored, `${id} matches the stored subtotal, tax and total`);
    assert.equal(t.untaxedCents, cents(t.pkg.subtotal_used_untaxed));
  }
});

test('loading a package into My Picks gives the same totals and budget colors', () => {
  const ix = index();
  const want = { save: ['$908.30', 'ok'], balanced: ['$988.16', 'ok'], upgrade: ['$1,186.77', 'amber'] };
  for (const [id, [total, level]] of Object.entries(want)) {
    const { picks, problems } = C.packagePicks(ix, id);
    assert.deepEqual(problems, []);
    assert.equal(Object.keys(picks).length, ix.doc.packages[id].items.length, `${id}: every item has its own pick slot`);
    const t = C.cartTotals(ix, { picks, try3d: [] });
    assert.equal(C.fmtMoney(t.totalCents), total, id);
    assert.equal(t.level, level, id);
  }
});

/** The total of a mix, computed straight from products.json (independent of the app's code). */
function independentTotal(doc, mix) {
  const byId = new Map(doc.products.map((p) => [p.id, p]));
  let taxed = 0, used = 0, delivery = 0;
  for (const { id, qty, color } of mix) {
    const p = byId.get(id);
    const v = color ? p.color_variants.find((x) => x.color === color) : null;
    const line = cents(v ? v.price : p.price) * qty;
    if (p.taxed) taxed += line; else used += line;
    delivery += cents(p.delivery_fee || 0);
  }
  return taxed + used + halfUpTax(taxed, doc.tax_rate) + delivery;
}

test('custom mix 1: BALANCED with another rug color, more pillows and a used desk', () => {
  const ix = index();
  const doc = ix.doc;
  const { picks } = C.packagePicks(ix, 'balanced');
  const st = { picks: structuredClone(picks), try3d: [] };
  // a rug with a color variant in place of the living room rug
  const rug = doc.products.find((p) => p.category === 'LR-RUG' && p.color_variants.length);
  st.picks['LR-RUG@LR-RUG'] = { id: rug.id, qty: 1, color: rug.color_variants[0].color };
  const pillowKey = Object.keys(st.picks).find((k) => k.startsWith('PILLOW'));
  st.picks[pillowKey].qty += 2;
  const desk = doc.products.find((p) => p.category === 'BR-DESK' && p.condition === 'used');
  st.picks[Object.keys(st.picks).find((k) => k.startsWith('BR-DESK'))] = { id: desk.id, qty: 1, color: null };
  const mix = Object.values(st.picks);
  const t = C.cartTotals(ix, st);
  assert.equal(t.totalCents, independentTotal(doc, mix));
  assert.equal(t.lines.find((l) => l.key === 'LR-RUG@LR-RUG').unitCents, cents(rug.color_variants[0].price), 'the variant price is used');
  assert.equal(t.level, t.totalCents > 120000 ? 'red' : t.totalCents > 100000 ? 'amber' : 'ok');
});

test('custom mix 2: UPGRADE plus the delivery-fee rug and a bench goes red', () => {
  const ix = index();
  const doc = ix.doc;
  const { picks } = C.packagePicks(ix, 'upgrade');
  const st = { picks: structuredClone(picks), try3d: [] };
  const feeRug = doc.products.find((p) => p.delivery_fee);
  st.picks['LR-RUG@LR-RUG'] = { id: feeRug.id, qty: 1, color: null };
  const bench = doc.products.filter((p) => p.category === 'BENCH').sort((a, b) => b.price - a.price)[0];
  st.picks.BENCH = { id: bench.id, qty: 1, color: null };
  const t = C.cartTotals(ix, st);
  assert.equal(t.totalCents, independentTotal(doc, Object.values(st.picks)));
  assert.equal(t.deliveryCents, cents(feeRug.delivery_fee));
  assert.ok(t.totalCents > 120000, `total ${C.fmtMoney(t.totalCents)} is over $1,200`);
  assert.equal(t.level, 'red');
});

test('budget colors: $1,000.00 is fine, a cent over is amber, over $1,200 is red', () => {
  const ix = index();
  // a used product priced to hit an exact total (no tax): find any used product and scale qty
  const used = ix.doc.products.find((p) => p.condition === 'used' && cents(p.price) === 2500);
  assert.ok(used, 'a $25 used product');
  const at = (qty) => C.cartTotals(ix, { picks: { X: { id: used.id, qty, color: null } }, try3d: [] });
  assert.equal(at(40).totalCents, 100000);
  assert.equal(at(40).level, 'ok');
  assert.equal(at(41).level, 'amber');
  assert.equal(at(48).level, 'amber'); // exactly $1,200
  assert.equal(at(49).level, 'red');
});

test('tax rounds half up on the taxed subtotal only', () => {
  assert.equal(C.taxOf(64082, 0.0975), 6248); // SAVE: $640.82 -> $62.48
  assert.equal(C.taxOf(200, 0.0975), 20); // 19.5 -> 20
  assert.equal(C.taxOf(0, 0.0975), 0);
});

test('a color swatch swaps image, price, stock and Buy link', () => {
  const ix = index();
  const p = ix.doc.products.find((x) => x.color_variants.length);
  const v = p.color_variants[0];
  const shown = C.view(p, v.color);
  assert.deepEqual([shown.image, shown.price, shown.inStock, shown.url], [v.image_file, v.price, v.in_stock, v.product_url]);
  const main = C.view(p);
  assert.deepEqual([main.image, main.price, main.url], [p.image_file, p.price, p.product_url]);
});

test('filters: store, price range, Deal, Used, Top pick', () => {
  const ix = index();
  const all = ix.doc.products;
  const f = C.emptyFilters();
  assert.equal(all.filter((p) => C.matchesFilters(p, f)).length, all.length);
  assert.ok(all.filter((p) => C.matchesFilters(p, { ...f, used: true })).every((p) => p.condition === 'used'));
  assert.ok(all.filter((p) => C.matchesFilters(p, { ...f, top: true })).every((p) => p.tags.includes('Top pick')));
  assert.ok(all.filter((p) => C.matchesFilters(p, { ...f, stores: ['IKEA'] })).every((p) => p.store === 'IKEA'));
  assert.ok(all.filter((p) => C.matchesFilters(p, { ...f, min: 20, max: 50 })).every((p) => p.price >= 20 && p.price <= 50));
});

test('text: complete sentences only, entities decoded', () => {
  assert.equal(C.sentences('One. Two is $349.99 today. Three is cut off and', 2), 'One. Two is $349.99 today.');
  assert.equal(C.decodeEntities('Tom &amp; Jerry &#39;s'), "Tom & Jerry 's");
});

// ---------------------------------------------------------------------------------------------
// Shared picks storage

test('picks storage: cleaned, references round-trip', () => {
  const st = cleanPicks({ picks: { TRAY: { id: 'LB-TRAY-01', qty: 0 }, BAD: { qty: 2 } }, try3d: [{ id: 'LB-TRAY-01' }, { id: 'LB-VASE-01', color: '' }, { id: 'LB-VASE-01' }] });
  assert.deepEqual(st.picks, { TRAY: { id: 'LB-TRAY-01', qty: 1, color: null } });
  assert.equal(st.try3d.length, 2);
  const refs = refsOf(st);
  assert.deepEqual(refs.map((r) => r.ref), [pickRef('TRAY', 'LB-TRAY-01', null), tryRef('LB-VASE-01', null)], 'a tried product that is also picked shows once');
  assert.deepEqual(parseRef('lb:ROD@BR-ROD:LB-ROD-01:Black'), { pickKey: 'ROD@BR-ROD', tried: false, id: 'LB-ROD-01', color: 'Black' });
  assert.equal(parseRef('LR-RUG-A'), null);
});

// ---------------------------------------------------------------------------------------------
// In the 3D rooms

const BALANCED = () => ({ picks: C.packagePicks(index(), 'balanced').picks, try3d: [] });

test('picks never change the designer layout or its $1,018.17', () => {
  const c = cat(BALANCED());
  assert.ok(c.lookbookRefs.length > 20);
  assert.deepEqual(c.problems, []);
  assert.equal(fmt3d(computeBudget(c, defaultLayout(c)).totalCents), '$1,018.17');
  assert.equal(catalogEntries(c, defaultLayout(c)).filter((e) => e.productId.startsWith('lb:')).length, 0, 'picks are not in the Catalog tab');
  assert.equal(lookbookCards(c, defaultLayout(c)).length, c.lookbookRefs.length);
});

test('slot product: swap in, budget follows the lookbook price and its delivery fee', () => {
  const feeRug = lbDoc().products.find((p) => p.delivery_fee);
  const st = { picks: { 'LR-RUG@LR-RUG': { id: feeRug.id, qty: 1, color: null } }, try3d: [] };
  const c = cat(st);
  const ref = pickRef('LR-RUG@LR-RUG', feeRug.id, null);
  assert.ok(canSwapInto(c, ref, 'LR-RUG'));
  assert.ok(!canSwapInto(c, ref, 'BR-RUG'));
  const l = defaultLayout(c);
  const before = computeBudget(c, l);
  const old = c.products.get(l.slots['LR-RUG'].option);
  swapOption(c, l, 'LR-RUG', ref);
  const after = computeBudget(c, l);
  const dTaxed = cents(feeRug.price) - cents(old.price) * (old.qty ?? 1);
  assert.equal(after.taxedCents - before.taxedCents, dTaxed);
  assert.equal(after.deliveryCents - before.deliveryCents, cents(feeRug.delivery_fee));
  assert.equal(after.totalCents, after.taxedCents + after.untaxedCents + after.taxCents + after.deliveryCents);
  // true size from the lookbook
  assert.equal(c.products.get(ref).dimensions_in.w, feeRug.dimensions.w_in);
  // the layout survives a save/load
  assert.equal(normalizeLayout(c, JSON.parse(JSON.stringify(l))).layout.slots['LR-RUG'].option, ref);
});

test('free product: placed anywhere, counts in the budget, back to From lookbook when removed', () => {
  const tray = lbDoc().products.find((p) => p.id === 'LB-TRAY-01');
  const c = cat({ picks: { TRAY: { id: tray.id, qty: 1, color: null } }, try3d: [] });
  const ref = pickRef('TRAY', tray.id, null);
  const l = defaultLayout(c);
  const base = computeBudget(c, l).totalCents;
  const add = lookbookAddCents(c, l, c.products.get(ref));
  assert.equal(add, cents(tray.price) + (halfUpTax(computeBudget(c, l).taxedCents + cents(tray.price), 0.0975) - computeBudget(c, l).taxCents));
  assert.equal(freeSlot(c, c.products.get(ref), 'living').mount, 'surface', 'a tray goes on any surface');
  const r = addLookbookFree(c, l, ref, 'living');
  assert.ok(r.ok);
  assert.equal(computeBudget(c, l).totalCents, base + add);
  assert.equal(lookbookCards(c, l).length, 0, 'in the plan, so not in From lookbook');
  // set it on the coffee table
  const owner = r.owner;
  l.lookbook[0].poses[0] = { x: 100, y: 100, z: 0, rot: 0, spin: 0, on: null };
  const items = buildItems(c, normalizeLayout(c, l).layout, 'living');
  assert.ok(items.some((it) => it.key === `${owner}#0`));
  assert.ok(removeFromPlan(c, l, `${owner}#0`).ok);
  assert.equal(computeBudget(c, l).totalCents, base);
  assert.equal(lookbookCards(c, l).length, 1, 'back in From lookbook');
});

test('used product: no tax in the 3D budget', () => {
  const desk = lbDoc().products.find((p) => p.id === 'BR-DESK-B');
  const c = cat({ picks: { 'BR-DESK@BR-DESK': { id: desk.id, qty: 1, color: null } }, try3d: [] });
  const ref = pickRef('BR-DESK@BR-DESK', desk.id, null);
  const l = defaultLayout(c);
  swapOption(c, l, 'BR-DESK', null);
  const before = computeBudget(c, l);
  swapOption(c, l, 'BR-DESK', ref);
  const after = computeBudget(c, l);
  assert.equal(after.untaxedCents - before.untaxedCents, cents(desk.price));
  assert.equal(after.taxCents, before.taxCents);
});

test('un-picking in the lookbook takes the piece out of the 3D layout', () => {
  const tray = 'LB-TRAY-01';
  const st = { picks: { TRAY: { id: tray, qty: 1, color: null }, 'LR-RUG@LR-RUG': { id: 'LB-LR-RUG-01', qty: 1, color: null } }, try3d: [] };
  const c = cat(st);
  const l = defaultLayout(c);
  const designerRug = l.slots['LR-RUG'].option;
  addLookbookFree(c, l, pickRef('TRAY', tray, null), 'living');
  swapOption(c, l, 'LR-RUG', pickRef('LR-RUG@LR-RUG', 'LB-LR-RUG-01', null));
  assert.equal(refsInLayout(l).size, 2);
  // the lookbook removes both picks
  syncLookbookProducts(c, emptyPicks());
  const n = normalizeLayout(c, l).layout;
  assert.equal(n.lookbook.length, 0);
  assert.equal(n.slots['LR-RUG'].option, null, 'the slot is left empty, not silently refilled');
  assert.ok(designerRug);
  assert.equal(fmt3d(computeBudget(c, defaultLayout(c)).totalCents), '$1,018.17');
});

test('null size: "size needed", never placed', () => {
  const p = lbDoc().products.find((x) => x.id === 'LB-LR-FLOORLAMP-03');
  assert.equal(p.dimensions.w_in === null || p.dimensions.d_in === null || p.dimensions.h_in === null, true);
  const c = cat({ picks: {}, try3d: [{ id: p.id, color: null }] });
  const ref = tryRef(p.id, null);
  assert.equal(findRef(c, p.id), ref);
  assert.ok(c.products.get(ref).lookbook.sizeNeeded);
  assert.ok(!canSwapInto(c, ref, 'LR-FLOORLAMP'));
  const l = defaultLayout(c);
  assert.equal(addLookbookFree(c, l, ref, 'living').ok, false);
  // a layout that says otherwise (edited by hand) is cleaned on load
  const bad = { ...l, lookbook: [{ uid: 'K1', product: ref, room: 'living', poses: [{ x: 100, y: 100, z: 0, rot: 0, spin: 0 }] }] };
  bad.slots = { ...l.slots, 'LR-FLOORLAMP': { ...l.slots['LR-FLOORLAMP'], option: ref } };
  const n = normalizeLayout(c, bad).layout;
  assert.equal(n.lookbook.length, 0);
  assert.notEqual(n.slots['LR-FLOORLAMP'].option, ref);
  assert.equal(lookbookCards(c, l)[0].sizeNeeded, true);
});

test('old layouts (no lookbook field) still load', () => {
  const c = cat(BALANCED());
  const old = JSON.parse(JSON.stringify(defaultLayout(c)));
  delete old.lookbook;
  const n = normalizeLayout(c, old).layout;
  assert.deepEqual(n.lookbook, []);
  assert.equal(fmt3d(computeBudget(c, n).totalCents), '$1,018.17');
});

test('"View in lookbook" links: lookbook products and the 3D plan products it lists', () => {
  const c = cat(BALANCED());
  assert.equal(lookbookLink(c, c.products.get('LR-RUG-A'), 'living'), 'lookbook/#p=LR-RUG-A&room=living');
  const ref = c.lookbookRefs[0];
  assert.match(lookbookLink(c, c.products.get(ref)), /^lookbook\/#p=/);
});
