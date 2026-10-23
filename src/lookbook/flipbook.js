// A flipbook for HTML pages: two-page spreads with a spine (desktop) or one page at a time (phone).
// A page turn is a sheet rotating around the spine in 3D, with its front and back faces shaded as it
// lifts and lands, and the shadow it casts on the pages underneath. Animations run on the compositor
// (Web Animations API, transforms and opacity only), so they stay smooth on phones.
//
// Pages are plain elements of one fixed size (the book scales to fit its host). In spread mode page 0
// is the front cover (alone, on the right), then [1,2], [3,4]... and the last page (an odd index) is
// the back cover, alone on the left. Turn pages by dragging (finger anywhere, mouse from the outer
// edge), clicking a corner, or calling next() / prev() / goTo().

const EASE = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic: quick lift, soft landing
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEPS = 16; // keyframes per turn (shading follows the angle exactly)

export class Flipbook {
  /**
   * host: the element the book fills. opts: {onChange(view), onTurnStart(), onWillShow(pageIndexes),
   * canDrag(target) -> bool}
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.pages = [];
    this.mode = 'spread';
    this.view = 0;
    this.busy = null; // the running turn
    host.classList.add('fb-host');
    this.book = div('fb-book');
    this.shift = div('fb-shift');
    this.edgeL = div('fb-edge left');
    this.edgeR = div('fb-edge right');
    this.slotL = div('fb-slot left');
    this.slotR = div('fb-slot right');
    this.castL = div('fb-cast left');
    this.castR = div('fb-cast right');
    this.leaf = div('fb-leaf');
    this.front = div('fb-face front');
    this.back = div('fb-face back');
    this.shadeF = div('fb-shade front');
    this.shadeB = div('fb-shade back');
    this.front.append(this.shadeF);
    this.back.append(this.shadeB);
    this.leaf.append(this.front, this.back);
    this.leaf.hidden = true;
    this.corners = ['tl', 'bl', 'tr', 'br'].map((c) => {
      const el = document.createElement('button');
      el.className = `fb-corner ${c}`;
      el.type = 'button';
      el.tabIndex = -1;
      el.setAttribute('aria-hidden', 'true');
      el.dataset.dir = c[1] === 'l' ? '-1' : '1';
      el.addEventListener('click', (e) => { e.stopPropagation(); if (!this.dragged) this.turn(Number(el.dataset.dir)); });
      return el;
    });
    this.shift.append(this.edgeL, this.edgeR, this.slotL, this.slotR, this.castL, this.castR, this.leaf, ...this.corners);
    this.book.append(this.shift);
    host.append(this.book);
    this.setupDrag();
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);
  }

  /** Load pages. mode 'spread' | 'single'; w, h: the page size in CSS px before scaling. */
  setPages(pages, { mode, w, h, at = 0 }) {
    this.finishNow();
    this.pages = pages;
    this.mode = mode;
    this.w = w;
    this.h = h;
    this.book.classList.toggle('spread', mode === 'spread');
    this.book.classList.toggle('single', mode === 'single');
    this.book.style.setProperty('--pw', `${w}px`);
    this.book.style.setProperty('--ph', `${h}px`);
    this.book.style.width = `${mode === 'spread' ? 2 * w : w}px`;
    this.book.style.height = `${h}px`;
    this.view = this.viewOfPage(at);
    this.fit();
    this.render();
  }

  // ------------------------------------------------------------------------------------------
  // Views: which pages are open

  get viewCount() { return this.mode === 'spread' ? Math.floor(this.pages.length / 2) + 1 : this.pages.length; }

  /** [left, right] page indexes of a view (null = no page there). Single mode: [null, page]. */
  pagesOf(v) {
    if (this.mode === 'single') return [null, v];
    const n = this.pages.length;
    if (v <= 0) return [null, 0];
    const l = 2 * v - 1;
    return [l < n ? l : null, l + 1 < n ? l + 1 : null];
  }

  viewOfPage(i) {
    i = clamp(i | 0, 0, Math.max(0, this.pages.length - 1));
    return this.mode === 'spread' ? Math.floor((i + 1) / 2) : i;
  }

  /** The pages showing now (1 or 2 indexes). */
  visible() { return this.pagesOf(this.view).filter((x) => x !== null); }

  get closed() {
    if (this.mode !== 'spread') return null;
    if (this.view === 0) return 'front';
    if (this.view === this.viewCount - 1 && this.pages.length % 2 === 0) return 'back';
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // Layout

  fit() {
    if (!this.w) return;
    const r = this.host.getBoundingClientRect();
    const bw = this.mode === 'spread' ? 2 * this.w : this.w;
    this.scale = Math.max(0.2, Math.min(r.width / bw, r.height / this.h));
    this.book.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
  }

  shiftOf(v) {
    if (this.mode !== 'spread') return 0;
    if (v <= 0) return -this.w / 2; // closed: the cover sits in the middle
    const [l, r] = this.pagesOf(v);
    if (r === null && l !== null) return this.w / 2;
    return 0;
  }

  place(slot, i) {
    const p = i === null || i === undefined ? null : this.pages[i];
    if (p) {
      if (slot.firstChild !== p || slot.childNodes.length !== 1) slot.replaceChildren(p);
    } else slot.replaceChildren();
    slot.classList.toggle('empty', !p);
    slot.classList.toggle('hard', !!p?.classList.contains('hard'));
  }

  render() {
    const [l, r] = this.pagesOf(this.view);
    this.place(this.slotL, l);
    this.place(this.slotR, r);
    this.leaf.hidden = true;
    this.castL.style.opacity = this.castR.style.opacity = '0';
    this.shift.style.transform = `translateX(${this.shiftOf(this.view)}px)`;
    this.book.dataset.closed = this.closed || '';
    this.updateEdges(this.view);
    this.updateCorners();
    this.opts.onWillShow?.(this.visible());
    this.opts.onChange?.(this.view);
  }

  updateEdges(v) {
    // the page block: thicker on the side with more pages
    const n = Math.max(1, this.pages.length);
    const [l, r] = this.pagesOf(v);
    const before = l ?? (r ?? 0) - 1, after = n - 1 - (r ?? l ?? 0);
    const px = (k) => (k > 0 ? Math.round(2 + (Math.min(k, n) / n) * 8) : 0);
    this.edgeL.style.width = `${this.mode === 'spread' && l !== null ? px(before) : 0}px`;
    this.edgeR.style.width = `${r !== null ? px(after) : 0}px`;
  }

  updateCorners() {
    const [l, r] = this.pagesOf(this.view);
    const canPrev = this.view > 0, canNext = this.view < this.viewCount - 1;
    for (const c of this.corners) {
      const left = c.classList.contains('tl') || c.classList.contains('bl');
      const show = this.mode === 'spread' ? (left ? canPrev && l !== null : canNext && r !== null) : (left ? canPrev : canNext);
      c.hidden = !show;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Turning

  next() { return this.turn(1); }
  prev() { return this.turn(-1); }
  turn(dir) { return this.goToView(this.view + dir); }
  goTo(pageIndex, { animate = true } = {}) { return this.goToView(this.viewOfPage(pageIndex), { animate }); }

  goToView(v, { animate = true } = {}) {
    v = clamp(v, 0, this.viewCount - 1);
    this.finishNow();
    if (v === this.view) return Promise.resolve(false);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.view = v;
      this.render();
      return Promise.resolve(true);
    }
    this.prepare(v);
    return this.animateTo(v > this.view ? -180 : 0, this.duration());
  }

  duration() { return this.mode === 'spread' ? 760 : 560; }

  /** Set up the sheet for a turn from the current view to view `to` (angle 0 = lying on the right). */
  prepare(to) {
    const from = this.view;
    const fwd = to > from;
    const [l0, r0] = this.pagesOf(from), [l1, r1] = this.pagesOf(to);
    let front, back, under;
    if (this.mode === 'spread') {
      if (fwd) { front = r0; back = l1; this.place(this.slotL, l0); this.place(this.slotR, r1); }
      else { front = r1; back = l0; this.place(this.slotL, l1); this.place(this.slotR, r0); }
    } else {
      // one page: the sheet is the page being left (forward) or the page coming back (backward)
      front = fwd ? r0 : r1;
      back = null;
      under = fwd ? r1 : r0;
      this.place(this.slotR, under);
    }
    this.front.replaceChildren(this.pages[front] || blank(), this.shadeF);
    this.back.replaceChildren(back !== null && back !== undefined ? this.pages[back] : blank(), this.shadeB);
    this.front.classList.toggle('hard', !!this.pages[front]?.classList.contains('hard'));
    this.back.classList.toggle('hard', !!this.pages[back]?.classList.contains('hard'));
    this.leaf.hidden = false;
    this.turnFrom = from;
    this.turnTo = to;
    this.angle = fwd ? 0 : -180;
    this.shiftFrom = this.shiftOf(from);
    this.shiftTo = this.shiftOf(to);
    this.updateEdges(fwd ? to : from);
    this.opts.onWillShow?.([l1, r1].filter((x) => x !== null));
    this.opts.onTurnStart?.();
    this.apply(this.angle);
  }

  /** Draw the sheet at an angle (0 .. -180), with its shading and the shadows it casts. */
  frame(a) {
    const t = -a / 180; // 0 = on the right, 1 = on the left
    const lift = Math.sin(t * Math.PI); // 0 flat .. 1 standing up
    const shift = this.shiftFrom + (this.shiftTo - this.shiftFrom) * (this.turnTo > this.turnFrom ? t : 1 - t);
    return {
      leaf: `rotateY(${a.toFixed(2)}deg)`,
      shift: `translateX(${shift.toFixed(1)}px)`,
      shadeF: (clamp(t * 2, 0, 1) * 0.5).toFixed(3),
      shadeB: (clamp((1 - t) * 2, 0, 1) * 0.45).toFixed(3),
      castR: (t < 0.5 ? lift * 0.55 : 0).toFixed(3),
      castL: (t > 0.5 ? lift * 0.55 : 0).toFixed(3),
    };
  }

  apply(a) {
    this.angle = a;
    const f = this.frame(a);
    this.leaf.style.transform = f.leaf;
    this.shift.style.transform = f.shift;
    this.shadeF.style.opacity = f.shadeF;
    this.shadeB.style.opacity = f.shadeB;
    this.castR.style.opacity = f.castR;
    this.castL.style.opacity = f.castL;
  }

  /** Animate the sheet from its angle to `target` (-180 = turned, 0 = back where it was). */
  animateTo(target, ms) {
    const a0 = this.angle;
    const frames = [];
    for (let i = 0; i <= STEPS; i++) frames.push(this.frame(a0 + (target - a0) * EASE(i / STEPS)));
    const opt = { duration: ms, easing: 'linear', fill: 'forwards' };
    const anims = [
      this.leaf.animate(frames.map((f) => ({ transform: f.leaf })), opt),
      this.shift.animate(frames.map((f) => ({ transform: f.shift })), opt),
      this.shadeF.animate(frames.map((f) => ({ opacity: f.shadeF })), opt),
      this.shadeB.animate(frames.map((f) => ({ opacity: f.shadeB })), opt),
      this.castR.animate(frames.map((f) => ({ opacity: f.castR })), opt),
      this.castL.animate(frames.map((f) => ({ opacity: f.castL })), opt),
    ];
    const fwd = this.turnTo > this.turnFrom;
    const done = (target === -180) === fwd; // reached the new view (else it fell back)
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    const finish = () => {
      if (this.busy !== run) return;
      this.busy = null;
      for (const an of anims) an.cancel();
      this.view = done ? this.turnTo : this.turnFrom;
      this.render();
      resolve(done);
    };
    const run = { finish };
    this.busy = run;
    anims[0].finished.then(finish, () => {});
    return p;
  }

  /** Jump a running turn to its end. */
  finishNow() {
    if (this.busy) this.busy.finish();
    else if (!this.leaf.hidden && this.dragging) { this.dragging = null; this.view = this.turnFrom; this.render(); }
  }

  // ------------------------------------------------------------------------------------------
  // Dragging: a finger anywhere on a page, a mouse from the outer edge or a corner

  setupDrag() {
    const host = this.host;
    let start = null;
    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.pages.length) return;
      const corner = e.target.closest?.('.fb-corner');
      if (!corner && this.opts.canDrag && !this.opts.canDrag(e.target)) return;
      const box = this.shift.getBoundingClientRect();
      const x = (e.clientX - box.left) / this.scale, y = (e.clientY - box.top) / this.scale;
      const bw = this.mode === 'spread' ? 2 * this.w : this.w;
      if (x < 0 || x > bw || y < 0 || y > this.h) return;
      if (e.pointerType === 'mouse' && !corner) {
        const edge = 70; // mouse drags start near the outer edges (text and buttons stay clickable)
        if (!(x < edge || x > bw - edge)) return;
      }
      this.finishNow();
      this.dragged = false;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, px: x, t: performance.now(), corner, type: e.pointerType };
    });
    host.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!this.dragging) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          if (Math.abs(dy) > 24) start = null; // a vertical gesture: leave it
          return;
        }
        const dir = dx < 0 ? 1 : -1;
        const to = this.view + dir;
        if (to < 0 || to > this.viewCount - 1) { start = null; return; }
        this.dragging = { dir, x0: start.x };
        this.dragged = true;
        try { host.setPointerCapture(e.pointerId); } catch { /* the pointer may be gone */ }
        this.prepare(to);
      }
      e.preventDefault();
      this.apply(this.dragAngle(e.clientX));
      this.lastMove = { x: e.clientX, t: performance.now(), vx: (e.clientX - (this.lastMove?.x ?? e.clientX)) / Math.max(1, performance.now() - (this.lastMove?.t ?? 0)) };
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      const d = this.dragging;
      this.dragging = null;
      if (!d) return;
      const fwd = d.dir > 0;
      const vx = this.lastMove?.vx || 0;
      this.lastMove = null;
      const progress = fwd ? -this.angle / 180 : 1 + this.angle / 180;
      const fling = fwd ? vx < -0.45 : vx > 0.45;
      const complete = e.type !== 'pointercancel' && (progress > 0.33 || fling);
      const target = complete === fwd ? -180 : 0;
      const left = Math.abs(target - this.angle) / 180;
      this.animateTo(target, Math.max(220, this.duration() * left * 0.9));
      // the click that follows a drag must not press a button
      setTimeout(() => { this.dragged = false; }, 60);
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('click', (e) => { if (this.dragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

  dragAngle(clientX) {
    const box = this.host.getBoundingClientRect();
    if (this.mode === 'spread') {
      // the sheet's edge follows the pointer: x measured from the spine, in page widths
      const spine = this.shift.getBoundingClientRect().left + this.w * this.scale;
      const x = (clientX - spine) / (this.w * this.scale);
      return -Math.acos(clamp(x, -1, 1)) * 180 / Math.PI;
    }
    // one page: the drag distance across the screen turns the page
    const dx = clientX - this.dragging.x0;
    const span = Math.max(160, box.width * 0.8);
    const p = clamp(this.dragging.dir > 0 ? -dx / span : 1 - dx / span, 0, 1);
    return -180 * p;
  }

  destroy() {
    this.ro.disconnect();
    this.host.replaceChildren();
  }
}

function div(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

function blank() {
  const el = div('page page-blank');
  el.setAttribute('aria-hidden', 'true');
  return el;
}
