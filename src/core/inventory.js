// The inventory: pieces taken out of the rooms (still bought, so still in the budget), and the
// Catalog: products in products.json that aren't in the plan right now. No three.js.
// Layout fields (see items.js normalizeLayout):
//   pose.stored = true             the piece is in the inventory
//   layout.inventory = [{uid, keys, from}]   groups, newest first; a piece and what rested on it
//   layout.extras = [{uid, product, poses}] products added from the Catalog on top of a slot's pick
import { buildItems, allPieces, poseRef, parseKey, nextUid, homeRoom, defaultSlotPoses, swapOption } from './items.js';
import { computeBudget, lineCents, toCents } from './budget.js';

/** Everything resting on `it`, and what rests on those (lamp + candle on a nightstand). */
export function dependentsDeep(items, it) {
  const out = [];
  const walk = (base) => {
    for (const o of items) if (o.supportId === base.id && base.index === 0 && o.key !== base.key && !out.includes(o)) { out.push(o); walk(o); }
  };
  walk(it);
  return out;
}

function removeFromGroups(layout, keys) {
  const drop = new Set(keys);
  for (const g of layout.inventory) g.keys = g.keys.filter((k) => !drop.has(k));
  layout.inventory = layout.inventory.filter((g) => g.keys.length);
}

function setPoseByKey(layout, key, pose) {
  const { id, index } = parseKey(key);
  const owner = layout.slots[id] || layout.existing[id] || layout.extras.find((x) => x.uid === id);
  owner.poses[index] = pose;
}

/** Store a piece standing in `roomId` and everything resting on it, as one group. */
export function storePiece(cat, layout, roomId, key) {
  const items = buildItems(cat, layout, roomId);
  const it = items.find((i) => i.key === key);
  if (!it) return { ok: false, reason: 'not here' };
  const group = [it, ...dependentsDeep(items, it)];
  for (const g of group) setPoseByKey(layout, g.key, { ...poseRef(layout, g.key), stored: true });
  const uid = nextUid(layout.inventory, 'G');
  layout.inventory.unshift({ uid, keys: group.map((g) => g.key), from: roomId });
  return { ok: true, uid, keys: group.map((g) => g.key) };
}

/** Put pieces back in a room at the given poses (the carried piece and what rides on it). */
export function placePieces(cat, layout, roomId, placements) {
  for (const { key, pose, wallId } of placements) {
    const clean = { ...pose };
    delete clean.stored;
    if (roomId !== homeRoom(cat, layout, key)) clean.room = roomId; else delete clean.room;
    if (wallId) clean.wall = wallId;
    setPoseByKey(layout, key, clean);
  }
  removeFromGroups(layout, placements.map((p) => p.key));
}

/** Split a group: each piece gets its own inventory entry. */
export function ungroup(layout, uid) {
  const i = layout.inventory.findIndex((g) => g.uid === uid);
  if (i < 0 || layout.inventory[i].keys.length < 2) return false;
  const g = layout.inventory[i];
  const singles = g.keys.map((k, j) => ({ uid: j === 0 ? g.uid : null, keys: [k], from: g.from }));
  layout.inventory.splice(i, 1, ...singles);
  for (const s of singles) if (!s.uid) s.uid = nextUid(layout.inventory, 'G');
  return true;
}

/**
 * Take a piece out of the plan: it leaves the budget, and a product goes back to the Catalog.
 * Pieces you already own (existing) can't be removed, only stored.
 */
export function removeFromPlan(cat, layout, key) {
  const { id } = parseKey(key);
  if (layout.existing[id]) return { ok: false, reason: 'Pieces you already own can be stored but not removed from the plan.' };
  let keys;
  const x = layout.extras.find((e) => e.uid === id);
  if (x) {
    keys = x.poses.map((_, i) => `${id}#${i}`);
    layout.extras = layout.extras.filter((e) => e !== x);
  } else if (layout.slots[id]?.option) {
    keys = layout.slots[id].poses.map((_, i) => `${id}#${i}`);
    swapOption(cat, layout, id, null);
    layout.slots[id].poses = layout.slots[id].poses.map((p) => { const c = { ...p }; delete c.stored; return c; });
  } else return { ok: false, reason: 'Not in the plan.' };
  removeFromGroups(layout, keys);
  return { ok: true, keys };
}

/**
 * Add a Catalog product to the plan, stored (the caller then starts carrying its first piece).
 * Into its slot if the slot is empty, otherwise as an extra piece next to the slot's own pick.
 * Each piece of a multi-piece product (a pair of sconces) is its own inventory entry.
 */
export function addFromCatalog(cat, layout, productId) {
  const p = cat.products.get(productId);
  const slot = cat.slots.get(p.slot);
  const poses = defaultSlotPoses(cat, slot, productId).map((q) => ({ ...q, stored: true }));
  let owner;
  if (!layout.slots[slot.slot_id].option) {
    layout.slots[slot.slot_id] = { option: productId, poses };
    owner = slot.slot_id;
  } else {
    owner = nextUid(layout.extras, 'X');
    layout.extras.push({ uid: owner, product: productId, poses });
  }
  const keys = poses.map((_, i) => `${owner}#${i}`);
  for (const k of [...keys].reverse()) layout.inventory.unshift({ uid: nextUid(layout.inventory, 'G'), keys: [k], from: slot.room });
  return { ok: true, keys, owner };
}

/** Products not in the plan right now, with what adding each would add to the total (tax included). */
export function catalogProducts(cat, layout) {
  const inPlan = new Set([...Object.values(layout.slots).map((s) => s.option).filter(Boolean), ...layout.extras.map((x) => x.product)]);
  const now = computeBudget(cat, layout).totalCents;
  const out = [];
  for (const p of cat.products.values()) {
    if (inPlan.has(p.id)) continue;
    const trial = { ...layout, extras: [...layout.extras, { uid: 'X0', product: p.id, poses: [] }] };
    out.push({ product: p, slot: cat.slots.get(p.slot), addCents: computeBudget(cat, trial).totalCents - now });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cards for the inventory panel, and search / filter / sort

const DIM_KEYS = ['w', 'd', 'h'];

/** What a card shows about one piece. */
export function pieceInfo(cat, it) {
  if (it.kind === 'product') {
    const p = it.product;
    const est = new Set(p.dimensions_estimated || []);
    return {
      key: it.key, kind: 'product', productId: p.id, slotId: it.slot.slot_id, extra: it.extra,
      name: p.name, brand: [p.brand, p.retailer].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '),
      category: p.category, condition: p.condition, priceCents: lineCents(p), unitCents: toCents(p.price), qty: p.qty ?? 1,
      size: DIM_KEYS.map((k) => ({ k, v: p.dimensions_in[k], est: est.has(k) })), photo: p.id,
      homeRoom: it.homeRoomId, mount: it.mount,
    };
  }
  const e = it.piece;
  const est = e.dims_status === 'ESTIMATED';
  return {
    key: it.key, kind: 'existing', name: e.name, brand: 'Already yours', category: 'Already yours', condition: 'owned', priceCents: 0,
    size: DIM_KEYS.map((k) => ({ k, v: Math.round(it.dims[k] * 10) / 10, est })), photo: null, color: e.color_hex,
    homeRoom: it.homeRoomId, mount: it.mount,
  };
}

/** Stored groups as cards: [{uid, from, base, members}]. */
export function storedEntries(cat, layout) {
  const pieces = new Map(allPieces(cat, layout).map((it) => [it.key, it]));
  return layout.inventory.map((g) => {
    const infos = g.keys.map((k) => pieces.get(k)).filter(Boolean).map((it) => pieceInfo(cat, it));
    return { uid: g.uid, from: g.from, keys: g.keys, base: infos[0], members: infos.slice(1) };
  }).filter((e) => e.base);
}

/** Catalog cards. */
export function catalogEntries(cat, layout) {
  return catalogProducts(cat, layout).map(({ product: p, slot, addCents }) => {
    const est = new Set(p.dimensions_estimated || []);
    return {
      productId: p.id, slotId: slot.slot_id, slotLabel: slot.label, name: p.name,
      brand: [p.brand, p.retailer].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '), category: p.category,
      condition: p.condition, priceCents: lineCents(p), addCents, size: DIM_KEYS.map((k) => ({ k, v: p.dimensions_in[k], est: est.has(k) })),
      photo: p.id, homeRoom: slot.room, status: p.status_today,
    };
  });
}

/**
 * Filter and sort cards. f: {q, room ('all'|room id), category ('all'|text), condition ('all'|'new'|'used'),
 * min, max (dollars, on the card's price), sort ('name'|'price'|'size')}.
 * Stored cards are filtered on their base piece and room of origin.
 */
export function filterCards(cards, f = {}) {
  const info = (c) => c.base || c;
  const q = String(f.q || '').trim().toLowerCase();
  let out = cards.filter((c) => {
    const i = info(c);
    const room = c.from || i.homeRoom;
    if (q && ![i.name, i.brand, i.category, ...(c.members || []).map((m) => m.name)].some((t) => String(t || '').toLowerCase().includes(q))) return false;
    if (f.room && f.room !== 'all' && room !== f.room) return false;
    if (f.category && f.category !== 'all' && i.category !== f.category) return false;
    if (f.condition && f.condition !== 'all' && i.condition !== f.condition) return false;
    if (Number.isFinite(f.min) && i.priceCents < f.min * 100) return false;
    if (Number.isFinite(f.max) && i.priceCents > f.max * 100) return false;
    return true;
  });
  const vol = (i) => i.size.reduce((a, s) => a * s.v, 1);
  const by = {
    name: (a, b) => info(a).name.localeCompare(info(b).name),
    price: (a, b) => info(a).priceCents - info(b).priceCents || info(a).name.localeCompare(info(b).name),
    size: (a, b) => vol(info(a)) - vol(info(b)) || info(a).name.localeCompare(info(b).name),
  }[f.sort || ''];
  if (by) out = [...out].sort(by);
  return out;
}

/** Categories present in a list of cards (for the filter menu). */
export function categoriesOf(cards) {
  return [...new Set(cards.map((c) => (c.base || c).category))].sort();
}
