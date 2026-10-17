// The inventory panel: Stored (pieces taken out of the rooms, still in the budget) and Catalog
// (products not in the plan, priced "+$X" with tax for new ones). Search, filters, sort; Place,
// Swap, Ungroup, Remove from plan (with a confirm), Add & place.
import { fmtMoney, lineCents } from '../core/budget.js';
import { storedEntries, catalogEntries, filterCards, categoriesOf } from '../core/inventory.js';
import { pieceByKey } from '../core/items.js';
import { photoUrl } from '../scene/products.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const ROOM_NAME = { living: 'living room', bedroom: 'bedroom' };
const LETTERS = 'ABCDEFGH';

export class InventoryPanel {
  constructor(app) {
    this.app = app;
    this.cat = app.cat;
    this.tab = 'stored';
    this.f = { q: '', room: 'all', category: 'all', condition: 'all', min: NaN, max: NaN, sort: 'name' };
    this.open = {}; // expanded swap / confirm rows by card id
    this.root = h('aside', { class: 'inv-panel', hidden: true, role: 'dialog', 'aria-label': 'Inventory', 'data-testid': 'inventory' });
  }

  get isOpen() { return !this.root.hidden; }

  show(tab) {
    if (tab) this.tab = tab;
    this.root.hidden = false;
    document.body.classList.add('inv-open');
    this.render();
    this.app.emit('panel');
  }

  hide() {
    if (this.root.hidden) return false;
    this.root.hidden = true;
    document.body.classList.remove('inv-open');
    this.app.emit('panel');
    return true;
  }

  toggle() { if (this.isOpen) this.hide(); else this.show(); }

  render() {
    if (!this.isOpen) return;
    const app = this.app;
    const stored = storedEntries(this.cat, app.layout);
    const catalog = catalogEntries(this.cat, app.layout);
    const cards = this.tab === 'stored' ? stored : catalog;
    const shown = filterCards(cards, this.f);
    const tabBtn = (id, label, n) => h('button', { role: 'tab', 'aria-selected': String(this.tab === id), 'data-tab': id, onclick: () => { this.tab = id; this.f.category = 'all'; this.render(); } }, `${label} (${n})`);
    const sel = (key, label, opts) => h('select', { 'aria-label': label, 'data-filter': key, onchange: (e) => { this.f[key] = e.target.value; this.renderList(); } },
      ...opts.map(([v, t]) => { const o = h('option', { value: v }, t); if (String(this.f[key]) === v) o.selected = true; return o; }));
    const num = (key, label) => h('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: label, 'aria-label': `${label} price, dollars`, 'data-filter': key, value: Number.isFinite(this.f[key]) ? String(this.f[key]) : '', oninput: (e) => { const v = parseFloat(e.target.value); this.f[key] = Number.isFinite(v) ? v : NaN; this.renderList(); } });
    this.listEl = h('div', { class: 'inv-list', 'data-testid': 'inv-list' });
    const search = h('input', { type: 'search', placeholder: 'Search name, brand, category', 'aria-label': 'Search', 'data-testid': 'inv-search', value: this.f.q, oninput: (e) => { this.f.q = e.target.value; this.renderList(); } });
    this.root.replaceChildren(
      h('div', { class: 'inv-head' },
        h('h2', {}, 'Inventory'),
        h('div', { class: 'tabs', role: 'tablist' }, tabBtn('stored', 'Stored', stored.length), tabBtn('catalog', 'Catalog', catalog.length)),
        h('button', { class: 'icon-btn close', 'aria-label': 'Close inventory', onclick: () => this.hide() }, h('span', { class: 'ico', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }))),
      h('p', { class: 'note inv-note' }, this.tab === 'stored'
        ? 'Taken out of the rooms. Still bought, so still in the budget. Place puts it in front of you.'
        : 'Products in the plan’s options that aren’t in the plan now. Not in the budget until you add them.'),
      h('div', { class: 'inv-filters' },
        search,
        sel('room', 'Room', [['all', 'Both rooms'], ['living', 'Living room'], ['bedroom', 'Bedroom']]),
        sel('category', 'Category', [['all', 'All categories'], ...categoriesOf(cards).map((c) => [c, c])]),
        sel('condition', 'New or used', [['all', 'New & used'], ['new', 'New'], ['used', 'Used'], ...(this.tab === 'stored' ? [['owned', 'Already yours']] : [])]),
        h('div', { class: 'price-range' }, num('min', 'Min'), h('span', {}, '–'), num('max', 'Max')),
        sel('sort', 'Sort by', [['name', 'Sort: name'], ['price', 'Sort: price'], ['size', 'Sort: size']])),
      this.listEl);
    this.renderList(shown);
  }

  renderList(shown) {
    if (!this.listEl) return;
    const app = this.app;
    if (!shown) shown = filterCards(this.tab === 'stored' ? storedEntries(this.cat, app.layout) : catalogEntries(this.cat, app.layout), this.f);
    if (!shown.length) {
      this.listEl.replaceChildren(h('p', { class: 'note empty' }, this.tab === 'stored'
        ? (app.layout.inventory.length ? 'Nothing matches the filters.' : 'Nothing stored. Look at a piece and press F (or Store) to put it here.')
        : 'Nothing matches the filters.'));
      return;
    }
    this.listEl.replaceChildren(...shown.map((c) => (this.tab === 'stored' ? this.storedCard(c) : this.catalogCard(c))));
  }

  sizeLine(size) {
    const est = size.filter((s) => s.est).map((s) => s.k.toUpperCase());
    return h('div', { class: 'inv-size' },
      ...size.flatMap((s, i) => [i ? ' × ' : '', h('span', { class: s.est ? 'est' : '' }, `${s.v}`)]), ' in (W × D × H)',
      est.length ? h('span', { class: 'est-tag', title: 'Not published by the seller; estimated in the design notes' }, ` ESTIMATED: ${est.join(', ')}`) : null);
  }

  photo(info) {
    if (info.photo) return h('img', { class: 'inv-photo', src: photoUrl(this.cat.products.get(info.photo)), alt: '', loading: 'lazy' });
    return h('span', { class: 'inv-photo swatch-photo', style: `background:${info.color || '#ccc'}` });
  }

  storedCard(c) {
    const app = this.app, b = c.base;
    const id = c.uid;
    const swapOpen = this.open[id] === 'swap', confirmOpen = this.open[id] === 'remove';
    const price = b.kind === 'product' ? h('strong', { class: 'inv-price' }, fmtMoney(b.priceCents)) : h('span', { class: 'badge plain' }, 'Already yours');
    const cond = b.kind === 'product' ? h('span', { class: `badge ${b.condition === 'used' ? 'used' : 'new'}` }, b.condition === 'used' ? 'Used' : 'New') : null;
    const slot = b.kind === 'product' ? this.cat.slots.get(b.slotId) : null;
    const swapRow = swapOpen && slot ? h('div', { class: 'inv-swap' }, ...slot.options.filter((pid) => pid !== b.productId).map((pid) => {
      const p = this.cat.products.get(pid);
      const i = slot.options.indexOf(pid);
      return h('button', { class: 'opt', 'data-option': pid, onclick: () => { this.open[id] = null; app.swapPiece(b.key, pid); } },
        h('img', { src: photoUrl(p), alt: '', loading: 'lazy' }),
        h('span', { class: 'opt-text' }, h('b', {}, `Option ${LETTERS[i]}`, pid === slot.default_option ? h('span', { class: 'def' }, ' ★ Designer\'s pick') : null), h('span', { class: 'opt-name' }, p.name), h('span', { class: 'opt-price' }, fmtMoney(lineCents(p)), p.condition === 'used' ? ' · used' : '')));
    })) : null;
    const confirm = confirmOpen ? h('div', { class: 'confirm' },
      h('span', {}, `Remove ${short(b.name)} from the plan? It leaves the budget (−${fmtMoney(b.priceCents)} before tax) and goes back to the Catalog.`),
      h('button', { class: 'btn danger', 'data-testid': 'remove-confirm', onclick: () => { this.open[id] = null; app.removeFromPlan(b.key); } }, 'Yes, remove'),
      h('button', { class: 'btn', onclick: () => { this.open[id] = null; this.renderList(); } }, 'Cancel')) : null;
    return h('div', { class: 'inv-card', 'data-key': b.key, 'data-uid': c.uid, 'data-testid': 'stored-card' },
      this.photo(b),
      h('div', { class: 'inv-main' },
        h('b', { class: 'inv-name' }, b.name),
        h('div', { class: 'inv-brand' }, b.brand),
        this.sizeLine(b.size),
        h('div', { class: 'inv-meta' }, price, cond, h('span', { class: 'inv-room' }, `from the ${ROOM_NAME[c.from] || c.from}`)),
        c.members.length ? h('div', { class: 'inv-group' }, `With ${c.members.map((m) => short(m.name)).join(', ')}`,
          h('button', { class: 'btn small ghost', 'data-testid': 'ungroup', onclick: () => app.ungroupStored(c.uid) }, 'Ungroup')) : null,
        h('div', { class: 'inv-acts' },
          h('button', { class: 'btn primary small', 'data-testid': 'place', onclick: () => app.placeFromInventory(c.uid) }, 'Place'),
          slot && slot.options.length > 1 ? h('button', { class: 'btn small', 'data-testid': 'swap', 'aria-expanded': String(swapOpen), onclick: () => { this.open[id] = swapOpen ? null : 'swap'; this.renderList(); } }, 'Swap') : null,
          b.kind === 'product' ? h('button', { class: 'btn small danger', 'data-testid': 'remove', onclick: () => { this.open[id] = 'remove'; this.renderList(); } }, 'Remove from plan') : h('span', { class: 'note small' }, 'Yours: can be stored, not removed')),
        swapRow, confirm));
  }

  catalogCard(c) {
    const app = this.app;
    const slotSel = app.layout.slots[c.slotId];
    const current = slotSel.option ? this.cat.products.get(slotSel.option) : null;
    return h('div', { class: 'inv-card', 'data-product': c.productId, 'data-testid': 'catalog-card' },
      h('img', { class: 'inv-photo', src: photoUrl(this.cat.products.get(c.photo)), alt: '', loading: 'lazy' }),
      h('div', { class: 'inv-main' },
        h('b', { class: 'inv-name' }, c.name),
        h('div', { class: 'inv-brand' }, c.brand),
        this.sizeLine(c.size),
        h('div', { class: 'inv-meta' },
          h('strong', { class: 'inv-price add', 'data-testid': 'add-price' }, `+${fmtMoney(c.addCents)}`),
          h('span', { class: `badge ${c.condition === 'used' ? 'used' : 'new'}` }, c.condition === 'used' ? 'Used' : 'New'),
          c.condition === 'used' ? h('span', { class: 'note small' }, 'no tax') : h('span', { class: 'note small' }, `${fmtMoney(c.priceCents)} + tax`),
          h('span', { class: 'inv-room' }, `${c.slotLabel} · ${ROOM_NAME[c.homeRoom]}`)),
        c.status ? h('div', { class: 'note small' }, c.status) : null,
        h('div', { class: 'inv-acts' },
          h('button', { class: 'btn primary small', 'data-testid': 'add-place', onclick: () => app.addFromCatalog(c.productId) }, 'Add & place'),
          current ? h('button', { class: 'btn small', 'data-testid': 'swap-in', title: `Replaces ${current.name}`, onclick: () => app.swapPiece(`${c.slotId}#0`, c.productId) }, `Swap for ${short(current.name)}`) : null)));
  }
}

function short(n) { return String(n).split(/[,(]/)[0].trim(); }
export { pieceByKey };
