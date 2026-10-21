// The lookbook in the 3D rooms ("From lookbook"). No three.js.
//
// The lookbook's My Picks (src/shared/lbstore.js) are the selection: every pick, and every product
// sent with "See in 3D", becomes a 3D product with its own id (lb:<pick slot>:<product id>:<color>)
// in cat.products, next to the 3D plan's own products (which are never changed):
//  - the 3D file wins for the 3D model: an id that is also in the 3D plan keeps its 3D size, kind,
//    stored IKEA model and photo crop; the lookbook wins for price, stock, links and photo
//  - new products are built from the lookbook size (w_in, d_in, h_in), main_color_hex, photo and,
//    when IKEA has one, its stored .glb (data/lookbook/models/)
//  - a size that is null is never guessed: the product shows with "size needed" and can't be placed
// In the layout a lookbook product sits either in a 3D slot (layout.slots[id].option = 'lb:...',
// "Swap into slot", with that slot's placement rules) or placed freely in layout.lookbook
// [{uid: 'K1', product: 'lb:...', room, poses}] (floor, wall or on top of any piece). Only placed
// pieces count in the budget; taking one out of the room puts it back in "From lookbook".
import { refsOf, parseRef } from '../shared/lbstore.js';
import { productKind } from './items.js';

/** Lookbook categories whose free-placed pieces stand on the floor (the rest go on any surface). */
const FLOOR_CATEGORIES = new Set(['BENCH', 'SIDETABLE']);
const LAMP_KINDS = new Set(['floorlamp', 'tablelamp', 'sconce', 'desklamp']);
const ROOM_IDS = ['living', 'bedroom'];

export const isLookbookId = (id) => typeof id === 'string' && id.startsWith('lb:');

/** Index the lookbook products.json (or null when the site has none). */
export function indexLookbook(doc) {
  if (!doc?.products) return null;
  return { doc, products: new Map(doc.products.map((p) => [p.id, p])), categories: new Map((doc.categories || []).map((c) => [c.id, c])) };
}

/** The lookbook product shown in a color: price, stock, link and photo of the variant. */
export function variantOf(lbp, color) {
  const v = color ? (lbp.color_variants || []).find((x) => x.color === color) : null;
  return v ? { color: v.color, hex: v.hex, price: v.price, regular: null, inStock: v.in_stock, url: v.product_url, image: v.image_file }
    : { color: null, hex: lbp.main_color_hex, price: lbp.price, regular: lbp.on_sale ? lbp.regular_price : null, inStock: lbp.in_stock, url: lbp.product_url, image: lbp.image_file };
}

const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
};

/**
 * The 3D product for one reference. cat: the catalog (its 3D products and slots); lb: indexLookbook().
 * r: {ref, pickKey, id, color, qty} from refsOf().
 */
export function makeProduct(cat, lb, r) {
  const lbp = lb.products.get(r.id);
  if (!lbp) return null;
  const v = variantOf(lbp, r.color);
  const base = cat.products.get(lbp.id) && !isLookbookId(lbp.id) ? cat.products.get(lbp.id) : null; // in the 3D plan
  const slots = String(lbp.slot_3d || '').split('|').filter((s) => cat.slots.has(s));
  const d = lbp.dimensions || {};
  const dims = base ? { ...base.dimensions_in } : { w: d.w_in, d: d.d_in, h: d.h_in };
  const sizeNeeded = !['w', 'd', 'h'].every((k) => typeof dims[k] === 'number' && dims[k] > 0);
  const est = base ? base.dimensions_estimated || [] : (d.estimated || []).map((k) => String(k).replace(/_in$/, ''));
  const slotDefault = slots.length ? cat.products.get(cat.slots.get(slots[0]).default_option) : null;
  const catInfo = lb.categories.get(lbp.category);
  // the kind decides the model: the 3D plan's for its own ids; else from the name, falling back to
  // the kind of the slot's own product (a "cord hider kit" in the raceway slot is a raceway)
  let kind;
  if (base) kind = productKind(base);
  else {
    kind = productKind({ name: lbp.name, category: slotDefault?.category || catInfo?.label || '' });
    if (kind === 'box' && slotDefault) kind = productKind(slotDefault);
  }
  const room = ROOM_IDS.includes(lbp.room) ? lbp.room : (slots[0] ? cat.slots.get(slots[0]).room : null);
  const qty = r.qty ?? lbp.qty_suggested ?? 1;
  return {
    id: r.ref,
    modelId: base ? base.id : lbp.id, // stored model, photo crop and set pieces come from this id
    room,
    category: base?.category || slotDefault?.category || catInfo?.label || lbp.category,
    kind,
    name: lbp.name,
    brand: lbp.brand,
    retailer: lbp.store,
    price: v.price,
    regular_price: v.regular,
    qty,
    taxed: !!lbp.taxed,
    condition: lbp.condition,
    buy_url: v.url,
    backup_search_url: lbp.backup_search_url,
    image_file: `data/lookbook/${v.image}`,
    dimensions_in: dims,
    dimensions_estimated: est,
    main_color_hex: base && !r.color ? base.main_color_hex : v.hex,
    material: lbp.material,
    model_3d_url: base ? base.model_3d_url : lbp.model_3d_url,
    status_today: v.inStock ? `In stock (checked ${fmtDate(lbp.stock_checked_date)})` : `Out of stock (checked ${fmtDate(lbp.stock_checked_date)})`,
    rating: Array.isArray(lbp.rating) && lbp.rating[0] ? `${lbp.rating[0]} · ${lbp.rating[1]} reviews` : null,
    description: lbp.why_this,
    pieces: base?.pieces,
    bulb_spec: base?.bulb_spec,
    unit_note: base?.unit_note,
    slot: null,
    lookbook: {
      ref: r.ref, pickKey: r.pickKey, tried: !!r.tried, id: lbp.id, color: r.color, slots, sizeNeeded,
      category: lbp.category, categoryLabel: catInfo?.label || lbp.category, rule: catInfo?.rule || '',
      placement: lbp.placement_3d, deliveryFee: lbp.delivery_fee || 0, inStock: v.inStock, stockNote: v.color ? null : lbp.stock_note,
      light: LAMP_KINDS.has(kind), usedLabel: lbp.used_label, shared: lbp.room === 'both',
    },
  };
}

/**
 * Put the current picks into the catalog: lookbook products that are no longer picked are taken
 * out of cat.products (normalizeLayout then drops them from the layout). Returns the references.
 */
export function syncLookbookProducts(cat, state) {
  for (const id of [...cat.products.keys()]) if (isLookbookId(id)) cat.products.delete(id);
  cat.lookbookRefs = [];
  if (!cat.lookbook) return [];
  for (const r of refsOf(state)) {
    const p = makeProduct(cat, cat.lookbook, r);
    if (!p) continue;
    cat.products.set(p.id, p);
    cat.lookbookRefs.push(r.ref);
  }
  return cat.lookbookRefs;
}

/** Can this lookbook product go into this 3D slot? */
export function canSwapInto(cat, productId, slotId) {
  const p = cat.products.get(productId);
  return !!(p?.lookbook && !p.lookbook.sizeNeeded && p.lookbook.slots.includes(slotId) && cat.slots.has(slotId));
}

/** Is this product an option of the slot (its own options, or a lookbook product made for it)? */
export function isSlotOption(cat, slot, productId) {
  return slot.options.includes(productId) || canSwapInto(cat, productId, slot.slot_id);
}

/**
 * The made-up slot a freely placed lookbook piece belongs to: how it mounts (floor, wall, or
 * "surface": on top of whatever piece it is set on, or the floor) and its labels. Never in cat.slots,
 * so the designer's layout, goals and slot lists are unaffected.
 */
export function freeSlot(cat, product, room) {
  const lb = product.lookbook;
  const real = lb.slots.length ? cat.slots.get(lb.slots[0]) : null;
  let mount;
  if (real) mount = real.mount === 'wall' ? 'wall' : real.anchor === 'on top of' ? 'surface' : 'floor';
  else mount = FLOOR_CATEGORIES.has(lb.category) ? 'floor' : 'surface';
  return {
    slot_id: 'LOOKBOOK', free: true, room: room || product.room || 'living', label: lb.categoryLabel, mount, anchor: mount,
    wall: null, on_top_of: null, options: [], default_option: null, placements: [], notes: '', rule_applied: lb.rule,
  };
}

/** Where a freely placed piece waits before it is carried in (its height on a wall: 57", the art rule). */
export function freeStartPose(slot, product) {
  const h = product.dimensions_in.h || 0;
  return { x: 0, y: 0, z: slot.mount === 'wall' ? Math.max(57, h / 2 + 1) : 0, rot: 0, spin: 0, stored: true };
}

/** Lookbook references in use in the layout: ref -> [{where: 'slot'|'free', id}]. */
export function usesOf(layout) {
  const out = new Map();
  const add = (ref, u) => { if (!out.has(ref)) out.set(ref, []); out.get(ref).push(u); };
  for (const [id, s] of Object.entries(layout.slots)) if (isLookbookId(s.option)) add(s.option, { where: 'slot', id });
  for (const e of layout.lookbook || []) add(e.product, { where: 'free', id: e.uid, room: e.room });
  return out;
}

/** The "From lookbook" cards: every pick / See-in-3D product that isn't in the rooms right now. */
export function lookbookCards(cat, layout, addCents = () => null) {
  const used = usesOf(layout);
  const out = [];
  for (const ref of cat.lookbookRefs || []) {
    if (used.has(ref)) continue;
    const p = cat.products.get(ref);
    if (!p) continue;
    const lb = p.lookbook;
    const est = new Set(p.dimensions_estimated || []);
    const designerHas = lb.slots.filter((s) => {
      const opt = layout.slots[s]?.option;
      return opt && (opt === lb.id || cat.products.get(opt)?.lookbook?.id === lb.id);
    });
    out.push({
      ref, productId: ref, lookbookId: lb.id, name: p.name, brand: [p.brand, p.retailer].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '),
      category: lb.categoryLabel, condition: p.condition, priceCents: Math.round(p.price * 100) * (p.qty ?? 1), qty: p.qty ?? 1, addCents: addCents(p),
      size: ['w', 'd', 'h'].map((k) => ({ k, v: p.dimensions_in[k], est: est.has(k), missing: !(p.dimensions_in[k] > 0) })), sizeNeeded: lb.sizeNeeded,
      photo: ref, homeRoom: p.room, color: lb.color, tried: lb.tried, pickKey: lb.pickKey, slots: lb.slots, designerHas, status: p.status_today,
    });
  }
  return out;
}

/** A lookbook product's 3D reference, from a "View in lookbook" / ?lb= value (a ref or a plain id). */
export function findRef(cat, value) {
  if (!value) return null;
  if (cat.products.get(value)?.lookbook) return value;
  return (cat.lookbookRefs || []).find((r) => parseRef(r)?.id === value) || null;
}

/** The lookbook page of a product (any id from the lookbook, also the 3D plan's own ids). */
export function lookbookLink(cat, product, room) {
  const id = product?.lookbook?.id || product?.id;
  if (!cat.lookbook?.products.has(id)) return null;
  return `lookbook/#p=${encodeURIComponent(id)}${room ? `&room=${room}` : ''}`;
}
