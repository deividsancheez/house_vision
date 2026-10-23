// The lookbook as a book: a printed-style flipbook of the living room and the bedroom, built entirely
// from the lookbook products.json (copied into data/lookbook/ by scripts/build-assets.mjs),
// inspiration.json and the designer's notes. Pages are laid out by measuring (src/lookbook/layout.js)
// and turned by src/lookbook/flipbook.js. My Picks are kept in this browser and shared with the 3D
// rooms (src/shared/lbstore.js).
import '@fontsource-variable/cormorant-garamond/index.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/jost/index.css';
import './lookbook.css';
import * as C from './core.js';
import { BOOK_TITLE, BOOK_SUBTITLE, SHARED_CHAPTER, CATEGORY_COPY, ROOM_NOW, BUYING_LINKS } from './copy.js';
import { Flipbook } from './flipbook.js';
import { paginate } from './layout.js';
import { readPicks, writePicks, readLayout, refsInLayout, pickRef, tryRef, variantList, PICKS_KEY, LAYOUT_KEY } from '../shared/lbstore.js';

const DATA = '../data/lookbook/';
const APP3D = '../';
const SOUND_KEY = 'lookbook.sound.v1';
const PALETTE = [
  ['Plaster', '#F4EFE7'], ['Oat linen', '#E6DCCB'], ['Warm sand', '#D3C1A5'], ['Light oak', '#C4A27C'], ['Chocolate', '#4A3428'],
  ['Camel', '#A87B4F'], ['Terracotta rust', '#A65A3A'], ['Olive', '#6E6B47'], ['Ink black', '#1F1D1B'],
];
const CHAPTER_NO = { living: 'I', bedroom: 'II' };
const CHAPTER_NAME = { living: 'Living Room', bedroom: 'Bedroom' };
// categories left out of the mood boards: they read as lines or hide inside other pieces
const MOOD_SKIP = new Set(['ROD', 'INSERT', 'CABLE']);
// book sizes (CSS px before the book is scaled to the screen)
const SPREAD = { w: 540, h: 760 };
const SINGLE_W = 370; // about 1:1 on a 390 px phone

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), sv);
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
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10zM17 9.5l5 5M22 9.5l-5 5"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
};
const icon = (n, cls = 'ico') => h('span', { class: cls, html: ICON[n] });
const img = (file) => DATA + file;
const imgSmall = (file) => DATA + String(file).replace(/^images\//, 'images/sm/');
/** An image that loads when its page comes near (pages are built long before they are shown). */
const limg = (file, { small = true, alt = '', ...attrs } = {}) => h('img', { 'data-src': small ? imgSmall(file) : img(file), 'data-srcset': small ? `${imgSmall(file)} 400w, ${img(file)} 800w` : null, alt, decoding: 'async', ...attrs });
const blk = (cls, ...kids) => h('div', { class: `blk ${cls}` }, ...kids);
const optional = (el) => { el.dataset.optional = '1'; return el; };
// page numbers are filled in after the pages are laid out: they are measured as the widest number
const PAGE_NO = '888';
const pad2 = (n) => String(n).padStart(2, '0');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

class Book {
  constructor(root) {
    this.root = root;
    this.state = readPicks();
    this.placed = refsInLayout(readLayout());
    this.colors = new Map(); // product id -> color shown on its card (null: as listed)
    this.filters = C.emptyFilters();
    this.dynamic = []; // parts of pages that follow My Picks: {el, render}
    this.sound = false;
    try { this.sound = localStorage.getItem(SOUND_KEY) === 'on'; } catch { /* storage blocked */ }
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
    this.chapters = Object.fromEntries(C.ROOMS.map((r) => [r, C.chapterCategories(this.index, r, SHARED_CHAPTER)]));
    this.chapterOfCat = new Map(C.ROOMS.flatMap((r) => this.chapters[r].map((c) => [c.id, r])));
    paperGrain();
    this.buildChrome();
    // pages are measured, so the fonts have to be there first
    await Promise.all(['400 16px "Jost Variable"', '500 16px "Jost Variable"', '600 16px "Jost Variable"', '400 16px "Cormorant Garamond Variable"', '500 16px "Cormorant Garamond Variable"', 'italic 400 16px "Cormorant Garamond Variable"'].map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
    this.layout(this.routeTarget()?.page ?? 0);
    this.route({ animate: false });
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('storage', (e) => {
      if (e.key === PICKS_KEY) { this.state = readPicks(); this.afterPicks(); }
      if (e.key === LAYOUT_KEY) { this.placed = refsInLayout(readLayout()); this.afterPicks(); }
    });
    // coming back from the 3D rooms in the same tab (bfcache) or another tab: re-read
    window.addEventListener('pageshow', () => this.reread());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reread(); });
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this.relayoutIfNeeded(), 180); });
    document.body.classList.add('ready');
  }

  reread() {
    const s = JSON.stringify(this.state), p = [...this.placed].join('|');
    this.state = readPicks();
    this.placed = refsInLayout(readLayout());
    if (JSON.stringify(this.state) !== s || [...this.placed].join('|') !== p) this.afterPicks();
  }

  // ------------------------------------------------------------------------------------------
  // The frame around the book: top bar, stage, bottom bar, panels

  buildChrome() {
    this.picksBtn = h('button', { class: 'tb-btn picks-btn', 'data-testid': 'picks-button', 'aria-label': 'My Picks', onclick: () => this.openPicks() });
    this.filterBtn = h('button', { class: 'tb-btn', 'data-testid': 'filters-button', 'aria-label': 'Filters', 'aria-haspopup': 'dialog', onclick: () => this.openFilters() }, icon('filter'), h('span', { class: 'tb-label' }, 'Filters'), h('span', { class: 'tb-count', 'data-testid': 'filters-count' }));
    this.soundBtn = h('button', { class: 'tb-btn', 'data-testid': 'sound-toggle', onclick: () => this.toggleSound() });
    this.top = h('header', { class: 'topbar' },
      h('button', { class: 'tb-btn', 'data-testid': 'contents-button', 'aria-label': 'Back to contents', onclick: () => this.goSection('contents') }, icon('list'), h('span', { class: 'tb-label' }, 'Contents')),
      h('p', { class: 'tb-title' }, BOOK_TITLE),
      h('div', { class: 'tb-right' }, this.filterBtn, this.soundBtn,
        h('a', { class: 'tb-btn', href: `${APP3D}?inv=lookbook`, 'data-nav': '3d', 'aria-label': '3D rooms', title: 'Open the 3D rooms' }, icon('cube'), h('span', { class: 'tb-label' }, '3D Rooms')),
        this.picksBtn));
    this.stage = h('main', { class: 'stage', id: 'main', 'aria-label': BOOK_TITLE, 'aria-roledescription': 'book' });
    this.sidePrev = h('button', { class: 'side-arrow prev', 'aria-label': 'Previous page', 'data-testid': 'side-prev', onclick: () => this.book.prev() }, icon('arrowL'));
    this.sideNext = h('button', { class: 'side-arrow next', 'aria-label': 'Next page', 'data-testid': 'side-next', onclick: () => this.book.next() }, icon('arrowR'));
    this.range = h('input', { type: 'range', class: 'progress', min: '0', max: '1', step: '1', value: '0', 'aria-label': 'Page', 'data-testid': 'progress', oninput: (e) => this.book.goToView(Number(e.target.value)) });
    this.pageLabel = h('span', { class: 'pg-label', 'data-testid': 'page-count', 'aria-live': 'polite' });
    this.sectionLabel = h('span', { class: 'pg-section' });
    this.bottom = h('footer', { class: 'bottombar' },
      h('button', { class: 'bb-arrow', 'data-testid': 'prev', 'aria-label': 'Previous page', onclick: () => this.book.prev() }, icon('arrowL')),
      h('div', { class: 'bb-mid' }, this.range, h('p', { class: 'bb-text' }, this.pageLabel, this.sectionLabel)),
      h('button', { class: 'bb-arrow', 'data-testid': 'next', 'aria-label': 'Next page', onclick: () => this.book.next() }, icon('arrowR')));
    this.drawer = h('aside', { class: 'drawer', hidden: true, role: 'dialog', 'aria-label': 'My Picks', 'data-testid': 'picks-drawer' });
    this.filterPanel = h('aside', { class: 'drawer filter-panel', hidden: true, role: 'dialog', 'aria-label': 'Filters', 'data-testid': 'filter-panel' });
    this.scrim = h('div', { class: 'scrim', hidden: true, onclick: () => this.closeOverlays() });
    this.modal = h('div', { class: 'modal-back', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });
    this.pop = h('div', { class: 'popover', hidden: true, role: 'dialog' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.measure = h('div', { class: 'lb-measure', 'aria-hidden': 'true' });
    this.root.replaceChildren(this.top, this.stage, this.sidePrev, this.sideNext, this.bottom, this.scrim, this.drawer, this.filterPanel, this.modal, this.pop, this.toasts);
    document.body.append(this.measure);
    this.book = new Flipbook(this.stage, {
      onChange: () => this.onTurned(),
      onWillShow: (idx) => this.loadNear(idx),
      onTurnStart: () => { this.closePop(); this.playTurn(); },
      // a drag may start anywhere except in a form field
      canDrag: (t) => !t.closest?.('input, select, textarea, [data-noflip]'),
    });
    this.renderPicksButton();
    this.renderSoundButton();
    this.setupInput();
  }

  /** Spread (two pages) on wide screens, one page on phones; the page size for that mode. */
  sizing() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw >= 900 && vh >= 560) return { mode: 'spread', ...SPREAD };
    const availW = Math.max(240, vw - 16), availH = Math.max(380, vh - 52 - 58 - 16);
    const hh = Math.round(Math.min(800, Math.max(560, (availH * SINGLE_W) / availW)) / 10) * 10;
    return { mode: 'single', w: SINGLE_W, h: hh };
  }

  relayoutIfNeeded() {
    const s = this.sizing();
    if (s.mode === this.size.mode && s.w === this.size.w && s.h === this.size.h) return;
    this.relayout();
  }

  /** Rebuild every page (new size, new filters), staying in the same section. */
  relayout() {
    const cur = this.book.visible()[0] ?? 0;
    const sec = this.sectionOf(cur);
    const off = sec ? cur - this.sectionStart[sec] : 0;
    this.layout(null, { section: sec, offset: off });
  }

  layout(page, anchor = null) {
    this.size = this.sizing();
    document.body.dataset.mode = this.size.mode;
    this.measure.style.setProperty('--pw', `${this.size.w}px`);
    this.measure.style.setProperty('--ph', `${this.size.h}px`);
    const t0 = performance.now();
    this.pages = this.buildPages();
    this.layoutMs = Math.round(performance.now() - t0);
    let at = page ?? 0;
    if (anchor?.section && this.sectionStart[anchor.section] !== undefined) {
      const start = this.sectionStart[anchor.section];
      const end = this.sectionEnd(anchor.section);
      at = Math.min(start + anchor.offset, end);
    }
    this.book.setPages(this.pages, { mode: this.size.mode, w: this.size.w, h: this.size.h, at });
    this.range.max = String(this.book.viewCount - 1);
  }

  sectionOf(i) { return this.pages[i]?.dataset.section || null; }
  sectionEnd(id) { let i = this.sectionStart[id]; while (i + 1 < this.pages.length && this.pages[i + 1].dataset.section === id) i++; return i; }

  // ------------------------------------------------------------------------------------------
  // Building the book

  buildPages() {
    const idx = this.index;
    const mode = this.size.mode;
    const pages = [];
    this.sectionStart = {};
    this.sectionTitle = {};
    this.dynamic = [];
    this.productPage = new Map();
    this.measure.replaceChildren();
    const fresh = (section, kind, extra = '') => {
      const el = h('article', { class: `page m-${mode} k-${kind} ${extra}`.trim(), 'data-section': section.id });
      this.measure.append(el);
      return el;
    };
    const framed = (section, kind) => {
      const el = fresh(section, kind, 'framed');
      const body = h('div', { class: 'pbody' });
      el.append(h('header', { class: 'rh' }, h('span', { class: 'rh-text' })), body, this.footer());
      return { el, body };
    };
    const add = (el, section) => { el.dataset.section = section.id; pages.push(el); };
    const alignLeft = (prev) => { if (mode === 'spread' && pages.length % 2 === 0) add(this.fillerPage(prev, fresh), prev); };

    // a page to measure parts in before they are placed, so a part that can change (a card's color, the
    // pick it holds) keeps the height of its tallest state and the page never overflows later
    this.probeBody = framed({ id: 'probe' }, 'cards').body;
    let prev = null;
    for (const section of this.sections()) {
      if (section.start === 'left') alignLeft(prev || section);
      this.sectionStart[section.id] = pages.length;
      this.sectionTitle[section.id] = section.title;
      for (const part of section.parts) {
        if (part.fixed) add(part.fixed(fresh, section), section);
        else for (const el of paginate(part.blocks, () => framed(section, part.kind || 'text'), part.head || null)) add(el, section);
      }
      prev = section;
    }
    // the back cover lands alone on the left of the last spread
    if (mode === 'spread' && pages.length % 2 === 0) add(this.endpaper(fresh, 'back'), { id: 'notes' });
    const back = { id: 'back', title: 'Back cover' };
    this.sectionStart.back = pages.length;
    this.sectionTitle.back = back.title;
    add(this.backCover(fresh, back), back);

    // folios, running heads, contents page numbers, where each product is
    pages.forEach((el, i) => {
      el.dataset.index = String(i);
      const side = mode === 'single' ? 'single' : i % 2 ? 'left' : 'right';
      el.classList.add(`side-${side}`);
      const folio = el.querySelector('.folio');
      if (folio) folio.textContent = String(i);
      const rh = el.querySelector('.rh-text');
      if (rh) rh.textContent = side === 'left' ? BOOK_TITLE : this.sectionTitle[el.dataset.section] || BOOK_TITLE;
      for (const card of el.querySelectorAll('.pcard[data-product]')) if (!this.productPage.has(card.dataset.product)) this.productPage.set(card.dataset.product, i);
      el.setAttribute('aria-label', `Page ${i}`);
    });
    for (const el of this.measure.querySelectorAll('[data-pageof]')) {
      const id = el.dataset.pageof;
      const at = id.startsWith('p:') ? this.productPage.get(id.slice(2)) : this.sectionStart[id];
      el.textContent = at === undefined ? '' : String(at);
    }
    // the options pages say which options they hold ("Options 4-6 of 7")
    for (const el of this.measure.querySelectorAll('.cards-head')) {
      const cards = [...el.parentElement.querySelectorAll('.pcard')];
      const n = Number(el.dataset.total), first = Number(cards[0]?.dataset.n || 0), last = Number(cards.at(-1)?.dataset.n || 0);
      el.querySelector('.ch-range').textContent = cards.length ? (n === 1 ? 'The option' : first === last ? `Option ${first} of ${n}` : `Options ${first}-${last} of ${n}`) : '';
    }
    this.measure.replaceChildren();
    return pages;
  }

  footer() {
    return h('footer', { class: 'pf' },
      h('button', { class: 'to-contents', 'data-testid': 'to-contents', 'data-goto': 'contents' }, icon('list', 'ico sm'), 'Back to contents'),
      h('span', { class: 'folio' }));
  }

  /** The book, in order. */
  sections() {
    const idx = this.index;
    const out = [];
    out.push({ id: 'cover', title: 'Cover', parts: [{ fixed: (fresh, s) => this.coverPage(fresh, s) }] });
    out.push({ id: 'welcome', title: 'Welcome', start: 'left', parts: [{ fixed: (fresh, s) => this.endpaper(fresh, 'front', s) }, { blocks: this.welcomeBlocks() }] });
    out.push({ id: 'contents', title: 'Contents', start: 'left', parts: [{ blocks: this.tocBlocks(), kind: 'toc' }] });
    out.push({ id: 'inspiration', title: 'Inspiration', start: 'left', parts: [{ blocks: this.inspirationBlocks() }] });
    for (const room of C.ROOMS) {
      const chap = `Chapter ${CHAPTER_NO[room]} · ${CHAPTER_NAME[room]}`;
      out.push({ id: room, title: chap, start: 'left', parts: [{ fixed: (fresh, s) => this.moodPage(fresh, s, room) }, { blocks: this.openerBlocks(room) }] });
      out.push({ id: `${room}/where`, title: chap, start: 'left', parts: [{ blocks: this.whereBlocks(room) }] });
      const cats = this.chapters[room];
      cats.forEach((cat, i) => {
        const list = C.categoryProducts(idx, cat.id);
        const shown = list.filter((p) => C.matchesFilters(p, this.filters, this.colors.get(p.id) ?? null));
        out.push({
          id: `${room}/${cat.id}`, title: chap, start: 'left', plate: C.topPick(idx, cat.id) || list[0], room,
          parts: [
            { blocks: this.introBlocks(room, cat, i + 1, cats.length, list, shown), kind: 'intro' },
            { blocks: shown.length ? shown.map((p) => this.cardBlock(p, room, list.indexOf(p) + 1)) : [blk('empty', h('p', {}, 'Nothing in this category matches the filters.'), h('button', { class: 'btn small', 'data-act': 'clear-filters' }, 'Clear filters'))], kind: 'cards', head: () => this.cardsHead(cat, list.length) },
          ],
        });
      });
      out.push({ id: `${room}/compare`, title: `${chap} · Comparison`, start: 'left', parts: [{ blocks: this.compareBlocks(room), kind: 'compare', head: (n) => (n ? this.compareHead() : null) }] });
    }
    const pk = Object.keys(idx.doc.packages);
    out.push({ id: 'packages', title: 'Packages', start: 'left', parts: [{ blocks: this.packagesIntroBlocks() }, ...pk.map((id) => ({ blocks: this.packageBlocks(id), kind: 'package' }))] });
    out.push({ id: 'buying-order', title: 'Buying order', start: 'any', parts: [{ blocks: this.buyingBlocks() }] });
    out.push({ id: 'notes', title: 'Notes', start: 'any', parts: [{ blocks: this.notesBlocks() }] });
    return out;
  }

  /**
   * A part of a page that is redrawn when My Picks change. `states`: the other ways it can look; it
   * keeps the height of the tallest one.
   */
  dyn(render, states = []) {
    let min = 0;
    for (const st of states) {
      this.probeBody.append(st);
      min = Math.max(min, st.getBoundingClientRect().height);
      st.remove();
    }
    const draw = () => { const el = render(); if (min) el.style.minHeight = `${Math.ceil(min)}px`; return el; };
    const entry = { el: draw(), render: draw };
    this.dynamic.push(entry);
    return entry.el;
  }

  /** A product card, as tall as its tallest color. */
  cardBlock(p, room, n) {
    const colors = [null, ...variantList(p).map((v) => v.key)];
    return this.dyn(() => this.card(p, room, n), colors.length > 1 ? colors.map((c) => this.card(p, room, n, c)) : []);
  }

  // ------------------------------------------------------------------------------------------
  // Covers, endpapers, plates

  coverPage(fresh, s) {
    const el = fresh(s, 'cover', 'hard');
    const look = [...this.lookOf('living'), ...this.lookOf('bedroom')].map((x) => x.p);
    const pick = (cat) => look.find((p) => p.category === cat);
    const hero = ['LR-RUG', 'LR-SCONCE', 'BR-DUVET', 'LR-COFFEE', 'BR-NIGHTSTAND'].map(pick).filter(Boolean);
    el.append(h('div', { class: 'cover-cloth' },
      h('div', { class: 'cover-frame' },
        h('p', { class: 'cover-kicker' }, 'A renovation lookbook'),
        h('h1', { class: 'cover-title emboss' }, h('span', {}, 'The Organic'), h('span', {}, 'Modern Edit')),
        h('p', { class: 'cover-sub' }, BOOK_SUBTITLE),
        h('div', { class: 'cover-plate' }, ...hero.map((p, i) => h('figure', { class: `cp cp-${i + 1}` }, limg(p.image_file, { small: i > 0, alt: '' })))),
        h('ul', { class: 'cover-palette', 'aria-label': 'Palette' }, ...PALETTE.map(([name, hex]) => h('li', { title: `${name} ${hex}`, style: { '--c': hex } }))),
        h('p', { class: 'cover-open' }, 'Open the book'))));
    el.addEventListener('click', () => { if (this.book.view === 0 && !this.book.dragged) this.book.next(); });
    return el;
  }

  endpaper(fresh, which, s = { id: 'welcome' }) {
    const el = fresh(s, 'endpaper', 'endpaper');
    if (which === 'front') {
      const prepared = String(this.index.doc.prepared_for || '').split(',')[0].trim();
      el.append(h('div', { class: 'bookplate' },
        h('p', { class: 'kicker' }, 'Ex libris'),
        h('p', { class: 'bp-title' }, BOOK_TITLE),
        prepared ? h('p', { class: 'bp-for' }, `Prepared for ${prepared}`) : null,
        h('p', { class: 'bp-date' }, `Los Angeles · ${C.fmtDate(this.index.doc.generated)}`),
        h('ul', { class: 'bp-palette' }, ...PALETTE.map(([name, hex]) => h('li', { title: name, style: { '--c': hex } })))));
    }
    el.append(this.footer());
    return el;
  }

  /** The page that fills an empty right page before a new spread: the top pick of what came before, or an ornament. */
  fillerPage(prev, fresh) {
    const p = prev?.plate;
    const el = fresh(prev, 'plate', 'plate');
    if (p) {
      const v = C.view(p);
      el.append(
        h('button', { class: 'plate-img', 'data-goto': `p:${p.id}`, 'aria-label': `Top pick: ${C.cleanName(p.name)}` }, limg(v.image, { small: false, alt: C.cleanName(p.name) })),
        h('div', { class: 'plate-cap' },
          h('p', { class: 'kicker' }, `${(p.tags || []).includes('Top pick') ? 'Top pick · ' : ''}${this.index.byCat.get(p.category).label}`),
          h('p', { class: 'plate-name' }, C.cleanName(p.name)),
          h('p', { class: 'plate-price' }, `${C.fmtMoney(C.toCents(v.price))} at ${p.store} · see page `, h('span', { 'data-pageof': `p:${p.id}` }, PAGE_NO))),
        this.footer());
    } else {
      el.classList.add('ornament');
      el.append(h('div', { class: 'orn' }, h('span', { class: 'orn-mark' }, '❦'), h('p', {}, BOOK_TITLE)), this.footer());
    }
    return el;
  }

  backCover(fresh, s) {
    const el = fresh(s, 'back', 'hard');
    const dates = this.index.doc.products.map((p) => p.price_checked_date).filter(Boolean).sort();
    const stock = this.index.doc.products.map((p) => p.stock_checked_date).filter(Boolean).sort();
    const range = (a, b) => (a === b ? C.fmtDate(a) : `${C.fmtDate(a).replace(/, \d{4}$/, '')} – ${C.fmtDate(b)}`);
    el.append(h('div', { class: 'cover-cloth back' },
      h('div', { class: 'cover-frame' },
        h('p', { class: 'back-line emboss' }, 'Warm, layered, lived in.'),
        h('p', { class: 'back-sub' }, 'A chocolate sectional, oat linen, rust and oak; a calm bedroom with one warm layer. Built from real pieces you can buy today.'),
        h('ul', { class: 'back-palette', 'aria-label': 'Palette' }, ...PALETTE.map(([name, hex]) => h('li', {}, h('span', { class: 'bp-chip', style: { '--c': hex } }), h('span', { class: 'bp-name' }, name), h('span', { class: 'bp-hex' }, hex)))),
        h('p', { class: 'back-date', 'data-testid': 'checked-date' }, `Prices checked ${range(dates[0], dates.at(-1))}`, h('br'), `Stock checked ${range(stock[0], stock.at(-1))} for delivery to ZIP ${this.index.doc.stock_zip}`),
        h('div', { class: 'back-acts' },
          h('button', { class: 'btn ghost light', 'data-goto': 'contents', 'data-testid': 'to-contents' }, icon('list', 'ico sm'), 'Back to contents'),
          h('button', { class: 'btn ghost light', 'data-goto': 'cover' }, 'Close the book')),
        h('p', { class: 'back-title' }, BOOK_TITLE))));
    return el;
  }

  // ------------------------------------------------------------------------------------------
  // Front matter

  welcomeBlocks() {
    const lc = this.concepts.living, bc = this.concepts.bedroom;
    const t = C.cartTotals(this.index, { picks: {} });
    const step = (n, title, text) => blk('howto', h('span', { class: 'howto-n' }, n), h('div', {}, h('p', { class: 'howto-t' }, title), h('p', { class: 'howto-x' }, text)));
    return [
      blk('page-title', h('p', { class: 'kicker' }, 'Welcome'), h('h2', {}, 'Two rooms, one warm palette')),
      blk('lede', h('p', {}, `${cap(lc?.title || '')}; ${bc?.title || ''}. Every piece in this book is a real product, priced and checked in stock for Los Angeles, chosen to fit the rooms as they are today.`)),
      blk('sub', h('h3', {}, 'How to use this book')),
      step('1', 'Turn the pages', 'Click or tap a page corner, swipe, use the arrow keys, or the arrows below the book.'),
      step('2', 'Jump anywhere', 'Every page has Back to contents; every entry in the contents opens its page.'),
      step('3', 'Make your picks', `Add to my picks keeps a running total against your ${C.fmtMoney(t.aimCents, { whole: true })} goal: amber over ${C.fmtMoney(t.aimCents, { whole: true })}, red over ${C.fmtMoney(t.ceilingCents, { whole: true })}. It is saved in this browser.`),
      step('4', 'Compare, then load a package', 'Each chapter ends with a side-by-side comparison. SAVE, BALANCED and UPGRADE at the back load a whole room in one click.'),
      blk('fineprint', h('p', {}, `Prices and stock were checked by the designer in October 2026 (each card says when); 9.75% sales tax applies to new items. Page sound is off; the speaker button above turns it on.`)),
    ];
  }

  tocBlocks() {
    const row = (id, label, { level = 2, badge = null } = {}) => {
      const b = h('button', { class: `toc-row l${level}`, 'data-goto': id, 'data-testid': 'toc-entry' },
        h('span', { class: 'toc-label' }, label, badge ? h('span', { class: 'both-badge sm' }, badge) : null),
        h('span', { class: 'toc-dots', 'aria-hidden': 'true' }),
        h('span', { class: 'toc-pg', 'data-pageof': id }, PAGE_NO));
      b.dataset.keep = level === 1 ? 'next' : '';
      return b;
    };
    const out = [blk('page-title', h('p', { class: 'kicker' }, BOOK_TITLE), h('h2', {}, 'Contents'))];
    out.push(row('welcome', 'Welcome & how to use this book', { level: 1 }), row('inspiration', 'Inspiration', { level: 1 }));
    for (const room of C.ROOMS) {
      const ch = row(room, `Chapter ${CHAPTER_NO[room]} · ${CHAPTER_NAME[room]}`, { level: 1 });
      ch.classList.add('chapter');
      out.push(ch, row(`${room}/where`, 'Where things are now'));
      for (const cat of this.chapters[room]) out.push(row(`${room}/${cat.id}`, cat.label, { badge: cat.shared ? 'Both rooms' : null }));
      out.push(row(`${room}/compare`, 'Comparison & room cost'));
    }
    out.push(row('packages', 'Packages: SAVE, BALANCED, UPGRADE', { level: 1 }), row('buying-order', 'Buying order', { level: 1 }), row('notes', 'Designer’s notes', { level: 1 }), row('back', 'Back cover', { level: 1 }));
    return out;
  }

  inspirationBlocks() {
    const card = (x, i) => blk('insp', h('span', { class: 'insp-n' }, pad2(i + 1)), h('div', {},
      h('p', { class: 'kicker' }, x.platform),
      h('h4', {}, h('a', { href: x.source_url, target: '_blank', rel: 'noopener' }, x.title)),
      h('p', { class: 'insp-take' }, x.takeaway),
      h('p', { class: 'insp-by' }, 'By ', h('strong', {}, x.creator), ' · ', h('a', { class: 'insp-link', href: x.source_url, target: '_blank', rel: 'noopener', 'data-testid': 'insp-link' }, `Read on ${x.platform}`, icon('ext', 'ico sm')))));
    const out = [blk('page-title', h('p', { class: 'kicker' }, 'Before we shop'), h('h2', {}, 'Inspiration'), h('p', { class: 'intro' }, 'Ideas pulled for each room, credited to the people who wrote them. Every link opens the original.'))];
    C.ROOMS.forEach((room, r) => {
      const head = blk('sub', h('h3', {}, C.ROOM_NAME[room]));
      head.dataset.keep = 'next';
      if (r) head.dataset.break = 'before';
      out.push(head, ...(this.insp[room] || []).map((x, i) => { const c = card(x, i); c.setAttribute('data-testid', 'insp-card'); return c; }));
    });
    out.push(blk('fineprint', h('p', {}, `${this.insp.note} Checked ${C.fmtDate(this.insp.checked)}.`)));
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // Chapters

  /** The products of a room's recommended (BALANCED) package: the look of the mood board. */
  lookOf(room) {
    const idx = this.index;
    const { picks } = C.packagePicks(idx, 'balanced');
    return Object.entries(picks).map(([key, v]) => ({ key, p: idx.products.get(v.id), qty: v.qty }))
      .filter(({ key, p }) => (C.roomOfPick(idx, key, p) || this.chapterOfCat.get(p.category)) === room && !MOOD_SKIP.has(p.category));
  }

  moodPage(fresh, s, room) {
    const el = fresh(s, 'mood', 'bleed');
    const look = this.lookOf(room).slice(0, 12);
    const cols = look.length > 7 ? 3 : 2;
    const spare = (cols - ((look.length + 1) % cols)) % cols; // the first tile is two rows tall; the last one fills the row
    const tints = ['#E6DCCB', '#F4EFE7', '#D3C1A5', '#EFE7DA', '#E9DFD0', '#DCCDB6', '#F1EBE1'];
    el.append(
      h('div', { class: 'mood', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } }, ...look.map(({ p }, i) => h('button', { class: 'mood-tile', 'data-goto': `p:${p.id}`, style: { '--tint': tints[i % tints.length], gridColumn: i === look.length - 1 && spare ? `span ${spare + 1}` : null }, 'aria-label': `${this.index.byCat.get(p.category).label}: ${C.cleanName(p.name)}` }, limg(p.image_file, { small: i > 1, alt: '' })))),
      h('div', { class: 'mood-cap' }, h('span', { class: 'mood-no' }, CHAPTER_NO[room]), h('span', {}, `The ${C.ROOM_NAME[room].toLowerCase()} look`)),
      this.footer());
    return el;
  }

  openerBlocks(room) {
    const c = this.concepts[room] || { title: '', text: '' };
    const look = this.lookOf(room);
    const price = look.reduce((a, { p, qty }) => a + C.toCents(p.price) * qty, 0);
    const cats = this.chapters[room];
    const out = [
      blk('opener-title', h('p', { class: 'kicker' }, `Chapter ${CHAPTER_NO[room]}`), h('h2', { class: 'chapter-title' }, CHAPTER_NAME[room]), h('p', { class: 'concept-title' }, c.title ? `${cap(c.title)}.` : '')),
      blk('concept', h('p', { 'data-testid': 'concept-text' }, c.text)),
      blk('look-box', h('p', { class: 'kicker' }, 'Shop the look'),
        h('p', {}, `The ${look.length} pieces on the facing page are the designer’s BALANCED picks for this room: ${C.fmtMoney(price)} before tax.`),
        h('button', { class: 'btn primary small', 'data-testid': 'add-look', 'data-act': 'add-look', 'data-room': room }, icon('plus', 'ico sm'), 'Add this look to my picks')),
    ];
    const head = blk('sub mini-toc-head', h('h3', {}, 'In this chapter'));
    head.dataset.keep = 'next';
    out.push(head, blk('mini-toc', ...[['where', 'Where things are now'], ...cats.map((x) => [x.id, x.label]), ['compare', 'Comparison & room cost']].map(([id, label]) => h('button', { class: 'mt-row', 'data-goto': `${room}/${id}` }, h('span', {}, label), h('span', { class: 'mt-pg', 'data-pageof': `${room}/${id}` }, PAGE_NO)))));
    return out;
  }

  whereBlocks(room) {
    const now = ROOM_NOW[room];
    const out = [
      blk('page-title', h('p', { class: 'kicker' }, `Chapter ${CHAPTER_NO[room]} · ${CHAPTER_NAME[room]}`), h('h2', {}, 'Where things are now')),
      blk('today', h('p', { class: 'kicker' }, 'The room today'), h('ul', {}, ...now.today.map((t) => h('li', {}, t)))),
    ];
    const head = blk('sub', h('h3', {}, 'What’s missing, and how the new pieces fix it'));
    head.dataset.keep = 'next';
    out.push(head);
    now.gaps.forEach((g, i) => out.push(blk('gap', h('span', { class: 'gap-n' }, pad2(i + 1)), h('div', {},
      h('p', { class: 'gap-need' }, g.need),
      h('p', { class: 'gap-fix' }, g.fix),
      h('p', { class: 'gap-links' }, ...g.cats.filter((id) => this.index.byCat.has(id)).map((id) => h('button', { class: 'chip-link', 'data-goto': `${this.chapterOfCat.get(id)}/${id}` }, this.index.byCat.get(id).label, ' · p. ', h('span', { 'data-pageof': `${this.chapterOfCat.get(id)}/${id}` }, PAGE_NO))))))));
    out.push(blk('fineprint', h('p', {}, 'From the designer’s notes (concept and placement). Sizes are in inches.')));
    return out;
  }

  introBlocks(room, cat, n, of, list, shown) {
    const copy = CATEGORY_COPY[cat.id] || { does: '', look: [] };
    const range = C.priceRange(list);
    const stores = [...new Set(list.map((p) => p.store))];
    const top = C.topPick(this.index, cat.id);
    const out = [
      blk('cat-title', h('p', { class: 'kicker' }, `Chapter ${CHAPTER_NO[room]} · ${pad2(n)} of ${of}`), h('h2', {}, cat.label), cat.shared ? h('span', { class: 'both-badge', 'data-testid': 'both-badge', title: 'This category is for both rooms' }, 'Both rooms') : null),
      copy.does ? blk('does', h('p', {}, copy.does)) : null,
    ].filter(Boolean);
    if (cat.rule) out.push(blk('rule', icon('ruler'), h('div', {}, h('p', { class: 'kicker' }, 'The sizing rule'), h('p', { 'data-testid': 'rule' }, cat.rule))));
    if (copy.look.length) out.push(blk('lookfor', h('p', { class: 'kicker' }, 'What to look for'), h('ul', {}, ...copy.look.map((t) => h('li', {}, t)))));
    out.push(blk('facts',
      h('div', {}, h('span', { class: 'f-n' }, String(list.length)), h('span', { class: 'f-l' }, list.length === 1 ? 'option' : 'options')),
      range ? h('div', {}, h('span', { class: 'f-n' }, range.min === range.max ? C.fmtMoney(C.toCents(range.min), { whole: true }) : `${C.fmtMoney(C.toCents(range.min), { whole: true })}–${C.fmtMoney(C.toCents(range.max), { whole: true })}`), h('span', { class: 'f-l' }, 'price range')) : null,
      h('div', {}, h('span', { class: 'f-n' }, String(stores.length)), h('span', { class: 'f-l' }, stores.length === 1 ? 'store' : 'stores'))));
    const named = C.categoryProducts(this.index, cat.id);
    out.push(this.dyn(() => this.slotLine(cat, room), named.map((p) => this.slotLine(cat, room, p))));
    if (C.filtersActive(this.filters)) out.push(blk('filter-note', h('p', {}, `Filters are on: showing ${shown.length} of ${list.length} options. `, h('button', { class: 'linkish', 'data-act': 'clear-filters' }, 'Clear filters'))));
    if (top) {
      out.push(optional(blk('top-teaser',
        h('button', { class: 'tt-img', 'data-goto': `p:${top.id}`, 'aria-label': `Top pick: ${C.cleanName(top.name)}` }, limg(top.image_file, { alt: '' })),
        h('div', {}, h('p', { class: 'kicker' }, 'Designer’s top pick'), h('button', { class: 'tt-link', 'data-goto': `p:${top.id}` }, C.cleanName(top.name)), h('p', { class: 'tt-meta' }, `${C.fmtMoney(C.toCents(top.price))} at ${top.store}`), top.why_this ? h('p', { class: 'tt-why' }, C.sentences(top.why_this, 1)) : null))));
    }
    out.push(optional(blk('thumbs', h('p', { class: 'kicker' }, `The ${list.length} options`), h('div', { class: 'thumb-row' }, ...list.map((p) => h('button', { class: `thumb ${shown.includes(p) ? '' : 'filtered'}`, 'data-goto': `p:${p.id}`, title: `${C.cleanName(p.name)} · ${C.fmtMoney(C.toCents(p.price))}` }, limg(p.image_file, { alt: C.cleanName(p.name) })))))));
    return out;
  }

  cardsHead(cat, total) {
    return h('div', { class: 'cards-head', 'data-total': String(total) }, h('span', { class: 'ch-cat' }, cat.label), h('span', { class: 'ch-range' }, ' '));
  }

  /** What's in My Picks for this category ("Your pick: ..."); `as`: show every slot holding this product (for measuring). */
  slotLine(cat, room, as = null) {
    const slots = cat.pickSlots;
    const bits = slots.map((s) => {
      const v = as ? { id: as.id, color: variantList(as).sort((a, b) => b.key.length - a.key.length)[0]?.key || null } : this.state.picks[s.key];
      const p = v && this.index.products.get(v.id);
      return h('span', { class: 'slot-pick' }, h('b', {}, slots.length > 1 ? `${s.label}: ` : 'Your pick: '), p ? h('button', { class: 'linkish', 'data-goto': `p:${p.id}` }, C.cleanName(p.name), v.color ? ` (${v.color})` : '') : h('span', { class: 'muted' }, 'none yet'));
    });
    return blk('slot-line', h('p', { 'data-testid': 'slot-line' }, ...bits));
  }

  // ------------------------------------------------------------------------------------------
  // Product card

  colorOf(p) { return this.colors.has(p.id) ? this.colors.get(p.id) : this.pickedColor(p); }

  card(p, room, n = 0, showColor) {
    const color = showColor !== undefined ? showColor : this.colorOf(p);
    const v = C.view(p, color);
    const name = C.cleanName(p.name);
    const tags = p.tags || [];
    const rating = C.ratingOf(p);
    const sizes = C.sizeParts(p);
    const missing = sizes.filter((s) => s.missing);
    const size = missing.length ? [`Size needed (${missing.map((s) => s.k).join(', ')})`]
      : [...sizes.flatMap((s, i) => [i ? ' × ' : '', C.fmtInches(s.v), s.est ? h('abbr', { class: 'est', title: 'Estimated: not printed on the product page' }, ' est.') : null]), ' in'];
    // one whole sentence, or two when they are short: the card shows its text in full
    const two = C.sentences(p.short_description, 2, p.name);
    const desc = two.length <= 150 ? two : C.sentences(p.short_description, 1, p.name);
    const swatches = [{ color: null, hex: p.main_color_hex, label: 'As listed' }, ...variantList(p).map((x) => ({ color: x.key, hex: x.hex, label: x.key }))];
    const card = h('article', { class: `pcard ${v.inStock ? '' : 'oos'} ${tags.includes('Top pick') ? 'is-top' : ''}`, 'data-product': p.id, 'data-n': String(n), 'data-room': room, 'data-testid': 'product-card' },
      h('div', { class: 'pc-media' },
        h('div', { class: 'pc-img' }, limg(v.image, { alt: name + (color ? `, ${color}` : ''), width: '400', height: '400', 'data-testid': 'product-image' }),
          this.isPlaced(p.id) ? h('span', { class: 'in3d', title: 'Placed in your 3D room' }, icon('cube', 'ico sm'), 'In 3D') : null)),
      h('div', { class: 'pc-body' },
        h('div', { class: 'pc-top' },
          h('p', { class: 'pc-store' }, [p.store, p.brand].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')),
          h('button', { class: `stock ${v.inStock ? 'in' : 'out'}`, type: 'button', 'data-testid': 'stock', 'data-act': 'stock', title: v.stockNote || '' }, h('span', { class: 'dot' }), v.inStock ? 'In stock' : 'Out of stock')),
        h('h3', { class: 'pc-name', title: name }, name),
        h('p', { class: 'pc-price' },
          h('strong', { 'data-testid': 'price' }, C.fmtMoney(C.toCents(v.price))),
          v.onSale ? h('s', { 'data-testid': 'regular-price' }, C.fmtMoney(C.toCents(v.regular))) : null,
          v.onSale ? h('span', { class: 'sale' }, 'Sale') : null,
          (p.qty_suggested || 1) > 1 ? h('span', { class: 'per' }, `each · need ${p.qty_suggested}`) : null),
        tags.length ? h('div', { class: 'tags' }, ...tags.map((t) => (t === 'Used' && p.condition === 'used'
          ? h('span', { class: 'tag tag-used', 'data-testid': 'used-label' }, p.used_label || 'Used')
          : h('span', { class: `tag tag-${t.toLowerCase().replace(/\s+/g, '-')}` }, t)))) : null,
        desc ? h('p', { class: 'pc-desc' }, desc) : null,
        h('p', { class: 'pc-spec' }, h('span', { 'data-testid': 'size' }, ...size), rating ? h('span', { class: 'rating', title: `${rating.stars} stars${rating.count ? ` from ${rating.count} reviews` : ''}` }, icon('star', 'ico xs'), `${rating.stars}${rating.count ? ` (${rating.count.toLocaleString('en-US')})` : ''}`) : null),
        swatches.length > 1 ? h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' },
          ...swatches.map((s) => h('button', { class: 'sw', role: 'radio', 'aria-checked': String((s.color || null) === (color || null)), 'aria-label': s.label, title: s.label, 'data-color': s.color || '', 'data-testid': 'swatch', 'data-act': 'swatch', style: { '--sw': s.hex } })),
          h('span', { class: 'sw-name', 'data-testid': 'color-name' }, color || 'As listed')) : null),
      h('div', { class: 'pc-acts' },
        h('a', { class: 'btn buy', href: v.url, target: '_blank', rel: 'noopener', 'data-testid': 'buy', title: `Buy at ${p.store}` }, 'Buy', p.store.length <= 12 ? h('span', { class: 'buy-store' }, ` at ${p.store}`) : null, icon('ext', 'ico sm')),
        this.pickButton(p, room, color),
        h('button', { class: 'btn icon-only see3d', 'data-testid': 'see3d', 'data-act': 'see3d', title: 'See it in the 3D rooms', 'aria-label': 'See in 3D' }, icon('cube', 'ico sm'))));
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

  pickButton(p, room, color) {
    const cands = C.candidateKeys(this.index, p, room);
    const holds = (s) => { const v = this.state.picks[s.key]; return v && v.id === p.id && (v.color || null) === (color || null); };
    const here = cands.filter(holds);
    if (here.length) {
      return h('button', { class: 'btn pick on', 'data-testid': 'pick', 'data-act': 'unpick', 'data-key': here[0].key, 'aria-pressed': 'true', title: `In My Picks: ${here.map((s) => s.label).join(', ')}. Click to remove.` }, icon('check', 'ico sm'), h('span', {}, 'In my picks'));
    }
    const occ = cands.length === 1 && this.state.picks[cands[0].key];
    const same = occ && occ.id === p.id;
    return h('button', { class: 'btn pick', 'data-testid': 'pick', 'data-act': 'pick', 'aria-pressed': 'false', 'aria-haspopup': cands.length > 1 ? 'menu' : null, title: occ ? (same ? 'Switch your pick to this color' : `Replaces ${C.cleanName(this.index.products.get(occ.id)?.name || '')} in My Picks`) : 'Add to My Picks' },
      icon('plus', 'ico sm'), h('span', {}, same ? 'Pick this color' : 'Add to my picks'));
  }

  // ------------------------------------------------------------------------------------------
  // Comparison

  /** Column labels: at the top of every comparison page after the first (the first has them under the room cost). */
  compareHead() {
    return h('div', { class: 'cmp-head', 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Option · store · material · tags'), h('span', {}, 'W × D × H in'), h('span', { class: 'r' }, 'Rating'), h('span', { class: 'r' }, 'Price'));
  }

  compareBlocks(room) {
    const idx = this.index;
    const cats = this.chapters[room];
    const out = [
      blk('page-title', h('p', { class: 'kicker' }, `Chapter ${CHAPTER_NO[room]} · ${CHAPTER_NAME[room]}`), h('h2', {}, 'Side by side'), h('p', { class: 'intro' }, `Every option in this chapter: price, size, material, store, rating and tags. The designer’s top pick in each category is highlighted.`)),
      this.roomCostBlock(room),
    ];
    const labels = this.compareHead();
    labels.classList.add('blk');
    labels.dataset.keep = 'next';
    out.push(labels);
    for (const cat of cats) {
      const list = C.categoryProducts(idx, cat.id);
      const head = blk('cmp-cat', h('button', { class: 'cmp-cat-btn', 'data-goto': `${room}/${cat.id}` }, cat.label), h('span', { class: 'cmp-cat-pg' }, C.topPick(idx, cat.id) ? '' : 'no top pick named · ', 'p. ', h('span', { 'data-pageof': `${room}/${cat.id}` }, PAGE_NO)));
      head.dataset.keep = 'next';
      out.push(head, ...list.map((p) => this.compareRow(p)));
    }
    return out;
  }

  compareRow(p) {
    const v = C.view(p);
    const top = (p.tags || []).includes('Top pick');
    const rating = C.ratingOf(p);
    const sizes = C.sizeParts(p);
    const size = sizes.some((s) => s.missing) ? 'size needed' : sizes.map((s) => String(Math.round(s.v * 10) / 10)).join(' × ');
    const tags = (p.tags || []).filter((t) => t !== 'Top pick');
    return h('button', { class: `blk cmp-row ${top ? 'top' : ''}`, 'data-goto': `p:${p.id}`, 'data-product-row': p.id, 'data-testid': 'compare-row', title: `Open ${C.cleanName(p.name)}` },
      h('span', { class: 'cmp-thumb' }, limg(p.image_file, { alt: '' })),
      h('span', { class: 'cmp-main' },
        h('span', { class: 'cmp-name' }, top ? h('span', { class: 'cmp-star' }, icon('star', 'ico xs'), 'Top pick') : null, C.cleanName(p.name)),
        h('span', { class: 'cmp-sub' }, [p.store, C.materialShort(p.material) || 'material not listed'].join(' · ')),
        tags.length ? h('span', { class: 'cmp-tags' }, tags.join(' · ')) : null),
      h('span', { class: 'cmp-size' }, size),
      h('span', { class: `cmp-rating ${rating ? '' : 'none'}`, title: rating?.count ? `${rating.count} reviews` : null }, rating ? [icon('star', 'ico xs'), String(rating.stars)] : '–'),
      h('span', { class: 'cmp-price' }, h('strong', {}, C.fmtMoney(C.toCents(v.price))), v.onSale ? h('s', {}, C.fmtMoney(C.toCents(v.regular))) : null));
  }

  roomCostBlock(room) {
    const idx = this.index;
    const ids = Object.keys(idx.doc.packages);
    const rows = ids.map((id) => C.roomPackageTotals(idx, id, room, SHARED_CHAPTER));
    const cell = (c) => C.fmtMoney(c);
    return blk('room-cost', h('p', { class: 'kicker' }, `What the ${C.ROOM_NAME[room].toLowerCase()} costs`),
      h('table', { 'data-testid': 'room-cost' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...ids.map((id) => h('th', { class: id === 'balanced' ? 'hl' : '' }, id.toUpperCase())))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'Pieces'), ...rows.map((r) => h('td', {}, String(r.lines.length)))),
          h('tr', {}, h('td', {}, 'Before tax'), ...rows.map((r) => h('td', {}, cell(r.subtotalCents)))),
          h('tr', {}, h('td', {}, 'Tax 9.75% (new)'), ...rows.map((r) => h('td', {}, cell(r.taxCents)))),
          h('tr', { class: 'sum' }, h('td', {}, 'Room total'), ...rows.map((r) => h('td', { 'data-testid': `room-cost-${r.id}` }, cell(r.totalCents)))))),
      h('p', { class: 'fineprint' }, 'Delivery is listed with the packages. Each room is rounded on its own; the package pages have the exact checkout totals.'));
  }

  // ------------------------------------------------------------------------------------------
  // Packages, buying order, notes

  packagesIntroBlocks() {
    const idx = this.index;
    const ids = Object.keys(idx.doc.packages);
    const delivery = C.mdSections(this.notesMd).find((s) => /^packages/i.test(s.title))?.lines.filter((l) => /delivery assumptions/i.test(l)) || [];
    return [
      blk('page-title', h('p', { class: 'kicker' }, 'Three ways to buy it'), h('h2', {}, 'Packages'), h('p', { class: 'intro' }, 'Totals include 9.75% sales tax on new items; used private sales are untaxed. Loading a package replaces My Picks with its pieces and quantities.')),
      blk('pkg-summary', ...ids.map((id) => {
        const t = C.packageTotals(idx, id);
        const lvl = this.levelOf(t.totalCents);
        return h('button', { class: `pkg-sum level-${lvl}`, 'data-goto': `pkg:${id}` }, h('span', { class: 'pkg-sum-name' }, id.toUpperCase()), h('span', { class: 'pkg-sum-total' }, C.fmtMoney(t.totalCents)), h('span', { class: 'pkg-sum-n' }, `${t.lines.length} items`));
      })),
      delivery.length ? blk('fineprint md', h('div', { html: C.mdToHtml(delivery) })) : null,
    ].filter(Boolean);
  }

  levelOf(cents) {
    const b = this.index.budget;
    return cents <= C.toCents(b.aim_total) ? 'ok' : cents <= C.toCents(b.hard_ceiling) ? 'amber' : 'red';
  }

  packageBlocks(id) {
    const idx = this.index;
    const t = C.packageTotals(idx, id);
    const blurb = this.blurbs[id] || {};
    const lvl = this.levelOf(t.totalCents);
    const b = idx.budget;
    const out = [h('div', { class: `blk pkg-head ${id === 'balanced' ? 'featured' : ''}`, 'data-package': id, 'data-testid': 'package' },
      h('div', { class: 'pkg-head-top' },
        h('div', {}, id === 'balanced' ? h('p', { class: 'ribbon' }, 'Designer’s recommendation') : null, h('h2', { class: 'pkg-name' }, id.toUpperCase()), blurb.note ? h('p', { class: 'kicker' }, blurb.note) : null),
        h('div', { class: 'pkg-total-box' }, h('p', { class: 'pkg-total', 'data-testid': 'package-total' }, C.fmtMoney(t.totalCents)), h('p', { class: `pkg-state level-${lvl}` }, lvl === 'ok' ? `Under the ${C.fmtMoney(C.toCents(b.aim_total), { whole: true })} goal` : lvl === 'amber' ? `Under the ${C.fmtMoney(C.toCents(b.hard_ceiling), { whole: true })} ceiling` : 'Over the ceiling'))),
      blurb.text ? h('p', { class: 'pkg-blurb' }, `${id.toUpperCase()} ${blurb.text}`) : null,
      this.dyn(() => this.loadButton(id)))];
    out[0].dataset.keep = 'next';
    const { picks } = C.packagePicks(idx, id);
    const keyOf = new Map(Object.entries(picks).map(([k, v]) => [v.id, k]));
    for (const room of C.ROOMS) {
      const ls = t.lines.filter((l) => (C.roomOfPick(idx, keyOf.get(l.id), l.product) || this.chapterOfCat.get(l.product.category)) === room);
      if (!ls.length) continue;
      const head = blk('pkg-room', h('h4', {}, C.ROOM_NAME[room]), h('span', {}, `${ls.length} items`));
      head.dataset.keep = 'next';
      out.push(head, ...ls.map((l) => h('button', { class: 'blk pkg-line', 'data-goto': `p:${l.id}`, 'data-testid': 'package-line' },
        h('span', { class: 'pl-name' }, C.cleanName(l.name)),
        h('span', { class: 'pl-meta' }, `${l.store}${l.qty > 1 ? ` · ${l.qty} × ${C.fmtMoney(l.unitCents)}` : ''}${l.taxed ? '' : ' · used, no tax'}`),
        h('span', { class: 'pl-price' }, C.fmtMoney(l.cents)))));
    }
    out.push(h('div', { class: 'blk pkg-totals' },
      h('table', { class: 'totals' },
        h('tr', {}, h('td', {}, 'Subtotal'), h('td', { 'data-testid': 'package-subtotal' }, C.fmtMoney(t.taxedCents + t.untaxedCents))),
        h('tr', { class: 'minor' }, h('td', {}, 'New items'), h('td', { 'data-testid': 'package-new' }, C.fmtMoney(t.taxedCents))),
        h('tr', { class: 'minor' }, h('td', {}, 'Used items (no tax)'), h('td', { 'data-testid': 'package-used' }, C.fmtMoney(t.untaxedCents))),
        h('tr', {}, h('td', {}, `Sales tax ${(idx.taxRate * 100).toFixed(2)}% (new items)`), h('td', { 'data-testid': 'package-tax' }, C.fmtMoney(t.taxCents))),
        h('tr', {}, h('td', {}, 'Delivery'), h('td', { 'data-testid': 'package-delivery' }, C.fmtMoney(t.deliveryCents))),
        h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', { 'data-testid': 'package-total-row' }, C.fmtMoney(t.totalCents)))),
      t.matchesStored ? null : h('p', { class: 'fineprint warn' }, `Recalculated from today's prices in products.json; the designer's figure was ${C.fmtMoney(t.stored.total)}.`)));
    out.push(this.dyn(() => blk('pkg-load-end', this.loadButton(id))));
    return out;
  }

  loadButton(id) {
    const { picks } = C.packagePicks(this.index, id);
    const loaded = Object.keys(picks).length === Object.keys(this.state.picks).length && Object.entries(picks).every(([k, v]) => this.state.picks[k]?.id === v.id && this.state.picks[k]?.qty === v.qty);
    return h('button', { class: `btn ${loaded ? '' : 'primary'} full`, 'data-testid': 'load-package', 'data-act': 'load-package', 'data-package': id }, loaded ? [icon('check', 'ico sm'), `${id.toUpperCase()} is in My Picks`] : `Load ${id.toUpperCase()} into my picks`);
  }

  buyingBlocks() {
    const sec = C.mdSections(this.notesMd).find((s) => /^buying order/i.test(s.title));
    const steps = (sec?.lines || []).map((l) => /^\s*\d+\.\s+(.*)$/.exec(l)?.[1]).filter(Boolean);
    const out = [blk('page-title', h('p', { class: 'kicker' }, 'Before you check out'), h('h2', {}, 'Buying order'), h('p', { class: 'intro' }, 'Biggest impact first, from the designer’s notes.'))];
    steps.forEach((s, i) => {
      const links = BUYING_LINKS.find((b) => b.re.test(s))?.cats.filter((id) => this.index.byCat.has(id)) || [];
      out.push(blk('step', h('span', { class: 'step-n' }, String(i + 1)), h('div', {},
        h('p', { class: 'step-t', html: C.inlineMd(s) }),
        links.length ? h('p', { class: 'gap-links' }, ...links.map((id) => h('button', { class: 'chip-link', 'data-goto': `${this.chapterOfCat.get(id)}/${id}` }, this.index.byCat.get(id).label, ' · p. ', h('span', { 'data-pageof': `${this.chapterOfCat.get(id)}/${id}` }, PAGE_NO)))) : null)));
    });
    return out;
  }

  notesBlocks() {
    const secs = C.mdSections(this.notesMd);
    const get = (re) => secs.find((s) => re.test(s.title));
    const out = [blk('page-title', h('p', { class: 'kicker' }, 'Appendix'), h('h2', {}, 'Designer’s notes'))];
    const section = (title, lines) => {
      if (!lines) return;
      const head = blk('sub', h('h3', {}, title));
      head.dataset.keep = 'next';
      out.push(head, ...this.mdBlocks(lines));
    };
    section('Placement', get(/^placement/i)?.lines);
    section('Unsure', get(/^unsure/i)?.lines);
    section('Your Oct 13 list, re-checked', get(/^your oct/i)?.lines);
    const manual = C.mdSections(this.manualMd);
    section('Still to check by hand', [...manual[0].lines.filter((l) => !/^#\s/.test(l)), ...manual.slice(1).flatMap((s) => [`### ${s.title}`, ...s.lines])]);
    return out;
  }

  /** Markdown as page blocks: one block per paragraph, heading or list item. */
  mdBlocks(lines) {
    const tmp = document.createElement('div');
    tmp.innerHTML = C.mdToHtml(lines);
    const out = [];
    for (const el of [...tmp.children]) {
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        [...el.children].forEach((li, i) => { const l = document.createElement(el.tagName); if (el.tagName === 'OL') l.start = i + 1; l.append(li); out.push(blk('md', l)); });
      } else {
        const b = blk('md', el);
        if (/^H\d$/.test(el.tagName)) b.dataset.keep = 'next';
        out.push(b);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // After a turn

  onTurned() {
    const vis = this.book.visible();
    const n = this.pages.length;
    const closed = this.book.closed;
    const label = closed === 'front' ? 'Cover' : closed === 'back' ? 'Back cover'
      : vis.length === 2 ? `Pages ${vis[0]}–${vis[1]} of ${n - 1}` : vis[0] === 0 ? 'Cover' : vis[0] === n - 1 ? 'Back cover' : `Page ${vis[0]} of ${n - 1}`;
    this.pageLabel.textContent = label;
    const sec = this.sectionOf(vis.at(-1) ?? 0);
    this.sectionLabel.textContent = sec && !['cover', 'back'].includes(sec) ? ` · ${this.sectionTitle[sec] || ''}` : '';
    this.range.value = String(this.book.view);
    this.range.style.setProperty('--p', `${(this.book.view / Math.max(1, this.book.viewCount - 1)) * 100}%`);
    document.body.classList.toggle('book-closed', !!closed || (this.size.mode === 'single' && vis[0] === 0));
    this.sidePrev.disabled = this.book.view === 0;
    this.sideNext.disabled = this.book.view === this.book.viewCount - 1;
    const hash = sec ? `#/${sec === 'back' ? 'back' : sec}` : '#/cover';
    if (this.routed && location.hash !== hash) history.replaceState(null, '', hash); // not before the link that opened the book is read
    document.title = `${sec && this.sectionTitle[sec] && sec !== 'cover' ? `${this.sectionTitle[sec]} · ` : ''}${BOOK_TITLE}`;
    if (this.flashId) {
      const card = this.pages[this.productPage.get(this.flashId)]?.querySelector(`.pcard[data-product="${CSS.escape(this.flashId)}"]`);
      this.flashId = null;
      if (card) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 2200); }
    }
  }

  /** Load the images of the pages around these. */
  loadNear(indexes) {
    const want = new Set();
    for (const i of indexes) for (let d = -2; d <= 3; d++) want.add(i + d);
    for (const i of want) {
      const el = this.pages[i];
      if (!el) continue;
      for (const im of el.querySelectorAll('img[data-src]')) {
        if (im.dataset.srcset) { im.srcset = im.dataset.srcset; im.sizes = im.closest('.pc-img, .cmp-thumb') ? '160px' : '(max-width: 700px) 100vw, 540px'; }
        im.src = im.dataset.src;
        delete im.dataset.src;
        delete im.dataset.srcset;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Navigation

  routeTarget() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!this.sectionStart) return null;
    let product = null, section = null;
    if (/^p=/.test(hash)) product = new URLSearchParams(hash).get('p');
    else if (hash.startsWith('/')) {
      const [path, query] = hash.slice(1).split('?');
      product = new URLSearchParams(query || '').get('p');
      const m = /^page\/(\d+)$/.exec(path);
      if (m) return { page: Number(m[1]) };
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 2 && this.chapterOfCat.has(parts[1])) section = `${this.chapterOfCat.get(parts[1])}/${parts[1]}`; // old links name the other room for shared categories
      else section = parts.join('/') || 'cover';
    }
    if (product && this.productPage.has(product)) return { page: this.productPage.get(product), product };
    if (section && this.sectionStart[section] !== undefined) return { page: this.sectionStart[section] };
    return { page: 0 };
  }

  route({ animate = true } = {}) {
    const t = this.routeTarget();
    if (!t) return;
    this.routed = true;
    this.closeOverlays();
    this.closeModal();
    if (t.product) this.flashId = t.product;
    if (this.book.visible().includes(t.page)) { this.onTurned(); return; }
    this.book.goTo(t.page, { animate });
  }

  goSection(id) {
    this.closeOverlays();
    const p = id === 'cover' ? 0 : this.sectionStart[id];
    if (p !== undefined) this.book.goTo(p);
  }

  goProduct(id) {
    const p = this.productPage.get(id);
    if (p === undefined) return;
    this.closeOverlays();
    this.flashId = id;
    if (this.book.visible().includes(p)) this.onTurned();
    else this.book.goTo(p);
  }

  goto(target) {
    if (target.startsWith('p:')) return this.goProduct(target.slice(2));
    if (target.startsWith('pkg:')) {
      const id = target.slice(4);
      const i = this.pages.findIndex((el) => el.querySelector(`.pkg-head[data-package="${id}"]`));
      if (i >= 0) this.book.goTo(i);
      return;
    }
    return this.goSection(target);
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
      const ok = await this.confirm('Add the whole look?', `This replaces ${replacing.length} of your current pick${replacing.length > 1 ? 's' : ''} with the designer's ${C.ROOM_NAME[room].toLowerCase()} look.`, 'Add the look');
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
    this.afterPicks();
  }

  /** Picks changed (here or in another tab): refresh the button, the panel and every page part that shows them. */
  afterPicks() {
    this.renderPicksButton();
    if (!this.drawer.hidden) this.renderDrawer();
    for (const d of this.dynamic) {
      const next = d.render();
      // keep what the pagination decided about this block
      for (const k of ['keep', 'break']) if (d.el.dataset[k]) next.dataset[k] = d.el.dataset[k];
      d.el.replaceWith(next);
      d.el = next;
    }
    this.loadNear(this.book.visible());
  }

  renderPicksButton() {
    const t = C.cartTotals(this.index, this.state);
    const n = t.lines.length;
    this.picksBtn.className = `tb-btn picks-btn level-${t.level}`;
    this.picksBtn.replaceChildren(icon('bag'), h('span', { class: 'pb-label' }, 'My Picks'), h('span', { class: 'pb-n', 'data-testid': 'picks-count' }, String(n)), h('span', { class: 'pb-total', 'data-testid': 'picks-total' }, C.fmtMoney(t.totalCents)));
    this.picksBtn.setAttribute('aria-label', `My Picks: ${n} pieces, ${C.fmtMoney(t.totalCents)}`);
  }

  openPicks() {
    this.closeOverlays();
    this.drawer.hidden = false;
    this.scrim.hidden = false;
    document.body.classList.add('drawer-open');
    this.renderDrawer();
    this.drawer.querySelector('.drawer-close')?.focus();
  }

  closeOverlays() {
    this.drawer.hidden = true;
    this.filterPanel.hidden = true;
    this.scrim.hidden = true;
    document.body.classList.remove('drawer-open');
    this.closePop();
  }

  renderDrawer() {
    const idx = this.index;
    const t = C.cartTotals(idx, this.state);
    const pct = (c) => Math.min(100, (c / t.ceilingCents) * 100);
    const levelText = t.level === 'red' ? `Over the ${C.fmtMoney(t.ceilingCents, { whole: true })} ceiling by ${C.fmtMoney(t.totalCents - t.ceilingCents)}`
      : t.level === 'amber' ? `Over your ${C.fmtMoney(t.aimCents, { whole: true })} goal by ${C.fmtMoney(t.totalCents - t.aimCents)}`
        : `${C.fmtMoney(t.aimCents - t.totalCents)} under your ${C.fmtMoney(t.aimCents, { whole: true })} goal`;
    const roomOf = (l) => l.room || (l.product.room === 'both' ? null : l.product.room);
    const groups = [['living', 'Living room'], ['bedroom', 'Bedroom'], [null, 'Both rooms']].map(([room, label]) => [label, t.lines.filter((l) => (roomOf(l) || null) === room)]).filter(([, ls]) => ls.length);
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
          h('a', { class: 'pl-name', href: `#p=${encodeURIComponent(p.id)}`, onclick: () => this.closeOverlays() }, C.cleanName(p.name)),
          h('p', { class: 'pl-meta' }, [p.store, l.view.color, p.condition === 'used' ? 'used, no tax' : null, l.deliveryCents ? `+${C.fmtMoney(l.deliveryCents)} delivery` : null].filter(Boolean).join(' · ')),
          h('div', { class: 'pl-row' }, qty,
            h('strong', { class: 'pl-price', 'data-testid': 'line-price' }, C.fmtMoney(l.cents)),
            h('a', { class: 'pl-buy', href: l.url, target: '_blank', rel: 'noopener', 'data-testid': 'line-buy' }, 'Buy', icon('ext', 'ico sm')),
            h('button', { class: 'pl-remove', 'aria-label': `Remove ${C.cleanName(p.name)}`, 'data-testid': 'line-remove', onclick: () => this.unpick(l.key) }, icon('close', 'ico sm')))));
    };
    const linksOpen = !!this.linksOpen;
    const links = C.linksByStore(t.lines);
    this.drawer.replaceChildren(...[
      h('div', { class: 'drawer-head' }, h('h2', {}, 'My Picks'), h('button', { class: 'icon-btn drawer-close', 'aria-label': 'Close My Picks', onclick: () => this.closeOverlays() }, icon('close'))),
      h('div', { class: `budget level-${t.level}`, 'data-testid': 'budget', 'data-level': t.level },
        h('div', { class: 'budget-top' }, h('span', { class: 'b-total', 'data-testid': 'total' }, C.fmtMoney(t.totalCents)), h('span', { class: 'b-state', 'data-testid': 'level-text' }, levelText)),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: { width: `${pct(t.totalCents)}%` } }), h('span', { class: 'meter-mark aim', style: { left: `${pct(t.aimCents)}%` } }), h('span', { class: 'meter-mark ceil' })),
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
        : h('div', { class: 'drawer-empty' }, h('p', {}, 'No picks yet.'), h('p', { class: 'fineprint' }, 'Add pieces from the room chapters, or load a package. One pick per category; pillows and inserts can take a quantity.'), h('button', { class: 'btn', onclick: () => this.goSection('packages') }, 'See the packages')),
      h('p', { class: 'fineprint drawer-foot' }, `${idx.budget?.note || ''} Kept in this browser; the 3D rooms read the same list.`),
    ].filter(Boolean)); // replaceChildren would print a null as text
  }

  // ------------------------------------------------------------------------------------------
  // Filters

  openFilters() {
    this.closeOverlays();
    this.filterPanel.hidden = false;
    this.scrim.hidden = false;
    document.body.classList.add('drawer-open');
    this.renderFilters();
    this.filterPanel.querySelector('.drawer-close')?.focus();
  }

  renderFilters() {
    const f = this.filters;
    const stores = [...new Set(this.index.doc.products.map((p) => p.store))].sort();
    const changed = () => { clearTimeout(this.filterT); this.filterT = setTimeout(() => this.applyFilters(), 120); };
    const toggle = (key, label) => h('label', { class: 'fchip' }, h('input', { type: 'checkbox', checked: f[key] || null, 'data-filter': key, onchange: (e) => { f[key] = e.target.checked; changed(); } }), h('span', {}, label));
    const storeChip = (s) => h('label', { class: 'fchip' }, h('input', { type: 'checkbox', checked: f.stores.includes(s) || null, 'data-store': s, onchange: (e) => { f.stores = e.target.checked ? [...f.stores, s] : f.stores.filter((x) => x !== s); changed(); } }), h('span', {}, s));
    const price = (key, label) => h('label', { class: 'fprice' }, h('span', {}, label), h('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', value: f[key] ?? '', 'data-filter': key, 'aria-label': `${label} price in dollars`, oninput: (e) => { const v = parseFloat(e.target.value); f[key] = Number.isFinite(v) ? v : null; changed(); } }));
    this.filterPanel.replaceChildren(
      h('div', { class: 'drawer-head' }, h('h2', {}, 'Filters'), h('button', { class: 'icon-btn drawer-close', 'aria-label': 'Close filters', onclick: () => this.closeOverlays() }, icon('close'))),
      h('p', { class: 'fineprint' }, 'Filters choose which options the product pages show. The comparisons and the packages always list everything.'),
      h('div', { class: 'fgroup' }, h('p', { class: 'fgroup-label' }, 'Store'), h('div', { class: 'fchips' }, ...stores.map(storeChip))),
      h('div', { class: 'fgroup' }, h('p', { class: 'fgroup-label' }, 'Price'), h('div', { class: 'fprices' }, price('min', 'Min'), h('span', { class: 'dash' }, '–'), price('max', 'Max'))),
      h('div', { class: 'fgroup' }, h('p', { class: 'fgroup-label' }, 'Show only'), h('div', { class: 'fchips' }, toggle('deal', 'Deal'), toggle('used', 'Used'), toggle('top', 'Top pick'))),
      h('p', { class: 'filter-result', 'data-testid': 'filter-result' }, this.filterSummary()),
      h('div', { class: 'drawer-acts' },
        h('button', { class: 'btn primary', 'data-testid': 'filters-done', onclick: () => this.closeOverlays() }, 'Show the pages'),
        h('button', { class: 'linkish', 'data-testid': 'clear-filters', onclick: () => { this.filters = C.emptyFilters(); this.applyFilters(); this.renderFilters(); } }, 'Clear filters')));
  }

  filterSummary() {
    const all = this.index.doc.products;
    const n = all.filter((p) => C.matchesFilters(p, this.filters, this.colors.get(p.id) ?? null)).length;
    return C.filtersActive(this.filters) ? `${n} of ${all.length} options match.` : `All ${all.length} options are shown.`;
  }

  applyFilters() {
    const n = this.filters.stores.length + (this.filters.min !== null) + (this.filters.max !== null) + this.filters.deal + this.filters.used + this.filters.top;
    this.filterBtn.querySelector('.tb-count').textContent = n ? String(n) : '';
    this.filterBtn.classList.toggle('on', n > 0);
    this.relayout();
    const res = this.filterPanel.querySelector('.filter-result');
    if (res) res.textContent = this.filterSummary();
  }

  // ------------------------------------------------------------------------------------------
  // Sound: a soft paper turn made on the spot (no audio file), off unless switched on

  toggleSound() {
    this.sound = !this.sound;
    try { localStorage.setItem(SOUND_KEY, this.sound ? 'on' : 'off'); } catch { /* storage blocked */ }
    this.renderSoundButton();
    if (this.sound) this.playTurn();
  }

  renderSoundButton() {
    this.soundBtn.replaceChildren(icon(this.sound ? 'soundOn' : 'soundOff'), h('span', { class: 'tb-label' }, this.sound ? 'Sound on' : 'Sound off'));
    this.soundBtn.setAttribute('aria-pressed', String(this.sound));
    this.soundBtn.setAttribute('aria-label', this.sound ? 'Page-turn sound on' : 'Page-turn sound off');
  }

  playTurn() {
    if (!this.sound) return;
    try {
      const ac = (this.ac ||= new (window.AudioContext || window.webkitAudioContext)());
      if (ac.state === 'suspended') ac.resume();
      const len = Math.floor(ac.sampleRate * 0.42);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 1.6) * (0.55 + 0.45 * Math.sin(t * 38 + Math.sin(t * 9) * 3));
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, ac.currentTime);
      bp.frequency.linearRampToValueAtTime(1400, ac.currentTime + 0.4);
      bp.Q.value = 0.7;
      const g = ac.createGain();
      g.gain.value = 0.22;
      src.connect(bp).connect(g).connect(ac.destination);
      src.start();
    } catch { /* no audio here */ }
  }

  // ------------------------------------------------------------------------------------------
  // Popovers, confirm, toast

  popover(anchor, content) {
    this.pop.replaceChildren(content);
    this.pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(300, window.innerWidth - 16);
    this.pop.style.width = `${pw}px`;
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
    const ph = this.pop.offsetHeight;
    const below = r.bottom + 8 + ph < window.innerHeight - 8;
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - ph)}px`;
    this.popAnchor = anchor;
  }

  closePop() {
    if (this.pop.hidden) return false;
    this.pop.hidden = true;
    this.pop.replaceChildren();
    this.popAnchor = null;
    return true;
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

  toast(msg, kind = 'info') {
    const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3000);
    setTimeout(() => t.remove(), 3500);
  }

  // ------------------------------------------------------------------------------------------
  // Input: one click handler for everything on the pages, keys

  setupInput() {
    this.stage.addEventListener('click', (e) => {
      const el = e.target.closest('[data-goto], [data-act]');
      if (!el || !this.stage.contains(el)) return;
      if (el.dataset.goto) { e.preventDefault(); this.goto(el.dataset.goto); return; }
      const card = el.closest('.pcard');
      const p = card ? this.index.products.get(card.dataset.product) : null;
      const room = card?.dataset.room;
      switch (el.dataset.act) {
        case 'swatch': this.colors.set(p.id, el.dataset.color || null); this.replaceCard(card); break;
        case 'pick': this.pickClicked(el, p, room); break;
        case 'unpick': this.unpick(el.dataset.key); break;
        case 'see3d': this.seeIn3d(p, this.colorOf(p)); break;
        case 'stock': this.stockClicked(el, p); break;
        case 'add-look': this.addLook(el.dataset.room); break;
        case 'load-package': this.loadPackage(el.dataset.package); break;
        case 'clear-filters': this.filters = C.emptyFilters(); this.applyFilters(); break;
        default: return;
      }
      e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.closeModal()) return; if (this.closePop()) return; this.closeOverlays(); return; }
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!this.modal.hidden || !this.drawer.hidden || !this.filterPanel.hidden) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); this.book.next(); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); this.book.prev(); }
      else if (k === 'Home') { e.preventDefault(); this.book.goToView(0); }
      else if (k === 'End') { e.preventDefault(); this.book.goToView(this.book.viewCount - 1); }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target) && e.target !== this.popAnchor && !this.popAnchor?.contains(e.target)) this.closePop();
    });
  }

  /** Redraw one card (a color, a pick) in place: same size, so the page still fits. */
  replaceCard(card) {
    const p = this.index.products.get(card.dataset.product);
    const entry = this.dynamic.find((d) => d.el === card);
    const next = entry ? entry.render() : this.card(p, card.dataset.room, Number(card.dataset.n));
    card.replaceWith(next);
    if (entry) entry.el = next;
    this.loadNear(this.book.visible());
  }

  pickClicked(btn, p, room) {
    const color = this.colorOf(p);
    const cands = C.candidateKeys(this.index, p, room);
    if (cands.length === 1) { this.setPick(cands[0].key, p, color); return; }
    // more than one place it can go (the cream pair or the rust pair of pillow covers...)
    const occupant = (s) => { const v = this.state.picks[s.key]; return v ? this.index.products.get(v.id) : null; };
    this.popover(btn, h('div', { class: 'pick-menu', role: 'menu' },
      h('p', { class: 'pick-menu-head' }, 'Add as'),
      ...cands.map((s) => { const occ = occupant(s); return h('button', { role: 'menuitem', 'data-key': s.key, 'data-testid': 'pick-option', onclick: () => { this.closePop(); this.setPick(s.key, p, color); } }, h('b', {}, s.label), h('small', {}, occ ? `replaces ${C.cleanName(occ.name)}` : 'empty')); })));
  }

  stockClicked(btn, p) {
    const v = C.view(p, this.colorOf(p));
    this.popover(btn, h('div', { class: 'stock-pop', 'data-testid': 'stock-note' },
      h('p', {}, h('b', {}, v.inStock ? 'In stock' : 'Out of stock'), ` · checked ${C.fmtDate(p.stock_checked_date)}`),
      v.stockNote ? h('p', {}, v.stockNote) : null,
      h('p', { class: 'fineprint' }, `Price checked ${C.fmtDate(p.price_checked_date)}.`),
      p.condition === 'used' && p.backup_search_url ? h('p', {}, h('a', { href: p.backup_search_url, target: '_blank', rel: 'noopener', 'data-testid': 'backup' }, 'Backup search if it sells', icon('ext', 'ico sm'))) : null));
  }
}

/** A fine paper grain, made once on a canvas (no image file), used by the pages and the table. */
function paperGrain() {
  try {
    const n = 128, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const d = g.createImageData(n, n);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 120 + Math.random() * 60;
      d.data[i] = v; d.data[i + 1] = v * 0.92; d.data[i + 2] = v * 0.8; d.data[i + 3] = Math.random() * 16;
    }
    g.putImageData(d, 0, 0);
    document.documentElement.style.setProperty('--noise', `url(${c.toDataURL('image/png')})`);
  } catch { /* no canvas: plain paper */ }
}

const lb = new Book(document.getElementById('lookbook'));
window.__lookbook = lb; // used by the automated tests
lb.start().catch((err) => {
  console.error(err);
  document.getElementById('lookbook').replaceChildren(h('div', { class: 'lb-fatal' }, `The lookbook could not open: ${err.message}`));
});
