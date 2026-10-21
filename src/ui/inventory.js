// The inventory panel: Stored (pieces taken out of the rooms, still in the budget), Catalog
// (products not in the plan, priced "+$X" with tax for new ones) and From lookbook (My Picks and
// "See in 3D" products from the lookbook that aren't in the rooms). Search, filters, sort; Place,
// Swap, Ungroup, Remove from plan (with a confirm), Add & place, Swap into slot, Place freely.
import { fmtMoney, lineCents } from '../core/budget.js';
import { storedEntries, catalogEntries, filterCards, categoriesOf, lookbookAddCents } from '../core/inventory.js';
import { lookbookCards, lookbookLink, canSwapInto } from '../core/lookbook.js';
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

  /** tab: 'stored' | 'catalog' | 'lookbook'; highlight: a lookbook product to point at. */
  show(tab, highlight = null) {
    if (tab === 'lookbook' && !this.cat.lookbook) tab = 'stored';
    if (tab) this.tab = tab;
    this.highlight = highlight;
    if (highlight) Object.assign(this.f, { q: '', room: 'all', category: 'all', condition: 'all', min: NaN, max: NaN });
    this.root.hidden = false;
    document.body.classList.add('inv-open');
    this.render();
    this.app.emit('panel');
    if (highlight && this.tab === 'lookbook') {
      const el = this.listEl?.querySelector(`[data-product="${CSS.escape(highlight)}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      else if (this.app.items?.some((it) => it.product?.id === highlight)) this.app.ui.toast('That piece is already in your rooms. Store it to send it back here.', 'info');
    }
  }

  cards(tab = this.tab) {
    const app = this.app;
    if (tab === 'stored') return storedEntries(this.cat, app.layout);
    if (tab === 'lookbook') return lookbookCards(this.cat, app.layout, (p) => (p.lookbook.sizeNeeded ? null : lookbookAddCents(this.cat, app.layout, p)));
    return catalogEntries(this.cat, app.layout);
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
    const stored = this.cards('stored');
    const catalog = this.cards('catalog');
    const lookbook = this.cat.lookbook ? this.cards('lookbook') : [];
    const cards = this.tab === 'stored' ? stored : this.tab === 'lookbook' ? lookbook : catalog;
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
        h('div', { class: 'tabs', role: 'tablist' }, tabBtn('stored', 'Stored', stored.length), tabBtn('catalog', 'Catalog', catalog.length),
          this.cat.lookbook ? tabBtn('lookbook', 'From lookbook', lookbook.length) : null),
        h('button', { class: 'icon-btn close', 'aria-label': 'Close inventory', onclick: () => this.hide() }, h('span', { class: 'ico', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }))),
      h('p', { class: 'note inv-note' }, this.tab === 'stored'
        ? 'Taken out of the rooms. Still bought, so still in the budget. Place puts it in front of you.'
        : this.tab === 'lookbook'
          ? h('span', {}, 'Your picks from the lookbook, at their real size. Not in the budget until you place them. ', h('a', { href: `${import.meta.env.BASE_URL}lookbook/#/cover`, 'data-testid': 'open-lookbook' }, 'Open the lookbook'))
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
    if (!shown) shown = filterCards(this.cards(), this.f);
    if (!shown.length) {
      this.listEl.replaceChildren(h('p', { class: 'note empty' }, this.tab === 'stored'
        ? (app.layout.inventory.length ? 'Nothing matches the filters.' : 'Nothing stored. Look at a piece and press F (or Store) to put it here.')
        : this.tab === 'lookbook' && !this.cat.lookbookRefs.length
          ? 'No picks yet. In the lookbook, use “Add to my picks” or “See in 3D”.'
          : this.tab === 'lookbook' && !this.cards().length ? 'All your lookbook picks are in the rooms.' : 'Nothing matches the filters.'));
      return;
    }
    const card = { stored: (c) => this.storedCard(c), lookbook: (c) => this.lookbookCard(c), catalog: (c) => this.catalogCard(c) }[this.tab];
    this.listEl.replaceChildren(...shown.map(card));
  }

  sizeLine(size) {
    if (size.some((s) => s.missing || !(s.v > 0))) {
      return h('div', { class: 'inv-size' }, ...size.flatMap((s, i) => [i ? ' × ' : '', s.v > 0 ? `${s.v}` : '?']), ' in (W × D × H) ',
        h('span', { class: 'badge size-needed', 'data-testid': 'size-needed' }, 'Size needed'));
    }
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
      h('span', {}, `Remove ${short(b.name)} from the plan? It leaves the budget (−${fmtMoney(b.priceCents)} before tax) and goes back to ${this.cat.products.get(b.productId)?.lookbook ? 'From lookbook' : 'the Catalog'}.`),
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

  /** A lookbook card: Swap into each 3D slot it fits, Place freely, View in lookbook, Buy. */
  lookbookCard(c) {
    const app = this.app, cat = this.cat;
    const p = cat.products.get(c.ref);
    const id = c.ref;
    const blocked = c.sizeNeeded;
    const link = lookbookLink(cat, p, c.homeRoom);
    const confirmOpen = this.open[id] === 'dismiss';
    const swaps = c.slots.filter((s) => canSwapInto(cat, c.ref, s)).map((s) => {
      const slot = cat.slots.get(s);
      const cur = app.layout.slots[s]?.option ? cat.products.get(app.layout.slots[s].option) : null;
      return h('button', { class: 'btn small', 'data-testid': 'lb-swap', 'data-slot': s, disabled: blocked, title: cur ? `Replaces ${cur.name}` : 'The spot is empty now', onclick: () => app.lookbookSwapIn(c.ref, s) },
        `Swap into ${slot.label.toLowerCase()} (${ROOM_NAME[slot.room]})`);
    });
    return h('div', { class: `inv-card lb-card${this.highlight === c.ref ? ' hl' : ''}`, 'data-product': c.ref, 'data-lookbook-id': c.lookbookId, 'data-testid': 'lookbook-card' },
      h('img', { class: 'inv-photo', src: photoUrl(p), alt: '', loading: 'lazy' }),
      h('div', { class: 'inv-main' },
        h('b', { class: 'inv-name' }, c.name),
        h('div', { class: 'inv-brand' }, c.brand, ' · ', c.category, c.color ? ` · ${c.color}` : ''),
        this.sizeLine(c.size),
        h('div', { class: 'inv-meta' },
          c.addCents !== null ? h('strong', { class: 'inv-price add', 'data-testid': 'add-price' }, `+${fmtMoney(c.addCents)}`) : h('strong', { class: 'inv-price' }, fmtMoney(c.priceCents)),
          h('span', { class: `badge ${c.condition === 'used' ? 'used' : 'new'}` }, c.condition === 'used' ? 'Used' : 'New'),
          c.qty > 1 ? h('span', { class: 'note small' }, `× ${c.qty}`) : null,
          c.tried ? h('span', { class: 'badge plain', title: 'Sent with “See in 3D”: not one of your picks' }, 'Trying in 3D') : h('span', { class: 'badge pick' }, 'My pick'),
          h('span', { class: 'inv-room' }, c.homeRoom ? ROOM_NAME[c.homeRoom] : 'either room')),
        c.status ? h('div', { class: 'note small' }, c.status) : null,
        c.designerHas.length ? h('div', { class: 'note small', 'data-testid': 'designer-has' }, `The plan already has this one in the ${c.designerHas.map((s) => cat.slots.get(s).label.toLowerCase()).join(' and ')} spot.`) : null,
        blocked ? h('div', { class: 'note small warn-text', 'data-testid': 'size-blocked' }, 'The store doesn’t list its full size, so it can’t be placed yet. Add W × D × H to the lookbook’s products.json.') : null,
        h('div', { class: 'inv-acts' },
          ...swaps,
          h('button', { class: `btn small${swaps.length ? '' : ' primary'}`, 'data-testid': 'lb-place', disabled: blocked, onclick: () => app.lookbookPlace(c.ref) }, 'Place freely'),
          link ? h('a', { class: 'btn small ghost', href: `${import.meta.env.BASE_URL}${link}`, 'data-testid': 'view-lookbook' }, 'View in lookbook') : null,
          p.buy_url ? h('a', { class: 'btn small ghost', href: p.buy_url, target: '_blank', rel: 'noopener', 'data-testid': 'lb-buy' }, 'Buy') : null,
          c.tried ? h('button', { class: 'btn small ghost', 'data-testid': 'lb-dismiss', onclick: () => { this.open[id] = confirmOpen ? null : 'dismiss'; this.renderList(); } }, 'Remove from list') : null),
        confirmOpen ? h('div', { class: 'confirm' }, h('span', {}, `Take ${short(c.name)} off this list? It stays in the lookbook.`),
          h('button', { class: 'btn danger', 'data-testid': 'lb-dismiss-confirm', onclick: () => { this.open[id] = null; app.dismissTried(c.ref); } }, 'Yes, remove'),
          h('button', { class: 'btn', onclick: () => { this.open[id] = null; this.renderList(); } }, 'Cancel')) : null));
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
