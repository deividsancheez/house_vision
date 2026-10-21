// The lookbook's rules, without the page: products, colors, pick slots, My Picks totals, packages,
// filters and text. Everything comes from the lookbook products.json (and the 3D slots for the pick
// labels); nothing is made up. Unit-tested in tests/unit/lookbook.test.mjs.

export const ROOMS = ['living', 'bedroom'];
export const ROOM_NAME = { living: 'Living room', bedroom: 'Bedroom' };

// ---------------------------------------------------------------------------------------------
// Money (integer cents, like the 3D app's budget)

export const toCents = (dollars) => Math.round(Number(dollars) * 100);

export function fmtMoney(cents, { whole = false } = {}) {
  const neg = cents < 0;
  const v = Math.abs(Math.round(cents));
  const dollars = Math.floor(v / 100).toLocaleString('en-US');
  const s = whole && v % 100 === 0 ? `$${dollars}` : `$${dollars}.${String(v % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Sales tax on taxed cents, rounded half up to the cent (same as the 3D app). */
export function taxOf(taxedCents, rate) {
  const bp = Math.round(rate * 10000);
  return Math.floor((taxedCents * bp + 5000) / 10000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-19" -> "Oct 19, 2026" (no time zone shifts). */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// ---------------------------------------------------------------------------------------------
// Text

/** Store names keep their own spacing; this only tidies feet/inch marks: `7 ' 10 "x10 '` -> `7'10"x10'`. */
export function cleanName(name) {
  return decodeEntities(name || '')
    .replace(/(\d)\s+(['"])/g, '$1$2')
    .replace(/(['"])\s+(\d)/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The first `n` whole sentences of a text. The store descriptions in products.json are cut at a
 * fixed length, so a last sentence without its end is dropped rather than shown cut off.
 */
export function sentences(text, n = 2, skip = '') {
  const t = decodeEntities(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // a sentence ends at . ! ? followed by a space and a capital, digit or quote ("$349.99" is not an end)
  const parts = t.split(/(?<=[.!?]["”’)]*)\s+(?=[A-Z0-9"“‘(¿¡ÁÉÍÓÚÑÄÖÅ])/);
  const complete = (s, i) => i < parts.length - 1 || /[.!?]["”’)]*$/.test(s);
  // descriptions often open by repeating the product name; that isn't a sentence worth showing
  const name = cleanName(skip).toLowerCase().replace(/[.\s]+$/, '');
  const whole = parts.filter(complete).filter((s) => !name || cleanName(s).toLowerCase().replace(/[.\s]+$/, '') !== name);
  if (whole.length) return whole.slice(0, n).join(' ');
  if (parts.length > 1 || complete(parts[0], 0)) return '';
  // no complete sentence at all: show the start, marked as shortened
  return t.length > 160 ? `${t.slice(0, 157).replace(/\s+\S*$/, '')}…` : t;
}

/** Some store texts arrive with HTML entities ("Better Homes &amp; Gardens"): show the characters. */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, e) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[e]));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------------------------
// Catalog index

/**
 * doc: the lookbook products.json. slots3d: the 3D app's slots ([{slot_id, room, label}]), used for
 * the pick slot names and rooms ("Living room: Curtain rod").
 */
export function buildIndex(doc, slots3d = []) {
  const products = new Map(doc.products.map((p) => [p.id, p]));
  const slotInfo = new Map(slots3d.map((s) => [s.slot_id, { room: s.room, label: s.label }]));
  const roomOfSlot = (id) => slotInfo.get(id)?.room || (id.startsWith('LR-') ? 'living' : id.startsWith('BR-') ? 'bedroom' : null);
  const categories = doc.categories.map((c, order) => {
    const slots = c.slots_3d || [];
    const multi = slots.length > 1;
    // a shared category with a single 3D slot (throws, mirrors...) has one pick for both rooms
    const pickSlots = slots.length
      ? slots.map((s) => ({ key: `${c.id}@${s}`, category: c.id, slot: s, room: multi || c.room !== 'both' ? roomOfSlot(s) : null, label: multi ? `${ROOM_NAME[roomOfSlot(s)] || ''}: ${slotInfo.get(s)?.label || s}` : c.label }))
      : [{ key: c.id, category: c.id, slot: null, room: c.room === 'both' ? null : c.room, label: c.label }];
    return { ...c, order, pickSlots, shared: c.room === 'both' };
  });
  const byCat = new Map(categories.map((c) => [c.id, c]));
  const pickSlotByKey = new Map(categories.flatMap((c) => c.pickSlots.map((s) => [s.key, s])));
  return { doc, products, categories, byCat, pickSlotByKey, slotInfo, taxRate: doc.tax_rate, budget: doc.budget };
}

/** The categories of a room chapter, in products.json order ("both" categories in each room). */
export function roomCategories(index, room) {
  return index.categories.filter((c) => c.room === room || c.room === 'both');
}

/** Every product of a category, in its listed order (all options, also in shared categories). */
export function categoryProducts(index, catId) {
  return index.byCat.get(catId).product_ids.map((id) => index.products.get(id)).filter(Boolean);
}

/** A product as shown in a color: image, price, stock and Buy link swap to the variant's. */
export function view(p, color = null) {
  const v = color ? (p.color_variants || []).find((x) => x.color === color) : null;
  if (v) {
    return {
      color: v.color, hex: v.hex, image: v.image_file, price: v.price, regular: null, onSale: false,
      inStock: v.in_stock, stockNote: null, url: v.product_url, variant: true,
    };
  }
  return {
    color: null, hex: p.main_color_hex, image: p.image_file, price: p.price, regular: p.on_sale ? p.regular_price : null, onSale: !!p.on_sale && p.regular_price > p.price,
    inStock: p.in_stock, stockNote: p.stock_note, url: p.product_url, variant: false,
  };
}

/** Size in inches: [{k: 'W', v, est, missing}] for W, D, H. */
export function sizeParts(p) {
  const d = p.dimensions || {};
  const est = new Set((d.estimated || []).map((x) => String(x).toLowerCase()));
  return [['W', 'w_in', 'w'], ['D', 'd_in', 'd'], ['H', 'h_in', 'h']].map(([k, f, e]) => ({ k, v: d[f], est: est.has(e) || est.has(f), missing: !(typeof d[f] === 'number' && d[f] > 0) }));
}

export const sizeMissing = (p) => sizeParts(p).some((s) => s.missing);

export function fmtInches(v) {
  return String(Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------------------------------
// Pick slots: My Picks holds one product per pick slot. A category gets one pick slot per 3D slot
// it fills ("Curtain rods": the living room rod and the bedroom rod; "Pillow covers": the cream pair
// and the rust pair), or one for the whole category when it has no 3D slot (trays, benches...).

/** The pick slots a product can fill when it is picked from `room`'s chapter (best first). */
export function candidateKeys(index, p, room) {
  const cat = index.byCat.get(p.category);
  if (!cat) return [];
  if (cat.pickSlots.length === 1) return [cat.pickSlots[0]];
  const own = String(p.slot_3d || '').split('|').filter(Boolean);
  let cands = cat.pickSlots.filter((s) => own.includes(s.slot));
  if (!cands.length) cands = cat.pickSlots;
  const here = cands.filter((s) => s.room === room);
  return here.length ? here : cands;
}

/** The pick slot (if any) currently holding this product (in this color, if given). */
export function pickedKeysOf(state, id, color) {
  return Object.entries(state.picks).filter(([, v]) => v.id === id && (color === undefined || (v.color || null) === (color || null))).map(([k]) => k);
}

/** Categories whose picks can take a quantity (pillow covers, inserts, lumbar pillows). */
export const QTY_CATEGORIES = new Set(['PILLOW', 'INSERT', 'LUMBAR']);

// ---------------------------------------------------------------------------------------------
// My Picks totals

/**
 * Lines and totals for the picks: new items taxed at products.json tax_rate (rounded half up), used
 * private sales untaxed, delivery from each product's delivery_fee (when listed). The total is
 * compared to budget.aim_total ($1,000: amber above) and budget.hard_ceiling ($1,200: red above).
 */
export function cartTotals(index, state) {
  const lines = [];
  let taxed = 0, untaxed = 0, delivery = 0;
  for (const [key, pick] of Object.entries(state.picks)) {
    const p = index.products.get(pick.id);
    if (!p) continue;
    const v = view(p, pick.color);
    const unit = toCents(v.price);
    const cents = unit * pick.qty;
    const del = toCents(p.delivery_fee || 0);
    if (p.taxed) taxed += cents; else untaxed += cents;
    delivery += del;
    const slot = index.pickSlotByKey.get(key);
    lines.push({ key, slot, product: p, view: v, qty: pick.qty, unitCents: unit, cents, deliveryCents: del, taxed: !!p.taxed, store: p.store, url: v.url, room: slot?.room || (p.room === 'both' ? null : p.room) });
  }
  const tax = taxOf(taxed, index.taxRate);
  const total = taxed + untaxed + tax + delivery;
  const aim = toCents(index.budget?.aim_total ?? 1000), ceiling = toCents(index.budget?.hard_ceiling ?? 1200);
  const level = total > ceiling ? 'red' : total > aim ? 'amber' : 'ok';
  const order = new Map(index.categories.map((c) => [c.id, c.order]));
  lines.sort((a, b) => (order.get(a.product.category) - order.get(b.product.category)) || a.key.localeCompare(b.key));
  return { lines, taxedCents: taxed, untaxedCents: untaxed, taxCents: tax, deliveryCents: delivery, totalCents: total, aimCents: aim, ceilingCents: ceiling, level };
}

/** Buy links grouped by store: [{store, links: [{name, url, qty}]}], stores A-Z. */
export function linksByStore(lines) {
  const by = new Map();
  for (const l of lines) {
    if (!by.has(l.store)) by.set(l.store, []);
    by.get(l.store).push({ name: l.product.name, url: l.url, qty: l.qty, color: l.view.color, backup: l.product.condition === 'used' ? l.product.backup_search_url : null });
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([store, links]) => ({ store, links }));
}

// ---------------------------------------------------------------------------------------------
// Packages

/**
 * A package priced from today's products.json prices (so a price change there shows up here), with
 * the designer's stored totals alongside for comparison.
 */
export function packageTotals(index, id) {
  const pkg = index.doc.packages[id];
  const lines = pkg.items.map((it) => {
    const p = index.products.get(it.id);
    const unit = toCents(p ? p.price : it.unit_price);
    return { id: it.id, product: p, name: p?.name || it.name, store: p?.store || it.store, qty: it.qty, unitCents: unit, cents: unit * it.qty, taxed: p ? !!p.taxed : !!it.taxed, deliveryCents: toCents(p?.delivery_fee || 0) };
  });
  const taxed = lines.filter((l) => l.taxed).reduce((a, l) => a + l.cents, 0);
  const untaxed = lines.filter((l) => !l.taxed).reduce((a, l) => a + l.cents, 0);
  const delivery = lines.reduce((a, l) => a + l.deliveryCents, 0);
  const tax = taxOf(taxed, index.taxRate);
  const total = taxed + untaxed + tax + delivery;
  const stored = { taxed: toCents(pkg.subtotal_new_taxed), untaxed: toCents(pkg.subtotal_used_untaxed), tax: toCents(pkg.sales_tax), delivery: toCents(pkg.delivery), total: toCents(pkg.total) };
  return { id, pkg, lines, taxedCents: taxed, untaxedCents: untaxed, taxCents: tax, deliveryCents: delivery, totalCents: total, stored, matchesStored: total === stored.total && taxed === stored.taxed && untaxed === stored.untaxed && tax === stored.tax };
}

/** The picks a package loads: each item into its pick slot, with the package's quantity. */
export function packagePicks(index, id) {
  const picks = {};
  const problems = [];
  for (const it of index.doc.packages[id].items) {
    const p = index.products.get(it.id);
    if (!p) { problems.push(`${it.id} is not in products`); continue; }
    const room = p.room === 'both' ? null : p.room;
    const cands = candidateKeys(index, p, room).filter((s) => !picks[s.key]);
    if (!cands.length) { problems.push(`${it.id}: no free pick slot`); continue; }
    picks[cands[0].key] = { id: p.id, qty: it.qty, color: null };
  }
  return { picks, problems };
}

/** Which room a package line belongs to (for the mood boards): its pick slot's room, else its own. */
export function roomOfPick(index, key, p) {
  return index.pickSlotByKey.get(key)?.room || (p.room === 'both' ? null : p.room);
}

// ---------------------------------------------------------------------------------------------
// Filters (every room page): store, price range, Deal, Used, Top pick

export function emptyFilters() {
  return { stores: [], min: null, max: null, deal: false, used: false, top: false };
}

export function filtersActive(f) {
  return !!(f.stores.length || f.min !== null || f.max !== null || f.deal || f.used || f.top);
}

export function matchesFilters(p, f, color = null) {
  const v = view(p, color);
  if (f.stores.length && !f.stores.includes(p.store)) return false;
  if (f.min !== null && v.price < f.min) return false;
  if (f.max !== null && v.price > f.max) return false;
  if (f.deal && !(p.tags || []).includes('Deal')) return false;
  if (f.used && p.condition !== 'used') return false;
  if (f.top && !(p.tags || []).includes('Top pick')) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// The designer's notes (design-notes.md, MANUAL-ACTION-NEEDED.md): a small Markdown reader for the
// parts those files use (headings, paragraphs, lists, tables, bold, code, links).

export function inlineMd(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return t;
}

/** Split a Markdown file into sections by "## " heading: [{title, lines}]. */
export function mdSections(md) {
  const out = [{ title: '', lines: [] }];
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) out.push({ title: m[1].trim(), lines: [] });
    else out.at(-1).lines.push(line);
  }
  return out;
}

export function mdToHtml(md) {
  const lines = Array.isArray(md) ? md : String(md || '').split(/\r?\n/);
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { const n = Math.min(6, m[1].length + 1); html.push(`<h${n}>${inlineMd(m[2])}</h${n}>`); i++; continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      const [head, ...rest] = body;
      html.push(`<div class="md-table"><table><thead><tr>${cells(head).map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = /^\s*(\d+)\.\s+(.*)$/.exec(line)) || /^\s*[-*]\s+/.test(line)) {
      const ordered = !!m;
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))) {
        let text = lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, '');
        const box = /^\[( |x)\]\s+/i.exec(text);
        if (box) text = text.slice(box[0].length);
        items.push(`<li${box ? ` class="todo${box[1].toLowerCase() === 'x' ? ' done' : ''}"` : ''}>${inlineMd(text)}</li>`);
        i++;
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    html.push(`<p>${inlineMd(para.join(' '))}</p>`);
  }
  return html.join('\n');
}

/** The room concepts from design-notes.md "## Concept": {living: {title, text}, bedroom: {...}}. */
export function concepts(md) {
  const sec = mdSections(md).find((s) => /^concept/i.test(s.title));
  const out = {};
  for (const line of sec?.lines || []) {
    const m = /^\*\*(Living room|Bedroom):\s*([^*]+)\*\*\s*(.*)$/i.exec(line.trim());
    if (m) out[/living/i.test(m[1]) ? 'living' : 'bedroom'] = { title: m[2].trim().replace(/\.$/, ''), text: m[3].trim() };
  }
  return out;
}

/** The package blurbs from design-notes.md: lines starting "- **SAVE** ...". */
export function packageBlurbs(md) {
  const out = {};
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = /^-\s+\*\*(SAVE|BALANCED|UPGRADE)\b([^*]*)\*\*\s*(.*)$/i.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = { note: m[2].replace(/[()]/g, '').replace(/^[\s,]+/, '').trim(), text: m[3].trim() };
  }
  return out;
}
