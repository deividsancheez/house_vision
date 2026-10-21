// The lookbook: an editorial, shoppable walk through both rooms, built entirely from the lookbook
// products.json (copied into data/lookbook/ by scripts/build-assets.mjs), inspiration.json and the
// designer's notes. My Picks are kept in this browser and shared with the 3D rooms (src/shared/lbstore.js).
import '@fontsource-variable/cormorant-garamond/index.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/jost/index.css';
import './lookbook.css';
import * as C from './core.js';
import { readPicks, writePicks, readLayout, refsInLayout, pickRef, tryRef, PICKS_KEY, LAYOUT_KEY } from '../shared/lbstore.js';

const DATA = '../data/lookbook/';
const APP3D = '../';
const PALETTE = [
  ['Plaster', '#F4EFE7'], ['Oat linen', '#E6DCCB'], ['Warm sand', '#D3C1A5'], ['Light oak', '#C4A27C'], ['Camel', '#A87B4F'],
  ['Terracotta rust', '#A65A3A'], ['Olive', '#6E6B47'], ['Chocolate', '#4A3428'], ['Ink black', '#1F1D1B'],
];
// categories left out of the mood boards: they read as lines or hide inside other pieces
const MOOD_SKIP = new Set(['ROD', 'INSERT', 'CABLE']);

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const ICON = {
  arrowL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
  cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
};
const icon = (n, cls = 'ico') => h('span', { class: cls, html: ICON[n] });
const img = (file) => DATA + file;
const imgSmall = (file) => DATA + String(file).replace(/^images\//, 'images/sm/');

class Lookbook {
  constructor(root) {
    this.root = root;
    this.state = readPicks();
    this.placed = refsInLayout(readLayout());
    this.colors = new Map(); // product id -> color shown on its card (null: as listed)
    this.filters = { living: C.emptyFilters(), bedroom: C.emptyFilters() };
    this.compare = false;
    this.cur = -1;
  }

  async start() {
    const get = async (f, type = 'json') => {
      const r = await fetch(f, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
      return type === 'json' ? r.json() : r.text();
    };
    const [doc, insp, notes, manual, d3] = await Promise.all([
      get(`${DATA}products.json`), get(`${DATA}inspiration.json`), get(`${DATA}design-notes.md`, 'text'), get(`${DATA}MANUAL-ACTION-NEEDED.md`, 'text'),
      get('../data/products.json').catch(() => ({ slots: [] })),
    ]);
    this.index = C.buildIndex(doc, d3.slots || []);
    this.insp = insp;
    this.notesMd = notes;
    this.manualMd = manual;
    this.concepts = C.concepts(notes);
    this.blurbs = C.packageBlurbs(notes);
    this.pages = this.buildPages();
    this.build();
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('storage', (e) => {
      if (e.key === PICKS_KEY) { this.state = readPicks(); this.afterPicks(false); }
      if (e.key === LAYOUT_KEY) { this.placed = refsInLayout(readLayout()); this.afterPicks(false); }
    });
    // coming back from the 3D rooms in the same tab (bfcache) or another tab: re-read
    window.addEventListener('pageshow', () => this.reread());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reread(); });
    this.route();
    document.body.classList.add('ready');
  }

  reread() {
    const s = JSON.stringify(this.state), p = [...this.placed].join('|');
    this.state = readPicks();
    this.placed = refsInLayout(readLayout());
    if (JSON.stringify(this.state) !== s || [...this.placed].join('|') !== p) this.afterPicks(false);
  }

  // ------------------------------------------------------------------------------------------
  // Pages

  buildPages() {
    const pages = [{ id: 'cover', title: 'Cover', nav: 'cover' }, { id: 'inspiration', title: 'Inspiration', nav: 'inspiration' }];
    for (const room of C.ROOMS) {
      const cats = C.roomCategories(this.index, room);
      pages.push({ id: room, title: C.ROOM_NAME[room], nav: room, room, kind: 'opening' });
      cats.forEach((cat, i) => pages.push({ id: `${room}/${cat.id}`, title: cat.label, nav: room, room, kind: 'category', cat, n: i + 1, of: cats.length }));
    }
    pages.push({ id: 'packages', title: 'Packages', nav: 'packages' }, { id: 'notes', title: 'Buying order & notes', nav: 'notes' });
    return pages;
  }

  build() {
    this.navLinks = [
      ['cover', 'Cover'], ['inspiration', 'Inspiration'], ['living', 'Living Room'], ['bedroom', 'Bedroom'], ['packages', 'Packages'], ['notes', 'Notes'],
    ].map(([id, label]) => h('a', { href: `#/${id}`, 'data-nav': id, onclick: () => this.closeMenu() }, label));
    const link3d = h('a', { class: 'nav-3d', href: `${APP3D}?inv=lookbook`, 'data-nav': '3d' }, icon('cube'), '3D Rooms');
    this.menuBtn = h('button', { class: 'menu-btn', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: () => this.toggleMenu() }, icon('menu'));
    this.picksBtn = h('button', { class: 'picks-btn', 'data-testid': 'picks-button', 'aria-label': 'My Picks', onclick: () => this.openPicks() });
    this.nav = h('nav', { class: 'site-nav', 'aria-label': 'Lookbook' }, ...this.navLinks, link3d);
    this.header = h('header', { class: 'site-head' },
      h('a', { class: 'wordmark', href: '#/cover' }, h('span', { class: 'wm-1' }, 'The'), h('span', { class: 'wm-2' }, 'Lookbook')),
      this.nav, this.picksBtn, this.menuBtn);
    this.main = h('main', { class: 'pages', id: 'main', tabindex: '-1' });
    this.prevBtn = h('button', { class: 'edge-arrow prev', 'aria-label': 'Previous page', onclick: () => this.go(this.at - 1) }, icon('arrowL'));
    this.nextBtn = h('button', { class: 'edge-arrow next', 'aria-label': 'Next page', onclick: () => this.go(this.at + 1) }, icon('arrowR'));
    this.pager = h('div', { class: 'pager', 'data-testid': 'pager' });
    this.drawer = h('aside', { class: 'drawer', hidden: true, role: 'dialog', 'aria-label': 'My Picks', 'data-testid': 'picks-drawer' });
    this.scrim = h('div', { class: 'scrim', hidden: true, onclick: () => this.closeOverlays() });
    this.modal = h('div', { class: 'modal-back', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.root.replaceChildren(this.header, this.main, this.prevBtn, this.nextBtn, this.pager, this.scrim, this.drawer, this.modal, this.toasts);
    this.renderPicksButton();
    this.setupInput();
  }

  pageIndex(id) { return this.pages.findIndex((p) => p.id === id); }

  /** Read the address: #/living/LR-RUG, #/living/LR-RUG?p=LR-RUG-B, or #p=LR-RUG-B&room=bedroom. */
  route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    let id = 'cover', focus = null;
    if (/^p=/.test(hash)) {
      const q = new URLSearchParams(hash);
      const p = this.index.products.get(q.get('p'));
      if (p) {
        const room = C.ROOMS.includes(q.get('room')) ? q.get('room') : p.room === 'both' ? (C.candidateKeys(this.index, p, 'living')[0]?.room || 'living') : p.room;
        id = `${room}/${p.category}`;
        focus = p.id;
        history.replaceState(null, '', `#/${id}?p=${encodeURIComponent(p.id)}`);
      }
    } else if (hash.startsWith('/')) {
      const [path, query] = hash.slice(1).split('?');
      id = path || 'cover';
      focus = new URLSearchParams(query || '').get('p');
    }
    let i = this.pageIndex(id);
    if (i < 0) i = 0;
    this.show(i, focus);
  }

  go(i) {
    if (i < 0 || i >= this.pages.length || i === this.at) return;
    this.target = i === this.cur ? null : i; // a second press before the hash change lands steps on from here
    location.hash = `#/${this.pages[i].id}`;
  }

  // the page the reader is on or already heading to (keys and arrows step from here)
  get at() { return this.target ?? this.cur; }

  show(i, focus = null, { keepOverlays = false } = {}) {
    const dir = i > this.cur ? 'fwd' : 'back';
    const changed = i !== this.cur;
    this.cur = i;
    this.target = null;
    const page = this.pages[i];
    if (!keepOverlays) this.closeOverlays();
    const el = this.renderPage(page);
    el.classList.add('page', `page-${page.kind || page.id}`, changed ? `enter-${dir}` : 'enter-none');
    el.dataset.page = page.id;
    this.main.replaceChildren(el);
    document.title = `${page.title} · Lookbook`;
    for (const a of this.navLinks) a.toggleAttribute('aria-current', a.dataset.nav === page.nav);
    this.renderPager();
    if (focus) this.focusProduct(focus);
    else if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  focusProduct(id) {
    requestAnimationFrame(() => {
      const card = this.main.querySelector(`[data-product="${CSS.escape(id)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 2200);
    });
  }

  renderPager() {
    const prev = this.pages[this.cur - 1], next = this.pages[this.cur + 1];
    this.prevBtn.hidden = !prev;
    this.nextBtn.hidden = !next;
    this.prevBtn.title = prev ? `Previous: ${prev.title}` : '';
    this.nextBtn.title = next ? `Next: ${next.title}` : '';
    this.pager.replaceChildren(
      h('button', { class: 'pg prev', 'data-testid': 'prev', disabled: !prev, onclick: () => this.go(this.at - 1), 'aria-label': prev ? `Previous: ${prev.title}` : 'Previous' }, icon('arrowL'), h('span', { class: 'pg-label' }, prev ? prev.title : '')),
      h('span', { class: 'pg-count', 'data-testid': 'page-count' }, `${String(this.cur + 1).padStart(2, '0')} / ${this.pages.length}`),
      h('button', { class: 'pg next', 'data-testid': 'next', disabled: !next, onclick: () => this.go(this.at + 1), 'aria-label': next ? `Next: ${next.title}` : 'Next' }, h('span', { class: 'pg-label' }, next ? next.title : ''), icon('arrowR')));
  }

  renderPage(page) {
    if (page.id === 'cover') return this.renderCover();
    if (page.id === 'inspiration') return this.renderInspiration();
    if (page.kind === 'opening') return this.renderOpening(page.room);
    if (page.kind === 'category') return this.renderCategory(page);
    if (page.id === 'packages') return this.renderPackages();
    return this.renderNotes();
  }

  // ------------------------------------------------------------------------------------------
  renderCover() {
    const idx = this.index;
    const bal = C.packagePicks(idx, 'balanced').picks;
    const ids = Object.values(bal).map((p) => p.id);
    const pickFirst = (cat) => ids.map((id) => idx.products.get(id)).find((p) => p.category === cat);
    const hero = ['LR-RUG', 'LR-SCONCE', 'LR-COFFEE', 'BR-DUVET', 'BR-NIGHTSTAND'].map(pickFirst).filter(Boolean);
    const lc = this.concepts.living, bc = this.concepts.bedroom;
    const concept = [lc?.title, bc?.title].filter(Boolean).map((t, i) => (i ? t : t.charAt(0).toUpperCase() + t.slice(1))).join('; ') + '.';
    const nProducts = idx.products.size;
    return h('section', { 'aria-label': 'Cover' },
      h('div', { class: 'cover' },
        h('div', { class: 'cover-text' },
          h('p', { class: 'kicker' }, `The renovation lookbook · Prepared ${C.fmtDate(idx.doc.generated)}`),
          h('h1', { class: 'cover-title' }, h('span', {}, 'Living Room'), h('em', {}, '&'), h('span', {}, 'Bedroom')),
          h('p', { class: 'lede', 'data-testid': 'concept' }, concept),
          h('ul', { class: 'palette', 'aria-label': 'Palette' }, ...PALETTE.map(([name, hex]) => h('li', {}, h('span', { class: 'chip', style: { background: hex } }), h('span', { class: 'chip-name' }, name), h('span', { class: 'chip-hex' }, hex)))),
          h('div', { class: 'cover-cta' },
            h('a', { class: 'btn primary big', href: '#/inspiration', 'data-testid': 'start' }, 'Start the lookbook', icon('arrowR')),
            h('a', { class: 'btn ghost', href: '#/packages' }, 'See the packages')),
          h('p', { class: 'cover-meta' }, `${nProducts} pieces in ${idx.categories.length} categories · prices and stock checked ${C.fmtDate(idx.doc.generated)} for ZIP ${idx.doc.stock_zip}`)),
        h('div', { class: 'cover-art', 'aria-hidden': 'true' }, ...hero.map((p, i) => h('figure', { class: `ca ca-${i + 1}` }, h('img', { src: img(p.image_file), alt: '', decoding: 'async', fetchpriority: i < 2 ? 'high' : 'auto' }))))));
  }

  renderInspiration() {
    const col = (room, list) => h('div', { class: 'insp-col' },
      h('h3', { class: 'insp-room' }, C.ROOM_NAME[room]),
      ...list.map((x, i) => h('article', { class: 'insp-card', 'data-testid': 'insp-card' },
        h('div', { class: 'insp-num' }, String(i + 1).padStart(2, '0')),
        h('p', { class: 'kicker' }, x.platform),
        h('h4', {}, h('a', { href: x.source_url, target: '_blank', rel: 'noopener' }, x.title)),
        h('p', { class: 'insp-take' }, x.takeaway),
        h('p', { class: 'insp-by' }, 'By ', h('strong', {}, x.creator), ' · ', h('a', { class: 'insp-link', href: x.source_url, target: '_blank', rel: 'noopener', 'data-testid': 'insp-link' }, `Read on ${x.platform}`, icon('ext', 'ico sm'))))));
    return h('section', { 'aria-label': 'Inspiration' },
      h('header', { class: 'page-head' },
        h('p', { class: 'kicker' }, 'Before we shop'),
        h('h2', {}, 'Inspiration'),
        h('p', { class: 'page-intro' }, 'Ideas the designer pulled for each room, credited to the people who wrote them. Every link opens the original.')),
      h('div', { class: 'insp-grid' }, col('living', this.insp.living || []), col('bedroom', this.insp.bedroom || [])),
      h('p', { class: 'fineprint' }, `${this.insp.note} Checked ${C.fmtDate(this.insp.checked)}.`));
  }

  /** The products of a room's recommended (BALANCED) package: the look of the mood board. */
  lookOf(room) {
    const idx = this.index;
    const { picks } = C.packagePicks(idx, 'balanced');
    return Object.entries(picks).map(([key, v]) => ({ key, p: idx.products.get(v.id), qty: v.qty }))
      .filter(({ key, p }) => (C.roomOfPick(idx, key, p) || this.slotRoomOf(p)) === room && !MOOD_SKIP.has(p.category));
  }

  slotRoomOf(p) {
    const s = String(p.slot_3d || '').split('|')[0];
    return this.index.slotInfo.get(s)?.room || (s.startsWith('LR-') ? 'living' : s.startsWith('BR-') ? 'bedroom' : null);
  }

  renderOpening(room) {
    const c = this.concepts[room] || { title: '', text: '' };
    const look = this.lookOf(room);
    const cats = C.roomCategories(this.index, room);
    const chapter = room === 'living' ? 'I' : 'II';
    // tiles in threes: a big one and two small ones (mirrored every other row), the last one or two widen to fill the row
    const full = Math.floor(look.length / 3), rem = look.length % 3;
    const tileClass = (i) => (Math.floor(i / 3) < full ? (i % 3 ? 'small' : `big${Math.floor(i / 3) % 2 ? ' mirror' : ''}`) : rem === 1 ? 'wide' : 'half');
    const tiles = look.map(({ p }, i) => h('figure', { class: `mood-tile ${tileClass(i)}`, style: { '--tint': ['#E6DCCB', '#F4EFE7', '#D3C1A5', '#EFE7DA'][i % 4] } },
      h('img', { src: imgSmall(p.image_file), srcset: `${imgSmall(p.image_file)} 400w, ${img(p.image_file)} 800w`, sizes: '(max-width: 700px) 50vw, 25vw', alt: C.cleanName(p.name), loading: 'lazy', decoding: 'async' }),
      h('button', { class: 'hotspot', 'data-testid': 'hotspot', 'data-product': p.id, 'aria-label': `Open ${C.cleanName(p.name)}`, onclick: () => this.openQuick(p, room) }, icon('plus')),
      h('figcaption', {}, h('span', {}, this.index.byCat.get(p.category).label), h('strong', {}, C.fmtMoney(C.toCents(p.price))))));
    const lookPrice = look.reduce((a, { p, qty }) => a + C.toCents(p.price) * qty, 0);
    return h('section', { 'aria-label': C.ROOM_NAME[room] },
      h('div', { class: 'opening' },
        h('div', { class: 'opening-text' },
          h('p', { class: 'kicker' }, `Chapter ${chapter}`),
          h('h2', { class: 'chapter-title' }, C.ROOM_NAME[room]),
          h('p', { class: 'concept-title' }, c.title ? c.title.charAt(0).toUpperCase() + c.title.slice(1) + '.' : ''),
          h('p', { class: 'concept-text', 'data-testid': 'concept-text' }, c.text),
          h('div', { class: 'look-box' },
            h('p', { class: 'kicker' }, 'Shop the look'),
            h('p', {}, `The ${look.length} pieces on the board are the designer's recommended BALANCED package for this room: ${C.fmtMoney(lookPrice)} before tax. Tap a + to see a piece.`),
            h('button', { class: 'btn primary', 'data-testid': 'add-look', onclick: () => this.addLook(room) }, 'Add this look to my picks'))),
        h('div', { class: 'mood', 'data-testid': 'moodboard' }, ...tiles)),
      h('div', { class: 'toc' },
        h('h3', { class: 'toc-title' }, 'In this chapter'),
        h('ol', { class: 'toc-list' }, ...cats.map((cat, i) => h('li', {},
          h('a', { href: `#/${room}/${cat.id}` }, h('span', { class: 'toc-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'toc-label' }, cat.label), cat.shared ? h('span', { class: 'both-badge sm' }, 'Both rooms') : null, h('span', { class: 'toc-count' }, `${cat.product_ids.length} options`)))))));
  }

  // ------------------------------------------------------------------------------------------
  // Category pages

  renderCategory(page) {
    const { room, cat } = page;
    const all = C.categoryProducts(this.index, cat.id);
    const wrap = h('section', { 'aria-label': cat.label });
    const cats = C.roomCategories(this.index, room);
    const chips = h('nav', { class: 'cat-chips hscroll', 'aria-label': `${C.ROOM_NAME[room]} categories` }, ...cats.map((c) => h('a', { href: `#/${room}/${c.id}`, 'aria-current': c.id === cat.id ? 'page' : null }, c.label)));
    const head = h('header', { class: 'cat-head' },
      h('p', { class: 'kicker' }, h('a', { href: `#/${room}` }, C.ROOM_NAME[room]), ` · ${String(page.n).padStart(2, '0')} of ${page.of}`),
      h('div', { class: 'cat-title-row' },
        h('h2', {}, cat.label),
        cat.shared ? h('span', { class: 'both-badge', 'data-testid': 'both-badge', title: 'This category appears in both rooms' }, 'Both rooms') : null),
      cat.rule ? h('p', { class: 'rule', 'data-testid': 'rule' }, icon('ruler'), h('span', {}, h('b', {}, 'The rule '), cat.rule)) : null,
      this.pickSlotLine(cat, room));
    this.listHost = h('div', { class: 'cat-list' });
    const tools = h('div', { class: 'cat-tools' },
      this.filterBar(room, () => this.renderList(page)),
      h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'View' },
        h('button', { 'aria-pressed': String(!this.compare), 'data-testid': 'view-cards', onclick: () => { this.compare = false; this.renderList(page); this.syncToggle(tools); } }, 'Cards'),
        h('button', { 'aria-pressed': String(this.compare), 'data-testid': 'view-compare', onclick: () => { this.compare = true; this.renderList(page); this.syncToggle(tools); } }, 'Compare')));
    wrap.append(chips, head, tools, this.listHost);
    this.renderList(page, all);
    return wrap;
  }

  syncToggle(tools) {
    const [a, b] = tools.querySelectorAll('.view-toggle button');
    a.setAttribute('aria-pressed', String(!this.compare));
    b.setAttribute('aria-pressed', String(this.compare));
  }

  /** What's in My Picks for this category, under the title ("Your pick: ..."). */
  pickSlotLine(cat, room) {
    const slots = cat.pickSlots.filter((s) => !s.room || s.room === room || cat.pickSlots.length === 1);
    const shown = slots.length ? slots : cat.pickSlots;
    const bits = shown.map((s) => {
      const v = this.state.picks[s.key];
      const p = v && this.index.products.get(v.id);
      return h('span', { class: 'slot-pick' }, shown.length > 1 || cat.pickSlots.length > 1 ? h('b', {}, `${s.label}: `) : h('b', {}, 'Your pick: '), p ? h('a', { href: `#/${room}/${cat.id}?p=${p.id}` }, C.cleanName(p.name), v.color ? ` (${v.color})` : '') : h('span', { class: 'muted' }, 'none yet'));
    });
    return h('p', { class: 'slot-line', 'data-testid': 'slot-line' }, ...bits);
  }

  renderList(page, all = C.categoryProducts(this.index, page.cat.id)) {
    const f = this.filters[page.room];
    const shown = all.filter((p) => C.matchesFilters(p, f, this.colors.get(p.id) ?? null));
    const count = h('p', { class: 'count', 'data-testid': 'count' }, shown.length === all.length ? `${all.length} options` : `Showing ${shown.length} of ${all.length} options`,
      shown.length < all.length ? h('button', { class: 'linkish', onclick: () => { this.filters[page.room] = C.emptyFilters(); this.show(this.cur); } }, 'Clear filters') : null);
    let body;
    if (!shown.length) body = h('p', { class: 'empty' }, 'Nothing here matches the filters.');
    else if (this.compare) body = this.compareTable(shown, page.room);
    else body = h('div', { class: 'cards hscroll', 'data-testid': 'cards' }, ...shown.map((p) => this.card(p, page.room)));
    this.listHost.replaceChildren(count, body);
  }

  filterBar(room, onChange) {
    const f = this.filters[room];
    const stores = [...new Set(C.roomCategories(this.index, room).flatMap((c) => C.categoryProducts(this.index, c.id).map((p) => p.store)))].sort();
    const n = f.stores.length + (f.min !== null) + (f.max !== null) + f.deal + f.used + f.top;
    const bar = h('div', { class: `filters ${this.filtersOpen ? 'open' : ''}`, 'data-testid': 'filters' });
    const update = () => { onChange(); const k = bar.querySelector('.filters-n'); const m = f.stores.length + (f.min !== null) + (f.max !== null) + f.deal + f.used + f.top; k.textContent = m ? String(m) : ''; };
    const toggle = (key, label) => h('label', { class: 'fchip' }, h('input', { type: 'checkbox', checked: f[key] || null, 'data-filter': key, onchange: (e) => { f[key] = e.target.checked; update(); } }), h('span', {}, label));
    const storeChip = (s) => h('label', { class: 'fchip' }, h('input', { type: 'checkbox', checked: f.stores.includes(s) || null, 'data-store': s, onchange: (e) => { f.stores = e.target.checked ? [...f.stores, s] : f.stores.filter((x) => x !== s); update(); } }), h('span', {}, s));
    const price = (key, label) => h('label', { class: 'fprice' }, h('span', {}, label), h('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', value: f[key] ?? '', 'data-filter': key, 'aria-label': `${label} price in dollars`, oninput: (e) => { const v = parseFloat(e.target.value); f[key] = Number.isFinite(v) ? v : null; update(); } }));
    bar.append(
      h('button', { class: 'filters-toggle', 'aria-expanded': String(!!this.filtersOpen), onclick: () => { this.filtersOpen = !this.filtersOpen; bar.classList.toggle('open', this.filtersOpen); } }, icon('filter'), 'Filters', h('span', { class: 'filters-n' }, n ? String(n) : '')),
      h('div', { class: 'filters-body' },
        h('div', { class: 'fgroup' }, h('span', { class: 'fgroup-label' }, 'Store'), h('div', { class: 'fchips' }, ...stores.map(storeChip))),
        h('div', { class: 'fgroup' }, h('span', { class: 'fgroup-label' }, 'Price'), price('min', 'Min'), h('span', { class: 'dash' }, '–'), price('max', 'Max')),
        h('div', { class: 'fgroup' }, h('span', { class: 'fgroup-label' }, 'Show only'), toggle('deal', 'Deal'), toggle('used', 'Used'), toggle('top', 'Top pick')),
        h('button', { class: 'linkish', 'data-testid': 'clear-filters', onclick: () => { this.filters[room] = C.emptyFilters(); this.show(this.cur); } }, 'Clear')));
    return bar;
  }

  // ------------------------------------------------------------------------------------------
  // Product card

  card(p, room, { quick = false } = {}) {
    const color = this.colors.has(p.id) ? this.colors.get(p.id) : this.pickedColor(p);
    const v = C.view(p, color);
    const name = C.cleanName(p.name);
    const sizes = C.sizeParts(p);
    const missing = sizes.some((s) => s.missing);
    const tags = (p.tags || []).map((t) => h('span', { class: `tag tag-${t.toLowerCase().replace(/\s+/g, '-')}` }, t));
    const inThreeD = this.isPlaced(p.id);
    const tipId = `tip-${p.id}-${quick ? 'q' : 'c'}`;
    const stockText = v.inStock ? `In stock (checked ${C.fmtDate(p.stock_checked_date)})` : 'Out of stock';
    const stock = h('div', { class: 'stock-wrap' },
      h('button', { class: `stock ${v.inStock ? 'in' : 'out'}`, type: 'button', 'data-testid': 'stock', 'aria-describedby': v.stockNote ? tipId : null, 'aria-expanded': 'false', onclick: (e) => { const b = e.currentTarget; b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true')); } },
        h('span', { class: 'dot' }), stockText, v.stockNote ? icon('info', 'ico sm') : null),
      v.stockNote ? h('span', { class: 'tip', role: 'tooltip', id: tipId, 'data-testid': 'stock-note' }, v.stockNote) : null);
    const swatches = [{ color: null, hex: p.main_color_hex, label: 'As listed' }, ...(p.color_variants || []).map((x) => ({ color: x.color, hex: x.hex, label: x.color }))];
    const sw = swatches.length > 1 ? h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' },
      ...swatches.map((s) => h('button', { class: 'sw', role: 'radio', 'aria-checked': String((s.color || null) === (color || null)), 'aria-label': s.label, title: s.label, 'data-color': s.color || '', 'data-testid': 'swatch', style: { '--sw': s.hex }, onclick: () => this.setColor(p, s.color, room, quick) })),
      h('span', { class: 'sw-name', 'data-testid': 'color-name' }, color || 'As listed')) : null;
    const sizeLine = h('p', { class: 'size', 'data-testid': 'size' }, h('span', { class: 'lbl' }, 'Size'),
      ...sizes.flatMap((s, i) => [i ? ' × ' : '', s.missing ? h('span', { class: 'size-needed' }, `${s.k} size needed`) : h('span', {}, C.fmtInches(s.v), s.est ? h('abbr', { class: 'est', title: 'Estimated: not printed on the product page' }, ' est.') : null)]),
      ' in (W × D × H)');
    const desc = C.sentences(p.short_description, 2, p.name);
    const why = C.sentences(p.why_this, 2);
    const notes = (p.notes || []).map((n) => C.decodeEntities(n)).filter(Boolean);
    const card = h('article', { class: `pcard ${quick ? 'quick' : ''} ${v.inStock ? '' : 'oos'}`, 'data-product': p.id, 'data-testid': 'product-card' },
      h('div', { class: 'pc-media' },
        h('img', { src: imgSmall(v.image), srcset: `${imgSmall(v.image)} 400w, ${img(v.image)} 800w`, sizes: quick ? '(max-width: 700px) 90vw, 420px' : '(max-width: 700px) 85vw, 320px', alt: name + (color ? `, ${color}` : ''), loading: quick ? 'eager' : 'lazy', decoding: 'async', width: '400', height: '400', 'data-testid': 'product-image' }),
        tags.length ? h('div', { class: 'tags' }, ...tags) : null,
        inThreeD ? h('span', { class: 'in3d', title: 'Placed in your 3D room' }, icon('cube', 'ico sm'), 'In 3D') : null),
      h('div', { class: 'pc-body' },
        h('p', { class: 'pc-brand' }, [p.brand, p.store].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')),
        h('h3', { class: 'pc-name' }, name),
        h('div', { class: 'pc-price' },
          h('strong', { 'data-testid': 'price' }, C.fmtMoney(C.toCents(v.price))),
          v.onSale ? h('s', { 'data-testid': 'regular-price' }, C.fmtMoney(C.toCents(v.regular))) : null,
          (p.qty_suggested || 1) > 1 ? h('span', { class: 'per' }, ` each · you need ${p.qty_suggested}`) : null,
          h('span', { class: 'checked' }, `Price checked ${C.fmtDate(p.price_checked_date)}`)),
        stock,
        sw,
        sizeLine,
        missing ? h('p', { class: 'size-note' }, 'Size needed: this piece shows in the 3D rooms but can’t be placed until its size is in products.json.') : null,
        desc ? h('p', { class: 'desc' }, desc) : null,
        why ? h('p', { class: 'why' }, h('span', { class: 'why-label' }, 'Why this'), why) : null,
        p.condition === 'used' ? h('p', { class: 'used' }, h('span', { class: 'used-label', 'data-testid': 'used-label' }, p.used_label || 'Used'), p.backup_search_url ? h('a', { href: p.backup_search_url, target: '_blank', rel: 'noopener', 'data-testid': 'backup' }, 'Backup search', icon('ext', 'ico sm')) : null) : null,
        notes.length ? h('ul', { class: 'notes' }, ...notes.map((n) => h('li', {}, n))) : null,
        h('div', { class: 'actions' },
          h('a', { class: 'btn buy', href: v.url, target: '_blank', rel: 'noopener', 'data-testid': 'buy' }, `Buy at ${p.store}`, icon('ext', 'ico sm')),
          this.pickButton(p, room, color),
          h('button', { class: 'btn ghost see3d', 'data-testid': 'see3d', title: 'Open it in the 3D rooms', onclick: () => this.seeIn3d(p, color) }, icon('cube', 'ico sm'), 'See in 3D'))));
    return card;
  }

  pickedColor(p) {
    const hit = Object.values(this.state.picks).find((v) => v.id === p.id);
    return hit ? hit.color : null;
  }

  isPlaced(id, key = null) {
    for (const ref of this.placed) {
      const m = /^lb:(.+):([^:]+):([^:]*)$/.exec(ref);
      if (m && m[2] === id && (!key || m[1] === key)) return true;
    }
    return false;
  }

  setColor(p, color, room, quick) {
    this.colors.set(p.id, color);
    this.replaceCards(p.id, room, quick);
  }

  replaceCards(id, room, quickOnly = false) {
    for (const el of document.querySelectorAll(`.pcard[data-product="${CSS.escape(id)}"]`)) {
      const quick = el.classList.contains('quick');
      if (quickOnly && !quick) continue;
      const p = this.index.products.get(id);
      el.replaceWith(this.card(p, room, { quick }));
    }
  }

  pickButton(p, room, color) {
    const cands = C.candidateKeys(this.index, p, room);
    const holds = (s) => { const v = this.state.picks[s.key]; return v && v.id === p.id && (v.color || null) === (color || null); };
    const here = cands.filter(holds);
    if (here.length) {
      return h('button', { class: 'btn pick on', 'data-testid': 'pick', 'aria-pressed': 'true', title: `In My Picks: ${here.map((s) => s.label).join(', ')}. Click to remove.`, onclick: () => this.unpick(here[0].key) }, icon('check', 'ico sm'), cands.length > 1 ? `In my picks · ${shortSlot(here[0].label)}` : 'In my picks');
    }
    const occupant = (s) => { const v = this.state.picks[s.key]; return v ? this.index.products.get(v.id) : null; };
    if (cands.length === 1) {
      const occ = occupant(cands[0]);
      const sameProduct = occ && occ.id === p.id;
      return h('button', { class: 'btn pick', 'data-testid': 'pick', 'aria-pressed': 'false', title: occ ? (sameProduct ? 'Switch your pick to this color' : `Replaces ${C.cleanName(occ.name)} in My Picks`) : 'Add to My Picks', onclick: () => this.setPick(cands[0].key, p, color) },
        icon('plus', 'ico sm'), sameProduct ? 'Pick this color' : 'Add to my picks');
    }
    // more than one place it can go (the cream pair or the rust pair of pillow covers...)
    const wrap = h('div', { class: 'pick-split' });
    const menu = h('div', { class: 'pick-menu', hidden: true, role: 'menu' },
      h('p', { class: 'pick-menu-head' }, 'Add as'),
      ...cands.map((s) => { const occ = occupant(s); return h('button', { role: 'menuitem', 'data-key': s.key, 'data-testid': 'pick-option', onclick: () => { menu.hidden = true; this.setPick(s.key, p, color); } }, h('b', {}, s.label), occ ? h('small', {}, `replaces ${C.cleanName(occ.name)}`) : h('small', {}, 'empty')); }));
    wrap.append(h('button', { class: 'btn pick', 'data-testid': 'pick', 'aria-haspopup': 'menu', 'aria-pressed': 'false', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, icon('plus', 'ico sm'), 'Add to my picks…'), menu);
    return wrap;
  }

  // ------------------------------------------------------------------------------------------
  // My Picks

  async setPick(key, p, color) {
    const old = this.state.picks[key];
    const slot = this.index.pickSlotByKey.get(key);
    if (old && (old.id !== p.id || (old.color || null) !== (color || null)) && this.placed.has(pickRef(key, old.id, old.color))) {
      const ok = await this.confirm('Replace a piece that is in your 3D room?', `${C.cleanName(this.index.products.get(old.id).name)} is placed in your 3D room. Replacing it in My Picks also takes it out of the 3D room.`, 'Replace it');
      if (!ok) return;
    }
    const qty = old && old.id === p.id ? old.qty : p.qty_suggested || 1;
    this.state.picks[key] = { id: p.id, qty, color: color || null };
    this.save();
    const was = old && old.id !== p.id ? this.index.products.get(old.id) : null;
    this.toast(was ? `Replaced ${C.cleanName(was.name)} with ${C.cleanName(p.name)}.` : `Added ${C.cleanName(p.name)} to My Picks${slot && slot.label !== this.index.byCat.get(p.category).label ? ` (${slot.label})` : ''}.`);
  }

  async unpick(key) {
    const old = this.state.picks[key];
    if (!old) return;
    const p = this.index.products.get(old.id);
    if (this.placed.has(pickRef(key, old.id, old.color))) {
      const ok = await this.confirm('Remove a piece that is in your 3D room?', `${C.cleanName(p.name)} is placed in your 3D room. Taking it out of My Picks also removes it from the 3D room.`, 'Remove it');
      if (!ok) return;
    }
    delete this.state.picks[key];
    this.save();
    this.toast(`Removed ${C.cleanName(p.name)} from My Picks.`);
  }

  setQty(key, qty) {
    const v = this.state.picks[key];
    if (!v) return;
    v.qty = Math.max(1, Math.min(12, qty));
    this.save();
  }

  async addLook(room) {
    const look = this.lookOf(room);
    const { picks } = C.packagePicks(this.index, 'balanced');
    const keys = Object.keys(picks).filter((k) => look.some((l) => l.key === k));
    const replacing = keys.filter((k) => this.state.picks[k] && this.state.picks[k].id !== picks[k].id);
    if (replacing.length) {
      const ok = await this.confirm('Add the whole look?', `This replaces ${replacing.length} of your current pick${replacing.length > 1 ? 's' : ''} in ${C.ROOM_NAME[room].toLowerCase()} categories with the designer's look.`, 'Add the look');
      if (!ok) return;
    }
    for (const k of keys) this.state.picks[k] = { ...picks[k] };
    this.save();
    this.toast(`Added ${keys.length} pieces of the ${C.ROOM_NAME[room].toLowerCase()} look to My Picks.`);
  }

  async loadPackage(id) {
    const { picks, problems } = C.packagePicks(this.index, id);
    if (problems.length) { this.toast(`Could not load ${id.toUpperCase()}: ${problems.join('; ')}`, 'error'); return; }
    const n = Object.keys(this.state.picks).length;
    const placed = Object.entries(this.state.picks).filter(([k, v]) => this.placed.has(pickRef(k, v.id, v.color)) && !(picks[k] && picks[k].id === v.id && (picks[k].color || null) === (v.color || null))).length;
    if (n) {
      const ok = await this.confirm(`Load ${id.toUpperCase()}?`, `This replaces your ${n} current pick${n > 1 ? 's' : ''} with the ${id.toUpperCase()} package (${Object.keys(picks).length} pieces).${placed ? ` ${placed} of them ${placed > 1 ? 'are' : 'is'} placed in your 3D rooms and will be taken out.` : ''}`, 'Load the package');
      if (!ok) return;
    }
    this.state.picks = picks;
    this.save();
    this.toast(`Loaded ${id.toUpperCase()} into My Picks.`);
    this.openPicks();
  }

  async clearPicks() {
    const n = Object.keys(this.state.picks).length;
    if (!n) return;
    const ok = await this.confirm('Clear My Picks?', `This removes all ${n} picks${[...this.placed].some((r) => !r.startsWith('lb:try:')) ? ', and takes the ones placed in your 3D rooms out of the rooms' : ''}.`, 'Clear all');
    if (!ok) return;
    this.state.picks = {};
    this.save();
  }

  seeIn3d(p, color) {
    const hit = Object.entries(this.state.picks).find(([, v]) => v.id === p.id && (v.color || null) === (color || null));
    let ref;
    if (hit) ref = pickRef(hit[0], p.id, color);
    else {
      if (!this.state.try3d.some((t) => t.id === p.id && (t.color || null) === (color || null))) this.state.try3d.push({ id: p.id, color: color || null });
      writePicks(this.state);
      ref = tryRef(p.id, color);
    }
    location.href = `${APP3D}?inv=lookbook&lb=${encodeURIComponent(ref)}`;
  }

  save() {
    writePicks(this.state);
    this.afterPicks(true);
  }

  /** Picks changed (here or in another tab): refresh the button, the drawer and the visible cards. */
  afterPicks(local) {
    this.renderPicksButton();
    if (!this.drawer.hidden) this.renderDrawer();
    const page = this.pages[this.cur];
    if (!page) return;
    const y = window.scrollY;
    if (page.kind === 'category') {
      const line = this.main.querySelector('.slot-line');
      if (line) line.replaceWith(this.pickSlotLine(page.cat, page.room));
      for (const el of this.main.querySelectorAll('.pcard:not(.quick)')) el.replaceWith(this.card(this.index.products.get(el.dataset.product), page.room));
      if (this.compare) this.renderList(page);
    } else if (page.id === 'packages') this.show(this.cur, null, { keepOverlays: true });
    for (const el of this.modal.querySelectorAll('.pcard.quick')) el.replaceWith(this.card(this.index.products.get(el.dataset.product), this.quickRoom, { quick: true }));
    if (!local) window.scrollTo({ top: y, behavior: 'instant' });
  }

  renderPicksButton() {
    const t = C.cartTotals(this.index, this.state);
    const n = t.lines.length;
    this.picksBtn.className = `picks-btn level-${t.level}`;
    this.picksBtn.replaceChildren(icon('bag'), h('span', { class: 'pb-label' }, 'My Picks'), h('span', { class: 'pb-n', 'data-testid': 'picks-count' }, String(n)), h('span', { class: 'pb-total', 'data-testid': 'picks-total' }, C.fmtMoney(t.totalCents)));
    this.picksBtn.setAttribute('aria-label', `My Picks: ${n} pieces, ${C.fmtMoney(t.totalCents)}`);
  }

  openPicks() {
    this.closeMenu();
    this.drawer.hidden = false;
    this.scrim.hidden = false;
    document.body.classList.add('drawer-open');
    this.renderDrawer();
    this.drawer.querySelector('.drawer-close')?.focus();
  }

  closeOverlays() {
    this.drawer.hidden = true;
    this.scrim.hidden = true;
    document.body.classList.remove('drawer-open');
    this.closeMenu();
  }

  renderDrawer() {
    const idx = this.index;
    const t = C.cartTotals(idx, this.state);
    const pct = (c) => Math.min(100, (c / t.ceilingCents) * 100);
    const levelText = t.level === 'red' ? `Over the ${C.fmtMoney(t.ceilingCents, { whole: true })} ceiling by ${C.fmtMoney(t.totalCents - t.ceilingCents)}`
      : t.level === 'amber' ? `Over your ${C.fmtMoney(t.aimCents, { whole: true })} goal by ${C.fmtMoney(t.totalCents - t.aimCents)}`
        : `${C.fmtMoney(t.aimCents - t.totalCents)} under your ${C.fmtMoney(t.aimCents, { whole: true })} goal`;
    const groups = [['living', 'Living room'], ['bedroom', 'Bedroom'], [null, 'Both rooms']].map(([room, label]) => [label, t.lines.filter((l) => (l.room || null) === room)]).filter(([, ls]) => ls.length);
    const line = (l) => {
      const p = l.product;
      const placed = this.placed.has(pickRef(l.key, p.id, l.view.color));
      const qty = C.QTY_CATEGORIES.has(p.category)
        ? h('span', { class: 'qty', 'data-testid': 'qty' },
          h('button', { 'aria-label': 'One fewer', onclick: () => this.setQty(l.key, l.qty - 1), disabled: l.qty <= 1 }, '−'),
          h('output', { 'data-testid': 'qty-value' }, String(l.qty)),
          h('button', { 'aria-label': 'One more', onclick: () => this.setQty(l.key, l.qty + 1) }, '+'))
        : l.qty > 1 ? h('span', { class: 'qty fixed' }, `× ${l.qty}`) : null;
      return h('li', { class: 'pl', 'data-key': l.key, 'data-product': p.id, 'data-testid': 'pick-line' },
        h('img', { src: imgSmall(l.view.image), alt: '', loading: 'lazy' }),
        h('div', { class: 'pl-main' },
          h('p', { class: 'pl-slot' }, l.slot?.label || idx.byCat.get(p.category).label, placed ? h('span', { class: 'in3d sm' }, icon('cube', 'ico sm'), 'In 3D') : null),
          h('a', { class: 'pl-name', href: `#/${l.room || this.slotRoomOf(p) || 'living'}/${p.category}?p=${p.id}`, onclick: () => this.closeOverlays() }, C.cleanName(p.name)),
          h('p', { class: 'pl-meta' }, [p.store, l.view.color, p.condition === 'used' ? 'used, no tax' : null, l.deliveryCents ? `+${C.fmtMoney(l.deliveryCents)} delivery` : null].filter(Boolean).join(' · ')),
          h('div', { class: 'pl-row' }, qty,
            h('strong', { class: 'pl-price', 'data-testid': 'line-price' }, C.fmtMoney(l.cents)),
            h('a', { class: 'pl-buy', href: l.url, target: '_blank', rel: 'noopener', 'data-testid': 'line-buy' }, 'Buy', icon('ext', 'ico sm')),
            h('button', { class: 'pl-remove', 'aria-label': `Remove ${C.cleanName(p.name)}`, 'data-testid': 'line-remove', onclick: () => this.unpick(l.key) }, icon('close', 'ico sm')))));
    };
    const linksOpen = !!this.linksOpen;
    const links = C.linksByStore(t.lines);
    this.drawer.replaceChildren(
      h('div', { class: 'drawer-head' }, h('h2', {}, 'My Picks'), h('button', { class: 'icon-btn drawer-close', 'aria-label': 'Close My Picks', onclick: () => this.closeOverlays() }, icon('close'))),
      h('div', { class: `budget level-${t.level}`, 'data-testid': 'budget', 'data-level': t.level },
        h('div', { class: 'budget-top' }, h('span', { class: 'b-total', 'data-testid': 'total' }, C.fmtMoney(t.totalCents)), h('span', { class: 'b-state', 'data-testid': 'level-text' }, levelText)),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: { width: `${pct(t.totalCents)}%` } }), h('span', { class: 'meter-mark aim', style: { left: `${pct(t.aimCents)}%` } }), h('span', { class: 'meter-mark ceil', style: { left: '100%' } })),
        h('div', { class: 'meter-legend' }, h('span', {}, '$0'), h('span', { style: { left: `${pct(t.aimCents)}%` } }, `${C.fmtMoney(t.aimCents, { whole: true })} goal`), h('span', {}, `${C.fmtMoney(t.ceilingCents, { whole: true })} ceiling`)),
        h('table', { class: 'totals' },
          h('tr', {}, h('td', {}, 'New items'), h('td', { 'data-testid': 'sub-new' }, C.fmtMoney(t.taxedCents))),
          h('tr', {}, h('td', {}, `Sales tax ${(idx.taxRate * 100).toFixed(2)}% (new items)`), h('td', { 'data-testid': 'tax' }, C.fmtMoney(t.taxCents))),
          h('tr', {}, h('td', {}, 'Used items (private sales, no tax)'), h('td', { 'data-testid': 'sub-used' }, C.fmtMoney(t.untaxedCents))),
          h('tr', {}, h('td', {}, 'Delivery (listed fees)'), h('td', { 'data-testid': 'delivery' }, C.fmtMoney(t.deliveryCents))),
          h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', { 'data-testid': 'total-row' }, C.fmtMoney(t.totalCents))))),
      t.lines.length ? h('div', { class: 'drawer-acts' },
        h('a', { class: 'btn primary', href: `${APP3D}?inv=lookbook`, 'data-testid': 'open-3d' }, icon('cube', 'ico sm'), 'Place them in 3D'),
        h('button', { class: 'btn', 'aria-expanded': String(linksOpen), 'data-testid': 'open-all-links', onclick: () => { this.linksOpen = !linksOpen; this.renderDrawer(); } }, 'Open all buy links'),
        h('button', { class: 'linkish danger', 'data-testid': 'clear-picks', onclick: () => this.clearPicks() }, 'Clear all')) : null,
      linksOpen && t.lines.length ? h('div', { class: 'all-links', 'data-testid': 'links-by-store' },
        h('p', { class: 'fineprint' }, 'Grouped by store, so you can check out one store at a time. Each link opens the product page in a new tab.'),
        ...links.map((g) => h('section', { class: 'store-group', 'data-store': g.store },
          h('h3', {}, g.store, h('small', {}, ` · ${g.links.length} item${g.links.length > 1 ? 's' : ''}`)),
          h('ul', {}, ...g.links.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, C.cleanName(x.name), x.color ? ` (${x.color})` : '', x.qty > 1 ? ` × ${x.qty}` : '', icon('ext', 'ico sm')), x.backup ? h('a', { class: 'backup', href: x.backup, target: '_blank', rel: 'noopener' }, 'backup search') : null)))))) : null,
      t.lines.length
        ? h('div', { class: 'pick-groups' }, ...groups.map(([label, ls]) => h('section', {}, h('h3', { class: 'group-title' }, label, h('small', {}, ` · ${ls.length}`)), h('ul', { class: 'pick-lines' }, ...ls.map(line)))))
        : h('div', { class: 'drawer-empty' }, h('p', {}, 'No picks yet.'), h('p', { class: 'fineprint' }, 'Add pieces from the room chapters, or load a package. One pick per category; pillows and inserts can take a quantity.'), h('a', { class: 'btn', href: '#/packages', onclick: () => this.closeOverlays() }, 'See the packages')),
      h('p', { class: 'fineprint drawer-foot' }, `${idx.budget?.note || ''} Kept in this browser; the 3D rooms read the same list.`));
  }

  // ------------------------------------------------------------------------------------------
  // Packages and notes

  renderPackages() {
    const idx = this.index;
    const ids = Object.keys(idx.doc.packages);
    const col = (id) => {
      const t = C.packageTotals(idx, id);
      const blurb = this.blurbs[id] || {};
      const under = t.totalCents <= C.toCents(idx.budget.aim_total) ? 'ok' : t.totalCents <= C.toCents(idx.budget.hard_ceiling) ? 'amber' : 'red';
      const rooms = [['living', 'Living room'], ['bedroom', 'Bedroom']];
      const { picks } = C.packagePicks(idx, id);
      const roomOf = (l) => { const k = Object.keys(picks).find((key) => picks[key].id === l.id); return C.roomOfPick(idx, k, l.product) || this.slotRoomOf(l.product) || 'living'; };
      const loaded = Object.keys(picks).length === Object.keys(this.state.picks).length && Object.entries(picks).every(([k, v]) => this.state.picks[k]?.id === v.id && this.state.picks[k]?.qty === v.qty);
      return h('article', { class: `pkg ${id === 'balanced' ? 'featured' : ''}`, 'data-package': id, 'data-testid': 'package' },
        id === 'balanced' ? h('p', { class: 'ribbon' }, 'Designer’s recommendation') : null,
        h('h3', { class: 'pkg-name' }, id.toUpperCase()),
        blurb.note ? h('p', { class: 'kicker' }, blurb.note) : null,
        h('p', { class: 'pkg-total' }, h('span', { 'data-testid': 'package-total' }, C.fmtMoney(t.totalCents))),
        h('p', { class: `pkg-state level-${under}` }, under === 'ok' ? `Under the ${C.fmtMoney(C.toCents(idx.budget.aim_total), { whole: true })} goal` : under === 'amber' ? `Over the goal, under the ${C.fmtMoney(C.toCents(idx.budget.hard_ceiling), { whole: true })} ceiling` : 'Over the ceiling'),
        blurb.text ? h('p', { class: 'pkg-blurb' }, `${id.toUpperCase()} ${blurb.text}`) : null,
        h('table', { class: 'totals' },
          h('tr', {}, h('td', {}, 'New items'), h('td', { 'data-testid': 'package-new' }, C.fmtMoney(t.taxedCents))),
          h('tr', {}, h('td', {}, `Tax ${(idx.taxRate * 100).toFixed(2)}% (new only)`), h('td', { 'data-testid': 'package-tax' }, C.fmtMoney(t.taxCents))),
          h('tr', {}, h('td', {}, 'Used items (no tax)'), h('td', { 'data-testid': 'package-used' }, C.fmtMoney(t.untaxedCents))),
          h('tr', {}, h('td', {}, 'Delivery'), h('td', { 'data-testid': 'package-delivery' }, C.fmtMoney(t.deliveryCents))),
          h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', {}, C.fmtMoney(t.totalCents)))),
        t.matchesStored ? null : h('p', { class: 'fineprint warn' }, `Recalculated from today's prices in products.json; the designer's figure was ${C.fmtMoney(t.stored.total)}.`),
        h('button', { class: `btn ${loaded ? '' : 'primary'} full`, 'data-testid': 'load-package', onclick: () => this.loadPackage(id) }, loaded ? h('span', {}, icon('check', 'ico sm'), 'Loaded in My Picks') : 'Load this package into my picks'),
        h('details', { class: 'pkg-items', open: matchMedia('(min-width: 1100px)').matches || null },
          h('summary', {}, `All ${t.lines.length} items`),
          ...rooms.map(([room, label]) => {
            const ls = t.lines.filter((l) => roomOf(l) === room);
            return ls.length ? h('div', { class: 'pkg-room' }, h('h4', {}, label), h('ul', {}, ...ls.map((l) => h('li', { 'data-testid': 'package-line' },
              h('a', { href: `#/${room}/${l.product.category}?p=${l.id}` }, C.cleanName(l.name)),
              h('span', { class: 'pkg-meta' }, `${l.store}${l.qty > 1 ? ` · ${l.qty} × ${C.fmtMoney(l.unitCents)}` : ''}${l.taxed ? '' : ' · used, no tax'}`),
              h('span', { class: 'pkg-price' }, C.fmtMoney(l.cents)))))) : null;
          })));
    };
    const delivery = C.mdSections(this.notesMd).find((s) => /^packages/i.test(s.title))?.lines.filter((l) => /delivery assumptions/i.test(l)) || [];
    return h('section', { 'aria-label': 'Packages' },
      h('header', { class: 'page-head' },
        h('p', { class: 'kicker' }, 'Three ways to buy it'),
        h('h2', {}, 'Packages'),
        h('p', { class: 'page-intro' }, 'Totals include 9.75% sales tax on new items; used private sales are untaxed. Loading a package replaces My Picks with its pieces and quantities.')),
      h('div', { class: 'pkgs' }, ...ids.map(col)),
      delivery.length ? h('div', { class: 'fineprint md', html: C.mdToHtml(delivery) }) : null);
  }

  renderNotes() {
    const secs = C.mdSections(this.notesMd);
    const get = (re) => secs.find((s) => re.test(s.title));
    const block = (title, sec, cls = '') => sec ? h('section', { class: `note-block ${cls}` }, h('h3', {}, title), h('div', { class: 'md', html: C.mdToHtml(sec.lines) })) : null;
    const manual = C.mdSections(this.manualMd);
    const manualBody = manual.slice(1).map((s) => `### ${s.title}\n${s.lines.join('\n')}`).join('\n');
    return h('section', { 'aria-label': 'Buying order and notes' },
      h('header', { class: 'page-head' },
        h('p', { class: 'kicker' }, 'Before you check out'),
        h('h2', {}, 'Buying order & notes'),
        h('p', { class: 'page-intro' }, 'From the designer’s notes: what to buy first, where things go, and what is still unsure.')),
      h('div', { class: 'notes-grid' },
        block('Buying order', get(/^buying order/i), 'buying'),
        block('Unsure', get(/^unsure/i), 'unsure'),
        block('Placement', get(/^placement/i)),
        block('Your Oct 13 list, re-checked', get(/^your oct/i)),
        h('section', { class: 'note-block manual', 'data-testid': 'manual' }, h('h3', {}, 'Still to check by hand'), h('div', { class: 'md', html: C.mdToHtml(manual[0].lines.filter((l) => !/^#\s/.test(l))) }), h('div', { class: 'md', html: C.mdToHtml(manualBody) }))));
  }

  // ------------------------------------------------------------------------------------------
  // Quick view, compare, confirm, toast

  openQuick(p, room) {
    this.quickRoom = room;
    this.modal.hidden = false;
    this.modal.replaceChildren(h('div', { class: 'modal quick-modal', role: 'dialog', 'aria-label': C.cleanName(p.name), 'data-testid': 'quick-view' },
      h('button', { class: 'icon-btn modal-close', 'aria-label': 'Close', onclick: () => this.closeModal() }, icon('close')),
      this.card(p, room, { quick: true }),
      h('p', { class: 'quick-more' }, h('a', { href: `#/${room}/${p.category}?p=${p.id}`, onclick: () => this.closeModal() }, `Compare all ${this.index.byCat.get(p.category).label.toLowerCase()}`, icon('arrowR', 'ico sm')))));
    this.modal.querySelector('.modal-close').focus();
  }

  closeModal() {
    if (this.modal.hidden) return false;
    this.modal.hidden = true;
    this.modal.replaceChildren();
    if (this.confirmResolve) { this.confirmResolve(false); this.confirmResolve = null; }
    return true;
  }

  confirm(title, text, okLabel) {
    return new Promise((resolve) => {
      if (this.confirmResolve) this.confirmResolve(false);
      this.confirmResolve = resolve;
      const done = (v) => { this.confirmResolve = null; this.modal.hidden = true; this.modal.replaceChildren(); resolve(v); };
      this.modal.hidden = false;
      this.modal.replaceChildren(h('div', { class: 'modal confirm', role: 'alertdialog', 'aria-label': title, 'data-testid': 'confirm' },
        h('h3', {}, title), h('p', {}, text),
        h('div', { class: 'confirm-acts' },
          h('button', { class: 'btn', 'data-testid': 'confirm-cancel', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: 'btn primary danger', 'data-testid': 'confirm-ok', onclick: () => done(true) }, okLabel))));
      this.modal.querySelector('[data-testid="confirm-ok"]').focus();
    });
  }

  compareTable(list, room) {
    const row = (label, f) => h('tr', {}, h('th', { scope: 'row' }, label), ...list.map((p) => h('td', {}, f(p, C.view(p, this.colors.get(p.id) ?? this.pickedColor(p))))));
    return h('div', { class: 'compare hscroll', 'data-testid': 'compare' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...list.map((p) => h('th', { scope: 'col', 'data-product': p.id },
        h('img', { src: imgSmall(C.view(p, this.colors.get(p.id) ?? this.pickedColor(p)).image), alt: '', loading: 'lazy' }),
        h('a', { href: `#/${room}/${p.category}?p=${p.id}`, onclick: () => { this.compare = false; } }, C.cleanName(p.name)))))),
      h('tbody', {},
        row('Price', (p, v) => [h('strong', {}, C.fmtMoney(C.toCents(v.price))), v.onSale ? h('s', {}, ` ${C.fmtMoney(C.toCents(v.regular))}`) : null]),
        row('Store', (p) => [p.brand, p.store].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')),
        row('Stock', (p, v) => h('span', { class: `stock-text ${v.inStock ? 'in' : 'out'}` }, v.inStock ? 'In stock' : 'Out of stock')),
        row('Size (in)', (p) => C.sizeParts(p).map((s) => (s.missing ? `${s.k}: needed` : `${C.fmtInches(s.v)}${s.est ? ' est.' : ''}`)).join(' × ')),
        row('New / used', (p) => (p.condition === 'used' ? 'Used, no tax' : 'New')),
        row('Colors', (p) => (p.color_variants?.length ? `${p.color_variants.length + 1}` : '1')),
        row('Tags', (p) => (p.tags || []).join(', ')),
        row('Why', (p) => C.sentences(p.why_this, 1)),
        row('', (p) => h('div', { class: 'cmp-acts' }, h('a', { class: 'btn buy small', href: C.view(p, this.colors.get(p.id) ?? this.pickedColor(p)).url, target: '_blank', rel: 'noopener' }, 'Buy', icon('ext', 'ico sm')), this.pickButton(p, room, this.colors.get(p.id) ?? this.pickedColor(p)))))));
  }

  toast(msg, kind = 'info') {
    const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3000);
    setTimeout(() => t.remove(), 3500);
  }

  // ------------------------------------------------------------------------------------------
  // Menu, keyboard, swipe

  toggleMenu() {
    const open = !document.body.classList.contains('menu-open');
    document.body.classList.toggle('menu-open', open);
    this.menuBtn.setAttribute('aria-expanded', String(open));
  }

  closeMenu() {
    document.body.classList.remove('menu-open');
    this.menuBtn?.setAttribute('aria-expanded', 'false');
  }

  setupInput() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.closeModal()) return; if (!this.drawer.hidden) { this.closeOverlays(); return; } this.closeMenu(); return; }
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!this.modal.hidden || !this.drawer.hidden) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.at + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(this.at - 1); }
    });
    document.addEventListener('click', (e) => {
      for (const m of document.querySelectorAll('.pick-menu:not([hidden])')) if (!m.parentElement.contains(e.target)) m.hidden = true;
      for (const b of document.querySelectorAll('.stock[aria-expanded="true"]')) if (b !== e.target.closest('.stock')) b.setAttribute('aria-expanded', 'false');
    });
    // swipe between pages on touch screens (not inside a sideways-scrolling strip, a form or a panel)
    let start = null;
    this.main.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || e.target.closest('.hscroll, input, .filters, .pick-menu')) { start = null; return; }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
    }, { passive: true });
    this.main.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      const fast = performance.now() - start.t < 700;
      start = null;
      if (fast && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) this.go(this.at + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }
}

function shortSlot(label) {
  const i = label.indexOf(':');
  return i > 0 ? label.slice(i + 1).trim() : label;
}

const lb = new Lookbook(document.getElementById('lookbook'));
window.__lookbook = lb; // used by the automated tests
lb.start().catch((err) => {
  console.error(err);
  document.getElementById('lookbook').replaceChildren(h('div', { class: 'lb-fatal' }, `The lookbook could not open: ${err.message}`));
});
