// All the HTML around the 3D view: top bar, item card (info, swap, move/rotate/remove), budget,
// fit warnings, items list, camera views and saved layouts.
import { fmtMoney, lineCents, toCents } from '../core/budget.js';
import * as store from '../core/layouts.js';
import { PRESETS, presetLabel } from '../scene/views.js';
import { photoUrl } from '../scene/products.js';
import { WalkHud } from './walkHud.js';
import { InventoryPanel } from './inventory.js';
import { WarnStack, warningsPanel } from './warnings.js';
import { GoalsPanel } from './goals.js';
import { Tutorial } from './tutorial.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

const I = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 7h3l2-2.5h6L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5h6l2 2h10V19H3z"/></svg>',
  curtain: '<svg viewBox="0 0 24 24"><path d="M3 4h18M5 4c0 6 1 12 3 16M19 4c0 6-1 12-3 16M8 4c0 5 .7 10 2 16M16 4c0 5-.7 10-2 16"/></svg>',
  rotL: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18h.01"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>',
  door: '<svg viewBox="0 0 24 24"><path d="M5 21V3h10l4 2v16M5 21h14M12 12h.01"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4zM16 9.5l5 5M21 9.5l-5 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v4M8.5 12.5l1.5-4.5 4 1.5 2.5 3M10 8l-3 2"/></svg>',
  orbit: '<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5zM3 9v6l9 5 9-5V9M12 14v6"/></svg>',
};
const icon = (name) => h('span', { class: 'ico', html: I[name] });

export class UI {
  constructor(app) {
    this.app = app;
    this.cat = app.cat;
    this.root = document.getElementById('ui');
    this.build();
    app.on((what) => this.update(what));
    this.update('all');
  }

  build() {
    const app = this.app;
    this.tabs = h('div', { class: 'tabs', role: 'tablist' },
      ...[['living', 'Living room'], ['bedroom', 'Bedroom']].map(([id, label]) => h('button', { role: 'tab', 'data-room': id, onclick: () => app.setRoom(id) }, label)));
    this.modeBtn = h('button', { class: 'tool', 'aria-label': 'Day or night', onclick: () => app.setMode(app.mode === 'day' ? 'night' : 'day') });
    this.curtainBtn = h('button', { class: 'tool', 'aria-label': 'Open or close curtains', onclick: () => app.setCurtains(!app.curtainsClosed) }, icon('curtain'), h('span', { class: 'lbl' }, 'Curtains'));
    this.viewBtn = h('button', { class: 'tool', 'aria-label': 'Camera views', onclick: () => this.toggleMenu('views') }, icon('camera'), h('span', { class: 'lbl' }, 'Views'));
    this.itemsBtn = h('button', { class: 'tool', 'aria-label': 'Items list', onclick: () => this.toggleMenu('items') }, icon('list'), h('span', { class: 'lbl' }, 'Items'));
    this.layoutsBtn = h('button', { class: 'tool', 'aria-label': 'Saved layouts', onclick: () => this.openLayouts() }, icon('folder'), h('span', { class: 'lbl' }, 'Layouts'));
    this.closetBtn = h('button', { class: 'tool', 'aria-label': 'Closet doors', onclick: () => app.setClosetDoors(!app.closetDoors) }, icon('door'), h('span', { class: 'lbl' }, 'Closet'));
    this.budgetChip = h('button', { class: 'budget-chip', onclick: () => this.openBudget(), 'aria-label': 'Budget details' });
    this.layoutLabel = h('div', { class: 'layout-name' });
    this.modeSwitch = h('div', { class: 'modes', role: 'group', 'aria-label': 'Walk or overview' },
      h('button', { 'data-mode': 'walk', 'aria-label': 'Walk', title: 'Walk through the rooms in first person', onclick: () => app.setViewMode('walk') }, icon('walk'), h('span', { class: 'lbl' }, 'Walk')),
      h('button', { 'data-mode': 'overview', 'aria-label': 'Overview', title: 'Orbit view, floor plan and photo views', onclick: () => app.setViewMode('overview') }, icon('orbit'), h('span', { class: 'lbl' }, 'Overview')));
    this.invBtn = h('button', { class: 'tool icon-only', 'aria-label': 'Inventory', onclick: () => this.toggleInventory() }, icon('bag'), h('span', { class: 'lbl' }, 'Inventory'), h('span', { class: 'count', 'data-testid': 'inv-count' }));
    this.warnBtn = h('button', { class: 'tool icon-only warn-tool', 'aria-label': 'Fit warnings', onclick: () => this.openWarnings() }, icon('warn'), h('span', { class: 'lbl' }, 'Warnings'), h('span', { class: 'count', 'data-testid': 'warn-count' }));
    this.soundBtn = h('button', { class: 'tool icon-only', 'aria-label': 'Sound on or off', onclick: () => app.setMuted(!app.sounds.muted) });
    this.settingsBtn = h('button', { class: 'tool icon-only', 'aria-label': 'Settings', onclick: () => this.toggleMenu('settings') }, icon('gear'), h('span', { class: 'lbl' }, 'Settings'));
    const bar = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('b', {}, 'Reno 3D'), this.layoutLabel),
      this.modeSwitch,
      this.tabs,
      h('div', { class: 'tools' }, this.modeBtn, this.curtainBtn, this.closetBtn, this.viewBtn, this.itemsBtn, this.invBtn, this.warnBtn, this.layoutsBtn, this.soundBtn, this.settingsBtn),
      this.budgetChip);
    this.menu = h('div', { class: 'menu', hidden: true });
    this.banner = h('div', { class: 'banner', hidden: true, role: 'alert' });
    this.panel = h('aside', { class: 'panel', hidden: true, 'aria-label': 'Selected item' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.modal = h('div', { class: 'modal-back', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });
    this.hint = h('div', { class: 'hint' }, 'Tap an item to see it, swap it or buy it. Drag a selected item to move it.');
    this.walkHud = new WalkHud(app);
    this.inventory = new InventoryPanel(app);
    this.warnStack = new WarnStack(app);
    this.goalsPanel = new GoalsPanel(app);
    this.tutorial = new Tutorial(app);
    this.sparkles = h('div', { class: 'sparkles', 'aria-hidden': 'true' });
    // panels below the top bar follow its height (it wraps on narrow screens)
    new ResizeObserver(() => document.documentElement.style.setProperty('--bar-bottom', `${Math.round(bar.getBoundingClientRect().bottom)}px`)).observe(bar);
    this.root.append(this.walkHud.root, bar, this.warnStack.root, this.goalsPanel.root, this.menu, this.banner, this.panel, this.inventory.root, this.tutorial.root, this.toasts, this.modal, this.hint, this.sparkles);
    setTimeout(() => this.hint.classList.add('fade'), 7000);
  }

  /** Is a panel open that takes the keyboard (inventory, a dialog)? */
  modalOpen() { return this.inventory.isOpen || !this.modal.hidden; }

  /** Esc: close the top-most panel; returns true if something closed. */
  closeTop() {
    if (!this.modal.hidden) { this.closeModal(); return true; }
    if (this.inventory.hide()) return true;
    if (!this.menu.hidden) { this.menu.hidden = true; return true; }
    if (!this.panel.hidden) { this.app.select(null); return true; }
    return false;
  }

  toggleInventory() {
    if (this.inventory.isOpen) { this.inventory.hide(); return; }
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.menu.hidden = true;
    this.inventory.show();
  }

  openWarnings() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.openModal('warnings', 'Fit warnings', warningsPanel(this.app));
  }

  sparkle() {
    const s = this.sparkles;
    s.replaceChildren(...Array.from({ length: 18 }, (_, i) => h('i', { style: `--a:${(i * 360) / 18}deg; --d:${60 + (i % 3) * 30}px; --t:${0.6 + (i % 4) * 0.1}s` })));
    s.classList.remove('go');
    void s.offsetWidth;
    s.classList.add('go');
  }

  update(what) {
    const app = this.app;
    const walk = app.viewMode === 'walk';
    for (const b of this.tabs.children) b.setAttribute('aria-selected', String(b.dataset.room === app.roomId));
    for (const b of this.modeSwitch.children) b.setAttribute('aria-pressed', String(b.dataset.mode === app.viewMode));
    document.body.classList.toggle('mode-walk', walk);
    this.modeBtn.replaceChildren(icon(app.mode === 'day' ? 'sun' : 'moon'), h('span', { class: 'lbl' }, app.mode === 'day' ? 'Day' : 'Night'));
    this.modeBtn.classList.toggle('on', app.mode === 'night');
    this.curtainBtn.classList.toggle('on', app.curtainsClosed);
    this.curtainBtn.querySelector('.lbl').textContent = app.curtainsClosed ? 'Curtains closed' : 'Curtains open';
    this.closetBtn.hidden = app.roomId !== 'bedroom';
    this.closetBtn.classList.toggle('on', !app.closetDoors);
    this.closetBtn.querySelector('.lbl').textContent = app.closetDoors ? 'Closet closed' : 'Closet open';
    this.viewBtn.hidden = walk;
    this.itemsBtn.hidden = walk;
    const muted = app.sounds.muted;
    this.soundBtn.replaceChildren(icon(muted ? 'mute' : 'sound'), h('span', { class: 'lbl' }, muted ? 'Sound off' : 'Sound on'));
    this.soundBtn.classList.toggle('on', !muted);
    const nInv = app.layout.inventory.reduce((a, g) => a + g.keys.length, 0);
    this.invBtn.querySelector('.count').textContent = nInv ? String(nInv) : '';
    const nWarn = app.explained().active.length;
    this.warnBtn.querySelector('.count').textContent = nWarn ? String(nWarn) : '';
    this.warnBtn.classList.toggle('has', nWarn > 0);
    for (const b of [this.modeBtn, this.curtainBtn, this.closetBtn, this.viewBtn, this.itemsBtn, this.layoutsBtn, this.invBtn, this.warnBtn, this.soundBtn, this.settingsBtn]) b.title = b.querySelector('.lbl')?.textContent || '';
    this.layoutLabel.textContent = app.tutorial ? 'Tutorial (practice copy)' : app.layoutName;
    const b = app.budget;
    this.budgetChip.className = `budget-chip ${b.over ? 'over' : 'ok'}`;
    this.budgetChip.replaceChildren(h('span', { class: 'k' }, 'Total'), h('strong', { 'data-testid': 'budget-total' }, fmtMoney(b.totalCents)), h('span', { class: 'cap' }, ` of ${fmtMoney(b.capCents)}`));
    this.renderBanner();
    this.hint.hidden = walk;
    if (['select', 'layout', 'room', 'all', 'loaded', 'mode'].includes(what)) this.renderPanel();
    if (what === 'drag') this.renderPanelWarnings();
    if (!this.menu.hidden && ['layout', 'room', 'loaded', 'viewmode', 'settings'].includes(what)) this.renderMenu(this.menuKind);
    if (this.modalKind === 'budget' && ['layout', 'all'].includes(what)) this.openBudget();
    if (this.modalKind === 'warnings' && ['layout', 'room', 'all'].includes(what)) this.openWarnings();
    if (['layout', 'room', 'all', 'loaded'].includes(what)) this.inventory.render();
    if (what !== 'drag') { this.warnStack.render(); this.goalsPanel.render(); }
    this.walkHud.show(walk);
  }

  toast(msg, kind = 'info') {
    const t = h('div', { class: `toast ${kind}` }, msg);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  // ------------------------------------------------------------------------------------------
  renderBanner() {
    if (this.app.viewMode === 'walk') { this.banner.hidden = true; return; }
    const w = this.app.activeWarnings();
    const sel = this.app.selected;
    const mine = sel ? w.filter((x) => x.key === sel || x.other === sel) : [];
    const list = mine.length ? mine : w;
    if (!list.length) { this.banner.hidden = true; return; }
    this.banner.hidden = false;
    this.banner.replaceChildren(icon('warn'), h('div', {},
      h('strong', {}, mine.length ? 'Fit warning' : `${w.length} fit warning${w.length > 1 ? 's' : ''} in this room`),
      h('ul', {}, ...list.slice(0, 3).map((x) => h('li', {}, x.message))),
      list.length > 3 ? h('div', { class: 'more' }, `+${list.length - 3} more`) : null));
  }

  renderPanelWarnings() {
    const box = $('.item-warnings', this.panel);
    if (!box) return;
    const sel = this.app.selected;
    const w = this.app.activeWarnings().filter((x) => x.key === sel || x.other === sel);
    box.replaceChildren(...w.map((x) => h('div', { class: 'warn-line' }, icon('warn'), x.message)));
  }

  renderPanel() {
    const app = this.app;
    const it = app.item(app.selected);
    if (!it) { this.panel.hidden = true; document.body.classList.remove('has-panel'); return; }
    this.panel.hidden = false;
    document.body.classList.add('has-panel');
    const close = h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => app.select(null) }, icon('close'));
    const content = it.kind === 'product' ? this.productCard(it) : this.existingCard(it);
    this.panel.replaceChildren(h('div', { class: 'grip' }), close, content);
    this.panel.scrollTop = 0;
  }

  productCard(it) {
    const app = this.app, p = it.product, slot = it.slot;
    const used = p.condition === 'used';
    const was = p.regular_price && p.regular_price > p.price ? h('s', { class: 'was' }, fmtMoney(toCents(p.regular_price))) : null;
    const qty = (p.qty ?? 1) > 1 ? h('span', { class: 'qty' }, ` × ${p.qty} = ${fmtMoney(lineCents(p))}`) : null;
    const est = p.dimensions_estimated?.length ? h('span', { class: 'est' }, ` (estimated: ${p.dimensions_estimated.join(', ')})`) : null;
    const d = p.dimensions_in;
    const card = h('div', { class: 'card', 'data-testid': 'item-card', 'data-product': p.id },
      h('div', { class: 'photo' }, h('img', { src: photoUrl(p), alt: p.name, loading: 'lazy' })),
      h('div', { class: 'title' },
        h('h2', {}, p.name),
        h('div', { class: 'brand-line' }, [p.brand, p.retailer].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '))),
      h('div', { class: 'price-line' },
        h('strong', { class: 'price', 'data-testid': 'item-price' }, fmtMoney(toCents(p.price))), was, qty,
        h('span', { class: `badge ${used ? 'used' : 'new'}` }, used ? 'Used' : 'New'),
        p.taxed ? null : h('span', { class: 'badge plain' }, 'No tax')),
      h('div', { class: 'status' }, p.status_today),
      h('div', { class: 'buy-row' },
        h('a', { class: 'btn primary', href: p.buy_url, target: '_blank', rel: 'noopener', 'data-testid': 'buy' }, `Buy${p.retailer ? ` at ${p.retailer}` : ''}`),
        used && p.backup_search_url ? h('a', { class: 'btn ghost', href: p.backup_search_url, target: '_blank', rel: 'noopener', 'data-testid': 'backup' }, 'Backup search') : null),
      this.swapBlock(slot, p.id, it),
      it.hidden
        ? h('div', { class: 'move' }, h('p', { class: 'note' }, 'These inserts go inside the pillow covers, so they are not drawn. They still count in the budget.'),
          h('div', { class: 'acts' }, h('button', { class: 'btn danger', 'data-testid': 'remove', onclick: () => app.removeSelected() }, icon('trash'), 'Remove')))
        : this.moveBlock(it),
      h('div', { class: 'item-warnings' }),
      h('details', { class: 'more-info' }, h('summary', {}, 'Details'),
        h('dl', {},
          h('dt', {}, 'Size'), h('dd', {}, `${d.w}" W × ${d.d}" D × ${d.h}" H`, est),
          h('dt', {}, 'Color'), h('dd', {}, h('span', { class: 'swatch', style: `background:${p.main_color_hex}` }), ` ${p.main_color_hex}`),
          h('dt', {}, 'Material'), h('dd', {}, p.material || '—'),
          p.unit_note ? [h('dt', {}, 'Unit'), h('dd', {}, p.unit_note)] : null,
          p.bulb_spec ? [h('dt', {}, 'Bulb'), h('dd', {}, p.bulb_spec)] : null,
          p.rating ? [h('dt', {}, 'Rating'), h('dd', {}, p.rating)] : null,
          h('dt', {}, 'Placement'), h('dd', {}, [slot.rule_applied, slot.notes].filter(Boolean).join(' ') || '—'),
          p.description ? [h('dt', {}, 'Why'), h('dd', {}, p.description)] : null,
          p.color_note ? [h('dt', {}, 'Note'), h('dd', {}, p.color_note)] : null,
          p.price_note ? [h('dt', {}, 'Price'), h('dd', {}, p.price_note)] : null,
          h('dt', {}, '3D model'), h('dd', {}, p.model_3d_url ? 'IKEA 3D model (stored with the app)' : 'Built from the product size, color and photo'),
          h('dt', {}, 'ID'), h('dd', {}, p.id))));
    queueMicrotask(() => this.renderPanelWarnings());
    return card;
  }

  swapBlock(slot, currentId, it = null) {
    const letters = 'ABCDEFGH';
    return h('div', { class: 'swap' },
      h('div', { class: 'swap-head' }, h('span', {}, slot.label), h('small', {}, `${slot.options.length} option${slot.options.length > 1 ? 's' : ''}`)),
      h('div', { class: 'options' }, ...slot.options.map((pid, i) => {
        const p = this.cat.products.get(pid);
        const isDef = pid === slot.default_option;
        return h('button', {
          class: `opt ${pid === currentId ? 'current' : ''}`,
          'data-option': pid,
          'aria-pressed': String(pid === currentId),
          onclick: () => { if (pid !== currentId) { if (it?.extra) this.app.swapPiece(it.key, pid); else this.app.swap(slot.slot_id, pid); } },
        },
        h('img', { src: photoUrl(p), alt: '', loading: 'lazy' }),
        h('span', { class: 'opt-text' },
          h('b', {}, `Option ${letters[i]}`, isDef ? h('span', { class: 'def', title: "Designer's pick" }, ' ★ Designer\'s pick') : null),
          h('span', { class: 'opt-name' }, p.name),
          h('span', { class: 'opt-price' }, fmtMoney(lineCents(p)), p.condition === 'used' ? ' · used' : '', p.status_today && /unavailable|out of stock/i.test(p.status_today) ? ' · unavailable today' : '')));
      })));
  }

  moveBlock(it) {
    const app = this.app;
    const wall = it.mount === 'wall';
    const pad = (dx, dy, label, rot) => h('button', { class: 'pad', 'aria-label': label, onclick: () => app.nudgeSelected(dx, dy, 3) }, h('span', { class: 'ico', style: `transform:rotate(${rot}deg)`, html: I.up }));
    return h('div', { class: 'move' },
      h('div', { class: 'move-help' }, wall ? 'Drag it along its wall, or use the arrows (3" steps).' : it.mount === 'top' ? `Drag it around on top of the ${it.supportId === 'EX-LR-SECTIONAL' ? 'sectional' : 'piece it rests on'}.` : 'Drag it on the floor, or use the arrows (3" steps). It stops at walls and furniture.'),
      h('div', { class: 'move-row' },
        h('div', { class: 'pads' }, pad(0, -1, 'Move away', 0), pad(-1, 0, 'Move left', -90), pad(1, 0, 'Move right', 90), pad(0, 1, 'Move closer', 180)),
        h('div', { class: 'acts' },
          h('button', { class: 'btn', 'data-testid': 'rotate-left', onclick: () => app.rotateSelected(wall ? -90 : 15) }, icon('rotL'), wall ? 'Turn' : '15°'),
          h('button', { class: 'btn', 'data-testid': 'rotate-right', onclick: () => app.rotateSelected(wall ? 90 : -15) }, icon('rotR'), wall ? 'Turn' : '15°'),
          h('button', { class: 'btn', onclick: () => app.resetSelectedPosition() }, icon('reset'), 'Reset spot'),
          h('button', { class: 'btn danger', 'data-testid': 'remove', onclick: () => app.removeSelected() }, icon('trash'), 'Remove'))));
  }

  existingCard(it) {
    const e = it.piece, d = it.dims;
    return h('div', { class: 'card', 'data-testid': 'item-card', 'data-existing': e.id },
      h('div', { class: 'title' }, h('h2', {}, e.name), h('div', { class: 'brand-line' }, 'Already yours · kept')),
      h('div', { class: 'price-line' }, h('span', { class: 'badge plain' }, 'Not in the budget')),
      e.placement ? h('p', { class: 'note' }, e.placement) : null,
      e.keep_status ? h('p', { class: 'note' }, e.keep_status) : null,
      this.moveBlock(it),
      h('div', { class: 'item-warnings' }),
      h('details', { class: 'more-info' }, h('summary', {}, 'Details'),
        h('dl', {},
          h('dt', {}, 'Size'), h('dd', {}, `${round(d.w)}" × ${round(d.d)}" × ${round(d.h)}"`, e.dims_status === 'ESTIMATED' ? h('span', { class: 'est' }, ' (estimated)') : null),
          h('dt', {}, 'Color'), h('dd', {}, h('span', { class: 'swatch', style: `background:${e.color_hex}` }), ` ${e.color_hex}`),
          h('dt', {}, 'Material'), h('dd', {}, e.material || '—'),
          e.dims_how ? [h('dt', {}, 'How measured'), h('dd', {}, e.dims_how)] : null)));
  }

  // ------------------------------------------------------------------------------------------
  toggleMenu(kind) {
    if (!this.menu.hidden && this.menuKind === kind) { this.menu.hidden = true; return; }
    this.menuKind = kind;
    this.menu.hidden = false;
    this.renderMenu(kind);
  }

  renderMenu(kind) {
    const app = this.app;
    const closeBtn = h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => { this.menu.hidden = true; } }, icon('close'));
    if (kind === 'views') {
      const rows = [
        h('button', { class: 'row', 'data-view': 'overview', onclick: () => { app.applyPreset('overview'); } }, h('b', {}, 'Overview'), h('small', {}, 'Orbit around the room')),
        h('button', { class: 'row', 'data-view': 'top', onclick: () => { app.applyPreset('top'); } }, h('b', {}, 'Floor plan'), h('small', {}, 'Straight down')),
        h('div', { class: 'sep' }, 'Matched to your photos'),
        ...PRESETS.filter((p) => p.room === app.roomId).map((p) => h('button', { class: `row ${app.currentPreset === p.id ? 'current' : ''}`, 'data-view': p.id, onclick: () => { app.applyPreset(p.id); if (matchMedia('(max-width: 720px)').matches) this.menu.hidden = true; } }, h('b', {}, p.label), h('small', {}, `facing ${p.facing}`))),
      ];
      this.menu.replaceChildren(h('div', { class: 'menu-head' }, h('b', {}, 'Camera views'), closeBtn), h('div', { class: 'menu-body' }, ...rows));
    } else if (kind === 'settings') {
      const st = app.settings;
      const eye = h('input', { type: 'number', min: '40', max: '84', step: '1', value: String(st.eyeHeight), 'aria-label': 'Eye height in inches', 'data-testid': 'eye-height',
        onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 40 && v <= 84) app.setEyeHeight(v); else e.target.value = String(app.settings.eyeHeight); } });
      const check = (label, on, fn, testid) => h('label', { class: 'set-row' }, h('input', { type: 'checkbox', checked: on ? true : null, 'data-testid': testid, onchange: (e) => fn(e.target.checked) }), h('span', {}, label));
      this.menu.replaceChildren(h('div', { class: 'menu-head' }, h('b', {}, 'Settings'), closeBtn), h('div', { class: 'menu-body settings' },
        h('div', { class: 'sep' }, 'Walk mode'),
        h('label', { class: 'set-row' }, h('span', {}, 'Eye height'), eye, h('small', {}, 'inches (68 for 6\'0")')),
        check('Hands sway a little when idle', st.sway, (v) => { st.sway = v; app.saveSettings(); }, 'sway'),
        matchMedia('(pointer: coarse)').matches ? null : check('Show the key hints', st.hints, (v) => this.walkHud.setHints(v), 'hints'),
        check('Sound', !app.sounds.muted, (v) => app.setMuted(!v), 'sound'),
        h('button', { class: 'row', 'data-testid': 'replay-tutorial', onclick: () => { this.menu.hidden = true; app.startTutorial(); } }, h('b', {}, 'Replay the tutorial'), h('small', {}, 'About 30 seconds, on a practice copy'))));
    } else if (kind === 'items') {
      const slots = this.cat.slotsByRoom[app.roomId] || [];
      const rows = slots.map((s) => {
        const sel = app.layout.slots[s.slot_id];
        const p = sel.option ? this.cat.products.get(sel.option) : null;
        if (!p) {
          return h('div', { class: 'row removed' }, h('span', { class: 'thumb empty' }),
            h('span', { class: 'row-text' }, h('b', {}, s.label), h('small', {}, 'Removed')),
            h('button', { class: 'btn small', 'data-restore': s.slot_id, onclick: () => app.restore(s.slot_id) }, 'Add back'));
        }
        return h('button', { class: `row ${app.selected?.startsWith(`${s.slot_id}#`) ? 'current' : ''}`, 'data-slot': s.slot_id, onclick: () => { app.select(`${s.slot_id}#0`); if (!app.item(`${s.slot_id}#0`)?.hidden) app.focus(`${s.slot_id}#0`); if (matchMedia('(max-width: 720px)').matches) this.menu.hidden = true; } },
          h('img', { class: 'thumb', src: photoUrl(p), alt: '', loading: 'lazy' }),
          h('span', { class: 'row-text' }, h('b', {}, s.label), h('small', {}, p.name)),
          h('span', { class: 'row-price' }, fmtMoney(lineCents(p))));
      });
      const ex = (this.cat.existingByRoom[app.roomId] || []).filter((e) => app.layout.existing[e.id]).map((e) => {
        const st = app.layout.existing[e.id];
        if (st.hidden) return h('div', { class: 'row removed' }, h('span', { class: 'row-text' }, h('b', {}, e.name), h('small', {}, 'Hidden')), h('button', { class: 'btn small', onclick: () => app.restore(e.id) }, 'Show'));
        return h('button', { class: 'row', 'data-existing': e.id, onclick: () => { app.select(`${e.id}#0`); app.focus(`${e.id}#0`); if (matchMedia('(max-width: 720px)').matches) this.menu.hidden = true; } }, h('span', { class: 'row-text' }, h('b', {}, e.name), h('small', {}, 'Already yours')));
      });
      this.menu.replaceChildren(h('div', { class: 'menu-head' }, h('b', {}, 'Items in this room'), closeBtn), h('div', { class: 'menu-body' }, h('div', { class: 'sep' }, 'New & used pieces'), ...rows, h('div', { class: 'sep' }, 'Already yours'), ...ex));
    }
  }

  // ------------------------------------------------------------------------------------------
  openModal(kind, title, ...body) {
    this.modalKind = kind;
    this.modal.hidden = false;
    this.modal.replaceChildren(h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.closeModal() }, icon('close'))),
      h('div', { class: 'modal-body' }, ...body)));
  }
  closeModal() { this.modal.hidden = true; this.modalKind = null; }

  openBudget() {
    const b = this.app.budget;
    const meta = this.cat.budgetMeta || {};
    const pct = Math.min(100, (b.totalCents / b.capCents) * 100);
    const rows = (room) => b.lines.filter((l) => l.room === room).map((l) => h('tr', {},
      h('td', {}, l.name, l.qty > 1 ? h('small', {}, ` × ${l.qty}`) : null),
      h('td', {}, h('span', { class: `badge ${l.taxed ? 'new' : 'used'}` }, l.taxed ? 'New' : 'Used')),
      h('td', { class: 'num' }, fmtMoney(l.cents))));
    const removed = [...this.cat.slots.values()].filter((s) => this.app.layout.slots[s.slot_id].option === null);
    this.openModal('budget', 'Budget',
      h('div', { class: `budget-summary ${b.over ? 'over' : 'ok'}` },
        h('div', { class: 'big', 'data-testid': 'budget-modal-total' }, fmtMoney(b.totalCents)),
        h('div', {}, `of your ${fmtMoney(b.capCents)} budget · `, h('b', {}, b.over ? `${fmtMoney(-b.remainingCents)} over` : `${fmtMoney(b.remainingCents)} left`)),
        h('div', { class: 'bar' }, h('span', { style: `width:${pct}%` }))),
      b.over && meta.owner_approval && Math.abs(-b.remainingCents - toCents(meta.owner_approved_overage || 0)) < 1 ? h('p', { class: 'note' }, `Approved: ${meta.owner_approval}.`) : null,
      h('table', { class: 'totals' },
        h('tr', {}, h('td', {}, 'New items (taxed)'), h('td', { class: 'num', 'data-testid': 'sub-new' }, fmtMoney(b.taxedCents))),
        h('tr', {}, h('td', {}, `Sales tax ${(b.taxRate * 100).toFixed(2)}% on new items`), h('td', { class: 'num', 'data-testid': 'tax' }, fmtMoney(b.taxCents))),
        h('tr', {}, h('td', {}, 'Used items (private sales, no tax)'), h('td', { class: 'num', 'data-testid': 'sub-used' }, fmtMoney(b.untaxedCents))),
        h('tr', {}, h('td', {}, 'Delivery'), h('td', { class: 'num' }, fmtMoney(b.deliveryCents))),
        h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', { class: 'num' }, fmtMoney(b.totalCents)))),
      meta.delivery_note ? h('p', { class: 'note' }, `Delivery: ${meta.delivery_note}.`) : null,
      h('h3', {}, 'Living room'), h('table', { class: 'lines' }, ...rows('living')),
      h('h3', {}, 'Bedroom'), h('table', { class: 'lines' }, ...rows('bedroom')),
      removed.length ? h('p', { class: 'note' }, `Removed: ${removed.map((s) => s.label).join(', ')}.`) : null);
  }

  openLayouts(compareIds) {
    const app = this.app;
    const saved = store.listSaved();
    const total = (layout) => {
      const prev = app.layout; app.layout = layout; const t = app.budget.totalCents; app.layout = prev; return t;
    };
    const nameInput = h('input', { type: 'text', placeholder: 'Name, e.g. Layout A', value: app.layoutName === "Designer's layout" ? '' : app.layoutName, 'aria-label': 'Layout name', 'data-testid': 'layout-name' });
    const saveBtn = h('button', { class: 'btn primary', 'data-testid': 'save-layout', onclick: () => {
      const name = store.saveAs(nameInput.value || `Layout ${String.fromCharCode(65 + saved.length)}`, app.layout);
      app.layoutName = name;
      store.saveCurrent(name, app.layout);
      this.toast(`Saved "${name}" in this browser.`, 'info');
      this.openLayouts();
      app.emit('layout');
    } }, 'Save');
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-testid': 'import-file', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const parsed = store.parseImport(this.cat, await f.text());
        const names = store.importLayouts(parsed);
        this.toast(`Imported ${names.length} layout${names.length > 1 ? 's' : ''}: ${names.join(', ')}`, 'info');
        for (const w of parsed.warnings) this.toast(w, 'warn');
      } catch (err) { this.toast(err.message, 'error'); }
      this.openLayouts();
    } });
    const confirmReset = h('div', { class: 'confirm', hidden: true },
      h('span', {}, 'Replace the current layout with the designer\'s?'),
      h('button', { class: 'btn danger', 'data-testid': 'reset-confirm', onclick: () => { app.resetToDesigner(); this.closeModal(); this.toast("Back to the designer's layout.", 'info'); } }, 'Yes, reset'),
      h('button', { class: 'btn', onclick: (e) => { e.target.parentElement.hidden = true; } }, 'Cancel'));
    const rows = saved.map((l) => {
      const del = h('div', { class: 'confirm', hidden: true }, h('span', {}, `Delete "${l.name}"?`),
        h('button', { class: 'btn danger', onclick: () => { store.deleteSaved(l.id); this.openLayouts(); } }, 'Delete'),
        h('button', { class: 'btn', onclick: (e) => { e.target.parentElement.hidden = true; } }, 'Cancel'));
      const ren = h('input', { type: 'text', value: l.name, class: 'rename', hidden: true, onkeydown: (e) => { if (e.key === 'Enter') { store.renameSaved(l.id, e.target.value); this.openLayouts(); } } });
      return h('div', { class: 'saved-row', 'data-layout': l.name },
        h('div', { class: 'saved-main' },
          h('b', {}, l.name), ren,
          h('small', {}, `${new Date(l.updated).toLocaleString()} · ${fmtMoney(total(store.normalizeFor(this.cat, l.layout)))}`)),
        h('div', { class: 'saved-acts' },
          h('button', { class: 'btn small primary', 'data-testid': 'load-layout', onclick: () => { app.loadLayout(store.normalizeFor(this.cat, l.layout), l.name); this.closeModal(); this.toast(`Loaded "${l.name}".`, 'info'); } }, 'Load'),
          h('button', { class: 'btn small', onclick: () => { ren.hidden = false; ren.focus(); } }, 'Rename'),
          h('button', { class: 'btn small', onclick: () => download(`${slug(l.name)}.json`, store.exportFile([l])) }, 'Export'),
          h('button', { class: 'btn small danger', onclick: () => { del.hidden = false; } }, 'Delete')),
        del);
    });
    const a = h('select', { 'aria-label': 'Layout A', 'data-testid': 'cmp-a' }, h('option', { value: '__current' }, 'Current view'), ...saved.map((l) => h('option', { value: l.id }, l.name)));
    const b = h('select', { 'aria-label': 'Layout B', 'data-testid': 'cmp-b' }, h('option', { value: '__current' }, 'Current view'), ...saved.map((l) => h('option', { value: l.id }, l.name)));
    if (compareIds) { a.value = compareIds[0]; b.value = compareIds[1]; } else if (saved.length >= 2) { a.value = saved[0].id; b.value = saved[1].id; } else if (saved.length === 1) { a.value = saved[0].id; }
    const cmpOut = h('div', { class: 'compare-out', 'data-testid': 'compare-out' });
    const pickLayout = (v) => (v === '__current' ? { name: 'Current view', layout: app.layout } : (() => { const l = store.getSaved(v); return { name: l.name, layout: store.normalizeFor(this.cat, l.layout) }; })());
    const compare = () => {
      const A = pickLayout(a.value), B = pickLayout(b.value);
      const diff = store.diffLayouts(this.cat, A.layout, B.layout);
      const tA = total(A.layout), tB = total(B.layout);
      const nm = (r, v) => (r.existingId ? (v ? 'Kept' : 'Hidden') : v ? this.cat.products.get(v).name : 'Removed');
      cmpOut.replaceChildren(
        h('table', { class: 'cmp' },
          h('tr', {}, h('th', {}, ''), h('th', {}, A.name), h('th', {}, B.name)),
          h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', { class: 'num' }, fmtMoney(tA)), h('td', { class: 'num' }, fmtMoney(tB))),
          h('tr', {}, h('td', {}, 'Difference'), h('td', {}, ''), h('td', { class: 'num' }, `${tB - tA >= 0 ? '+' : ''}${fmtMoney(tB - tA)}`)),
          ...diff.map((r) => h('tr', {}, h('td', {}, r.label, h('small', {}, ` (${r.room === 'living' ? 'living room' : 'bedroom'})`)),
            h('td', {}, nm(r, r.a), r.sameOption && r.moved ? h('small', {}, ' · moved') : null),
            h('td', {}, nm(r, r.b), r.sameOption && r.moved ? h('small', {}, ' · moved') : null)))),
        diff.length ? null : h('p', { class: 'note' }, 'These two layouts are the same.'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => { app.loadLayout(A.layout, A.name); this.toast(`Showing ${A.name}`, 'info'); } }, `View ${A.name}`),
          h('button', { class: 'btn', onclick: () => { app.loadLayout(B.layout, B.name); this.toast(`Showing ${B.name}`, 'info'); } }, `View ${B.name}`)));
    };
    this.openModal('layouts', 'Layouts',
      h('section', {}, h('h3', {}, 'Save the current layout'), h('div', { class: 'inline' }, nameInput, saveBtn),
        h('p', { class: 'note' }, 'Layouts are kept in this browser. Export them to a file so you don\'t lose them.')),
      h('section', {}, h('h3', {}, `Saved layouts (${saved.length})`), saved.length ? h('div', { class: 'saved-list' }, ...rows) : h('p', { class: 'note' }, 'Nothing saved yet.')),
      h('section', {}, h('h3', {}, 'Compare'), h('div', { class: 'inline' }, a, h('span', {}, 'vs'), b, h('button', { class: 'btn', 'data-testid': 'compare', onclick: compare }, 'Compare')), cmpOut),
      h('section', {}, h('h3', {}, 'Files'),
        h('div', { class: 'inline wrap' },
          h('button', { class: 'btn', 'data-testid': 'export-all', onclick: () => download('room-layouts.json', store.exportFile(store.listSaved())) , disabled: !saved.length }, 'Export all saved'),
          h('button', { class: 'btn', 'data-testid': 'export-current', onclick: () => download(`${slug(app.layoutName)}.json`, store.exportFile([{ name: app.layoutName, layout: app.layout }])) }, 'Export current'),
          h('button', { class: 'btn', 'data-testid': 'import', onclick: () => fileIn.click() }, 'Import…'), fileIn)),
      h('section', {}, h('h3', {}, "Designer's layout"),
        h('button', { class: 'btn danger', 'data-testid': 'reset-designer', onclick: () => { confirmReset.hidden = false; } }, "Reset to designer's layout"), confirmReset));
  }
}

function round(v) { return Math.round(v * 10) / 10; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layout'; }
function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

