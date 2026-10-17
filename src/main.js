import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './styles.css';
import { loadCatalog } from './core/catalog.js';
import { defaultLayout, moveToward, rotateItem, swapOption, resetItemPose, setExistingHidden, buildItems, effDims, itemBoxes } from './core/items.js';
import { wallCoords } from './core/catalog.js';
import { computeBudget } from './core/budget.js';
import { computeWarnings } from './core/fit.js';
import * as store from './core/layouts.js';
import { RoomScene } from './scene/roomScene.js';
import { PRESETS, overview, topView } from './scene/views.js';
import { roomToWorld, worldToRoom } from './units.js';
import { setMaxAnisotropy } from './scene/materials.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;

class App {
  constructor() {
    this.errors = [];
    this.quality = coarse
      ? { pixelRatio: Math.min(devicePixelRatio, 1.75), shadowMap: 1024, antialias: true }
      : { pixelRatio: Math.min(devicePixelRatio, 2), shadowMap: 2048, antialias: true };
    if (params.has('low')) Object.assign(this.quality, { pixelRatio: 1, shadowMap: 1024 });
    if (params.has('clean')) document.body.classList.add('clean');
    this.mode = 'day';
    this.curtainsClosed = false;
    this.closetDoors = true;
    this.selected = null;
    this.rooms = new Map();
    this.roomId = null;
    this.needsRender = true;
    this.needsShadow = true;
    this.listeners = new Set();
  }

  async start() {
    this.canvas = document.getElementById('scene');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' }));
    r.setPixelRatio(this.quality.pixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // the scene is static: shadows are re-rendered only when something changes
    setMaxAnisotropy(r.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e9e6e1');
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.controls = null; // created after our own pointer handlers so they run first

    this.cat = await loadCatalog(`${import.meta.env.BASE_URL}data/`);
    if (this.cat.problems.length) this.reportError(`products.json / room-spec.json problems:\n${this.cat.problems.join('\n')}`);

    const saved = store.loadCurrent(this.cat);
    this.layout = saved?.layout || defaultLayout(this.cat);
    this.layoutName = saved?.name || "Designer's layout";

    this.setupInteraction();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 22;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.invalidate());

    this.ui = new UI(this);
    new ResizeObserver(() => this.refreshProjection()).observe(this.ui.panel);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    await this.setRoom(params.get('room') === 'bedroom' ? 'bedroom' : 'living');
    const view = params.get('view');
    if (view) this.applyPreset(view, false);
    this.loop();
    document.body.classList.add('ready');
    // the loading screen fades out (CSS); remove it afterwards even if a busy phone stalls the fade
    setTimeout(() => document.getElementById('loading')?.remove(), 700);
  }

  // ------------------------------------------------------------------------------------------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) fn(what); }

  reportError(msg) {
    this.errors.push(msg);
    this.ui?.toast(msg, 'error');
  }

  invalidate(sceneChanged = false) {
    this.needsRender = true;
    if (sceneChanged) this.needsShadow = true;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.refreshProjection();
  }

  /** On phones the top bar and the item card cover part of the screen: the view's center moves into
   *  the part that stays visible, at the same scale, so a selected piece is not hidden under them. */
  refreshProjection() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const phone = matchMedia('(max-width: 720px)').matches && !document.body.classList.contains('clean');
    const panel = this.ui?.panel;
    const bottom = phone && panel && !panel.hidden ? Math.min(panel.getBoundingClientRect().height, h * 0.6) : 0;
    const bar = phone ? this.ui?.root.querySelector('.topbar') : null;
    const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom - this.canvas.getBoundingClientRect().top) : 0;
    const shift = (bottom - top) / 2; // > 0 moves the center up
    this.viewGrow = h > 0 ? (h + 2 * Math.abs(shift)) / h : 1;
    if (Math.abs(shift) > 0.5) this.camera.setViewOffset(w, h + 2 * Math.abs(shift), 0, shift > 0 ? 2 * shift : 0, w, h);
    else { this.camera.clearViewOffset(); this.viewGrow = 1; }
    this.applyFov();
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  /** Presets keep the photo's view: on narrow (portrait) screens the field of view widens to fit it, up to a limit. */
  applyFov() {
    const vfov = this.viewVfov || 50;
    const photoAspect = 4 / 3;
    let fov = vfov;
    if (this.camera.aspect < photoAspect && this.viewVfov) {
      const hHalf = Math.atan(Math.tan((vfov * Math.PI) / 360) * photoAspect);
      fov = (2 * Math.atan(Math.tan(hHalf) / this.camera.aspect) * 180) / Math.PI;
      fov = Math.min(fov, 105);
    }
    // with the view shifted above a phone's item card, the field of view covers the taller full view
    if (this.viewGrow > 1) fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * this.viewGrow) * 180) / Math.PI;
    this.camera.fov = fov;
  }

  get room() { return this.rooms.get(this.roomId); }

  async setRoom(id) {
    if (this.roomId === id) return;
    this.select(null);
    if (this.room) this.room.detach(this.scene);
    let rs = this.rooms.get(id);
    const first = !rs;
    if (!rs) { rs = new RoomScene(this, id); this.rooms.set(id, rs); }
    this.roomId = id;
    rs.attach(this.scene);
    rs.setMode(this.mode);
    rs.setCurtainsClosed(this.curtainsClosed, false);
    rs.setClosetDoorsVisible(this.closetDoors);
    this.loading = rs.sync(this.layout);
    if (first) this.setView(overview(rs.room, this.camera.aspect), false);
    this.emit('room');
    this.refresh();
    await this.loading;
    this.invalidate(true);
    this.emit('loaded');
  }

  // ------------------------------------------------------------------------------------------
  setView(v, animate = true) {
    this.viewVfov = v.vfov;
    this.applyFov();
    const pos = roomToWorld(v.pos), target = roomToWorld(v.target);
    // orbiting stays above the horizon, except where a photo's camera looks slightly upward
    const up = Math.acos(Math.max(-1, Math.min(1, (pos.y - target.y) / pos.distanceTo(target))));
    this.controls.maxPolarAngle = Math.max(Math.PI * 0.495, up + 0.01);
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.invalidate();
      return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const start = performance.now();
    this.tween = (now) => {
      const k = Math.min(1, (now - start) / 650);
      const e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      this.camera.updateProjectionMatrix();
      if (k >= 1) this.tween = null;
    };
    this.invalidate();
  }

  applyPreset(id, animate = true) {
    if (id === 'overview') return this.setView(overview(this.room.room, this.camera.aspect), animate);
    if (id === 'top') return this.setView(topView(this.room.room), animate);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    if (p.room !== this.roomId) { this.setRoom(p.room).then(() => this.setView(p, false)); return; }
    this.setView(p, animate);
    this.currentPreset = id;
    this.emit('view');
  }

  setMode(mode) {
    this.mode = mode;
    // night closes curtains (room-spec lighting: "blinds and curtains closed"); day opens them
    this.curtainsClosed = mode === 'night';
    for (const rs of this.rooms.values()) { rs.setMode(mode); rs.setCurtainsClosed(this.curtainsClosed); }
    this.scene.background.set(mode === 'day' ? '#e9e6e1' : '#1b1d22');
    this.invalidate(true);
    this.emit('mode');
  }

  setCurtains(closed) {
    this.curtainsClosed = closed;
    for (const rs of this.rooms.values()) rs.setCurtainsClosed(closed);
    this.emit('mode');
  }

  setClosetDoors(v) {
    this.closetDoors = v;
    for (const rs of this.rooms.values()) rs.setClosetDoorsVisible(v);
    this.emit('mode');
  }

  // ------------------------------------------------------------------------------------------
  // Layout state
  get items() { return this.room?.items || []; }
  item(key) { return this.items.find((i) => i.key === key) || null; }
  get budget() { return computeBudget(this.cat, this.layout); }
  get warnings() { return computeWarnings(this.cat, this.roomId, this.items); }
  allWarnings() {
    const out = [];
    for (const id of this.cat.rooms.keys()) out.push(...computeWarnings(this.cat, id, buildItems(this.cat, this.layout, id)).map((w) => ({ ...w, room: id })));
    return out;
  }

  /** Re-sync all built rooms with the layout and persist it. */
  commit(opts = {}) {
    for (const rs of this.rooms.values()) if (rs !== this.room || !opts.skipCurrent) rs.sync(this.layout);
    store.saveCurrent(this.layoutName, this.layout);
    this.refresh();
  }

  refresh() {
    const w = this.warnings;
    this.room?.setSelection(this.selected, w);
    this.emit('layout');
  }

  select(key) {
    this.selected = key;
    // an item stored in the closet is shown by sliding the closet doors out of the way while it's selected
    if (this.room) this.room.setClosetDoorsVisible(this.closetDoors && !(key && this.isInCloset(key)));
    this.room?.setSelection(key, this.warnings);
    this.emit('select');
  }

  isInCloset(key) {
    const it = this.item(key);
    const r = this.room?.room;
    if (!it || !r?.extraRegions.length) return false;
    return r.extraRegions.some((poly) => {
      const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
      return it.pose.x > Math.min(...xs) && it.pose.x < Math.max(...xs) && it.pose.y > Math.min(...ys) && it.pose.y < Math.max(...ys);
    });
  }

  rotateSelected(step) {
    const it = this.item(this.selected);
    if (!it) return { ok: false };
    const r = rotateItem(this.room.room, this.layout, this.items, it, step);
    if (!r.ok) this.ui.toast(r.reason === 'furniture' ? `No room to turn it here: it would hit ${r.blockers.map((b) => b.name.split(/[,(]/)[0]).join(', ')}` : 'No room to turn it here (it would go through a wall).', 'warn');
    this.afterEdit();
    return r;
  }

  removeSelected() {
    const it = this.item(this.selected);
    if (!it) return;
    if (it.kind === 'product') swapOption(this.cat, this.layout, it.id, null);
    else setExistingHidden(this.layout, it.id, true);
    this.select(null);
    this.commit();
  }

  restore(slotOrExistingId, productId) {
    if (this.cat.slots.has(slotOrExistingId)) swapOption(this.cat, this.layout, slotOrExistingId, productId ?? this.cat.slots.get(slotOrExistingId).default_option);
    else setExistingHidden(this.layout, slotOrExistingId, false);
    this.commit();
  }

  swap(slotId, productId) {
    const keepSel = this.selected?.split('#');
    const r = swapOption(this.cat, this.layout, slotId, productId);
    this.commit();
    if (keepSel && keepSel[0] === slotId) this.select(`${slotId}#${keepSel[1]}`);
    if (r.adjusted?.length) this.ui.toast('Moved it slightly so it fits inside the walls.', 'info');
    return r;
  }

  resetSelectedPosition() {
    const it = this.item(this.selected);
    if (!it) return;
    resetItemPose(this.cat, this.layout, this.items, it);
    this.afterEdit();
  }

  afterEdit() {
    for (const o of this.room.objects.values()) this.room.place(o);
    this.room.updateLights();
    this.room.applyCurtains();
    store.saveCurrent(this.layoutName, this.layout);
    // other built rooms are unaffected by moves in this room
    this.refresh();
    this.invalidate(true);
  }

  loadLayout(layout, name) {
    this.layout = structuredClone(layout);
    this.layoutName = name;
    this.select(null);
    this.commit();
  }

  resetToDesigner() {
    this.loadLayout(defaultLayout(this.cat), "Designer's layout");
  }

  // ------------------------------------------------------------------------------------------
  // Pointer interaction: tap selects; dragging the selected item moves it on its floor/wall/top.
  setupInteraction() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = this.canvas;
    let down = null;
    let drag = null;
    const pointers = new Map();

    const setNdc = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
    };
    const pick = (e) => {
      setNdc(e);
      if (!this.room) return null;
      const hits = ray.intersectObjects([this.room.itemsGroup, this.room.rb.root], true);
      let surface = Infinity;
      for (const h of hits) {
        if (!isVisible(h.object)) continue;
        if (h.object.name === 'glass' || h.object.name === 'backdrop' || h.object.isLine || h.object.isLineSegments) continue;
        let o = h.object;
        while (o && !o.userData.itemKey) o = o.parent;
        if (o) return o.userData.itemKey; // first visible surface wins (walls block items behind them)
        surface = h.distance / this.room.root.matrixWorld.getMaxScaleOnAxis();
        break;
      }
      // Thin or open pieces (a tripod lamp, a plant, a cord raceway) are hard to hit exactly, on a
      // phone especially: a tap that reaches a wall or the floor also counts when it passes through an
      // item's box (at least 3" thick) before getting there.
      return boxPick(roomRay(), surface);
    };
    const boxPick = ({ o, d }, maxT) => {
      let best = null;
      for (const it of this.items) {
        if (it.hidden || it.isRug) continue;
        const obj = this.room.objects.get(it.key);
        if (!obj || !isVisible(obj.group)) continue;
        for (const b of itemBoxes(it)) {
          const t = rayBox(o, d, b, 1.5);
          if (t !== null && t < maxT && (!best || t < best.t)) best = { t, key: it.key };
        }
      }
      return best ? best.key : null;
    };
    const roomRay = () => {
      const inv = new THREE.Matrix4().copy(this.room.root.matrixWorld).invert();
      const o = ray.ray.origin.clone().applyMatrix4(inv);
      const d = ray.ray.direction.clone().transformDirection(inv);
      return { o, d };
    };
    /** Where the pointer ray meets the plane the item moves on (room coords). */
    const planeHit = (it, e) => {
      setNdc(e);
      const { o, d } = roomRay();
      if (it.mount === 'wall') {
        const wall = this.room.room.walls.get(it.wallId);
        const n = { x: wall.normal.x, y: wall.normal.y };
        const off = wallCoords(wall, it.pose.x, it.pose.y).off;
        const p0 = { x: wall.from.x + n.x * off, y: wall.from.y + n.y * off };
        const den = d.x * n.x + d.y * n.y;
        if (Math.abs(den) < 1e-6) return null;
        const t = ((p0.x - o.x) * n.x + (p0.y - o.y) * n.y) / den;
        if (t < 0) return null;
        const hp = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
        return { along: wallCoords(wall, hp.x, hp.y).along, z: hp.z };
      }
      const z = it.mount === 'top' ? it.baseZ : 0;
      if (Math.abs(d.z) < 1e-6) return null;
      const t = (z - o.z) / d.z;
      if (t < 0) return null;
      return { x: o.x + d.x * t, y: o.y + d.y * t };
    };

    /** What a click at (clientX, clientY) would select; used by the tests to find a visible spot. */
    this.pickAt = (clientX, clientY) => pick({ clientX, clientY });

    el.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, e);
      if (pointers.size > 1) { if (drag) endDrag(); down = null; return; }
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (!this.selected) return;
      const key = pick(e);
      const it = this.item(this.selected);
      if (key && key === this.selected && it && it.mount !== 'hidden') {
        const hp = planeHit(it, e);
        if (!hp) return;
        const wall = it.mount === 'wall' ? this.room.room.walls.get(it.wallId) : null;
        const start = wall ? { along: wallCoords(wall, it.pose.x, it.pose.y).along, z: it.pose.z } : { x: it.pose.x, y: it.pose.y };
        drag = { id: e.pointerId, key, grab: wall ? { a: hp.along - start.along, b: hp.z - start.z } : { a: hp.x - start.x, b: hp.y - start.y }, moved: false };
        el.setPointerCapture(e.pointerId);
        e.stopImmediatePropagation();
        el.classList.add('dragging');
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
      if (!drag || e.pointerId !== drag.id) {
        if (!drag && e.pointerType === 'mouse' && !e.buttons) this.hoverAt(pick(e));
        return;
      }
      e.stopImmediatePropagation();
      const it = this.item(drag.key);
      const hp = planeHit(it, e);
      if (!hp) return;
      const target = it.mount === 'wall' ? { along: hp.along - drag.grab.a, z: hp.z - drag.grab.b } : { x: hp.x - drag.grab.a, y: hp.y - drag.grab.b };
      const r = moveToward(this.room.room, this.layout, this.items, it, target);
      drag.moved = drag.moved || r.moved;
      drag.blocked = r.blocked;
      for (const o of this.room.objects.values()) this.room.place(o);
      this.room.updateLights();
      this.room.applyCurtains();
      this.room.setSelection(this.selected, this.warnings);
      this.emit('drag');
      this.invalidate(true);
    });
    const endDrag = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      el.classList.remove('dragging');
      try { el.releasePointerCapture(d.id); } catch { /* already released */ }
      if (d.blocked?.reason === 'furniture') this.ui.toast(`Blocked by ${d.blocked.blockers.map((b) => b.name.split(/[,(]/)[0]).join(', ')}`, 'info');
      else if (d.blocked && d.blocked.reason !== 'support') this.ui.toast('It stops at the wall.', 'info');
      else if (d.blocked?.reason === 'support') this.ui.toast('It stays on the piece it rests on.', 'info');
      this.afterEdit();
    };
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (drag && e.pointerId === drag.id) { e.stopImmediatePropagation(); endDrag(); down = null; return; }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7 && performance.now() - down.t < 500) {
        const key = pick(e);
        this.select(key && key !== this.selected ? key : key === this.selected ? key : null);
      }
      down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); if (drag) endDrag(); down = null; });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') this.select(null);
      if (!this.selected) return;
      if (e.key === 'r' || e.key === 'R') this.rotateSelected(e.shiftKey ? -15 : 15);
      if (e.key === 'Delete' || e.key === 'Backspace') this.removeSelected();
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key]) { e.preventDefault(); this.nudgeSelected(...arrows[e.key]); }
    });
  }

  /** Move the selected item by screen-relative arrow keys (1" steps, 6" with Shift). */
  nudgeSelected(dx, dy, step = 1) {
    const it = this.item(this.selected);
    if (!it || it.mount === 'hidden') return null;
    let r;
    if (it.mount === 'wall') {
      const wall = this.room.room.walls.get(it.wallId);
      const a = wallCoords(wall, it.pose.x, it.pose.y).along;
      // screen-left/right maps to along-wall direction as seen from inside the room
      const camR = worldToRoom(this.camera.position);
      const sideSign = Math.sign((camR.x - it.pose.x) * wall.normal.x + (camR.y - it.pose.y) * wall.normal.y) || 1;
      const s = Math.sign(wall.dir.x * -wall.normal.y + wall.dir.y * wall.normal.x) * sideSign;
      r = moveToward(this.room.room, this.layout, this.items, it, { along: a + dx * step * (s || 1), z: it.pose.z - dy * step });
    } else {
      const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
      const fr = { x: f.x, y: -f.z };
      const len = Math.hypot(fr.x, fr.y) || 1;
      const fwd = { x: fr.x / len, y: fr.y / len };
      // in room coords (z up) screen-right is the view direction turned 90 degrees clockwise
      const rx = fwd.y, ry = -fwd.x;
      r = moveToward(this.room.room, this.layout, this.items, it, { x: it.pose.x + (dx * rx - dy * fwd.x) * step, y: it.pose.y + (dx * ry - dy * fwd.y) * step });
    }
    this.afterEdit();
    return r;
  }

  /** Programmatic move (used by the item panel's arrow pad and by tests). */
  moveSelectedTo(target) {
    const it = this.item(this.selected);
    if (!it) return null;
    const r = moveToward(this.room.room, this.layout, this.items, it, target);
    this.afterEdit();
    return r;
  }

  hoverAt(key) {
    if (this.hoverKey === key) return;
    this.hoverKey = key;
    this.canvas.style.cursor = key ? (key === this.selected ? 'grab' : 'pointer') : '';
  }

  /** Screen position (CSS px) of an item's center: for tests and for focusing. */
  screenOf(key) {
    const it = this.item(key);
    if (!it) return null;
    const h = it.mount === 'wall' ? effDims(it).h / 2 : Math.min(it.dims.h, 30) / 2;
    return this.screenOfPoint({ x: it.pose.x, y: it.pose.y, z: (it.baseZ ?? 0) + h });
  }

  /** A screen spot (CSS px) where a click selects `key`, nearest the item's center; null if the item
   *  is fully hidden from this camera. Used by the tests to click items the way a person would. */
  visiblePointOf(key) {
    const it = this.item(key);
    if (!it) return null;
    const pts = [];
    for (const b of itemBoxes(it)) {
      const c = [b.o.cx, b.o.cy], u = b.o.ux, v = b.o.uy;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [b.z0, b.z1]) pts.push(this.screenOfPoint({ x: c[0] + u[0] * b.o.hw * sx + v[0] * b.o.hd * sy, y: c[1] + u[1] * b.o.hw * sx + v[1] * b.o.hd * sy, z }));
    }
    const r = this.canvas.getBoundingClientRect();
    const x0 = Math.max(r.left + 2, Math.min(...pts.map((p) => p.x))), x1 = Math.min(r.right - 2, Math.max(...pts.map((p) => p.x)));
    const y0 = Math.max(r.top + 2, Math.min(...pts.map((p) => p.y))), y1 = Math.min(r.bottom - 2, Math.max(...pts.map((p) => p.y)));
    const c = this.screenOf(key);
    const cands = [];
    const n = 16;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) cands.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * j) / n });
    cands.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    const ui = (p) => { const el = document.elementFromPoint(p.x, p.y); return el && el !== this.canvas; };
    return cands.find((p) => !ui(p) && this.pickAt(p.x, p.y) === key) || null;
  }

  /** Screen position (CSS px) of a point given in room inches. */
  screenOfPoint(pt) {
    this.camera.updateMatrixWorld();
    const p = roomToWorld(pt).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 };
  }

  /** Point the camera at an item (used by the items list). */
  focus(key) {
    const it = this.item(key);
    if (!it) return;
    const ed = effDims(it);
    const c = { x: it.pose.x, y: it.pose.y, z: (it.baseZ ?? 0) + ed.h / 2 };
    const r = this.room.room;
    let from;
    if (it.mount === 'wall') {
      const wall = r.walls.get(it.wallId);
      const dist = Math.max(60, ed.w * 1.4);
      from = { x: c.x + wall.normal.x * dist, y: c.y + wall.normal.y * dist, z: c.z + 6 };
    } else {
      const b = r.bounds;
      const toC = { x: (b.x0 + b.x1) / 2 - c.x, y: (b.y0 + b.y1) / 2 - c.y };
      const l = Math.hypot(toC.x, toC.y) || 1;
      const dist = Math.max(55, Math.max(ed.w, ed.d) * 1.6);
      from = { x: c.x + (toC.x / l) * dist, y: c.y + (toC.y / l) * dist, z: Math.max(c.z + 50, 70) };
    }
    this.setView({ pos: from, target: c, vfov: 50 });
  }

  // ------------------------------------------------------------------------------------------
  loop() {
    let last = performance.now();
    const frames = [];
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.tween) { this.tween(now); this.needsRender = true; }
      if (this.controls.update()) this.needsRender = true;
      if (this.room?.stepAnimations(dt)) { this.needsRender = true; this.needsShadow = true; }
      if (this.forceRender) this.needsRender = true;
      if (!this.needsRender) return;
      this.needsRender = false;
      this.room?.updateCutaway(this.camera);
      // the walls' shadow-only copies are drawn only on frames that refresh the shadow map
      const casters = this.room?.rb.shadowCasters;
      if (casters) casters.visible = this.needsShadow;
      if (this.needsShadow) { this.renderer.shadowMap.needsUpdate = true; this.needsShadow = false; }
      const t0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      frames.push({ now, cost: performance.now() - t0 });
      while (frames.length && now - frames[0].now > 1500) frames.shift();
      this.adapt(frames, now);
      this.frameCount = (this.frameCount || 0) + 1;
    };
    requestAnimationFrame(tick);
  }

  /** If the device can't hold ~30 fps while moving the camera, lower the resolution step by step. */
  adapt(frames, now) {
    if (frames.length < 20 || now - (this.lastAdapt || 0) < 2000) return;
    const span = (frames.at(-1).now - frames[0].now) / 1000;
    const fps = (frames.length - 1) / span;
    if (fps < 28 && this.renderer.getPixelRatio() > 1) {
      this.lastAdapt = now;
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() - 0.25));
      this.resize();
    }
  }

  /** Resolves when every model in the current room has finished loading (used by the tests). */
  async whenLoaded() {
    await this.loading;
    await Promise.all([...this.room.objects.values()].map((o) => o.ready).filter(Boolean));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  /** Size in inches of an item's drawn model in its own frame (w along x, d along y, h up). */
  modelSize(key) {
    const o = this.room?.objects.get(key);
    if (!o?.model) return null;
    o.group.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(o.group.matrixWorld).invert();
    const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4();
    o.model.traverse((x) => {
      if (!x.isMesh || !visibleWithin(x, o.model) || x.userData.glowShell || inSetPiece(x, o.model)) return;
      if (x.isInstancedMesh) { x.computeBoundingBox(); part.copy(x.boundingBox); } else { if (!x.geometry.boundingBox) x.geometry.computeBoundingBox(); part.copy(x.geometry.boundingBox); }
      box.union(part.applyMatrix4(m.multiplyMatrices(inv, x.matrixWorld)));
    });
    if (box.isEmpty()) return null;
    const s = box.getSize(new THREE.Vector3());
    return { w: s.x, d: s.y, h: s.z, z0: box.min.z };
  }

  /** Render continuously for `ms` while the camera orbits; returns frames per second. */
  async measureFps(ms = 3000) {
    this.forceRender = true;
    const start = performance.now();
    const f0 = this.frameCount || 0;
    const spin = setInterval(() => { this.controls.autoRotate = true; this.controls.autoRotateSpeed = 8; }, 50);
    await new Promise((r) => setTimeout(r, ms));
    clearInterval(spin);
    this.controls.autoRotate = false;
    this.forceRender = false;
    return ((this.frameCount || 0) - f0) / ((performance.now() - start) / 1000);
  }
}

/** Ray (room inches) against an item box {o: 2D OBB, z0, z1}, each half-size at least `minHalf`;
 *  returns the entry distance or null. */
function rayBox(o, d, b, minHalf) {
  const { cx, cy, ux, uy } = b.o;
  const hw = Math.max(b.o.hw, minHalf), hd = Math.max(b.o.hd, minHalf);
  const zc = (b.z0 + b.z1) / 2, hz = Math.max((b.z1 - b.z0) / 2, minHalf);
  const rel = [o.x - cx, o.y - cy, o.z - zc];
  const oo = [rel[0] * ux[0] + rel[1] * ux[1], rel[0] * uy[0] + rel[1] * uy[1], rel[2]];
  const dd = [d.x * ux[0] + d.y * ux[1], d.x * uy[0] + d.y * uy[1], d.z];
  const half = [hw, hd, hz];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (Math.abs(oo[i]) > half[i]) return null; continue; }
    let a = (-half[i] - oo[i]) / dd[i], c = (half[i] - oo[i]) / dd[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

function inSetPiece(o, top) {
  for (; o && o !== top.parent; o = o.parent) if (o.userData.setPiece) return true;
  return false;
}

function visibleWithin(o, top) {
  for (; o && o !== top.parent; o = o.parent) if (!o.visible) return false;
  return true;
}

function isVisible(o) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

const app = new App();
window.__app = app; // used by the automated tests (and handy for debugging)
app.start().catch((err) => {
  console.error(err);
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = `The viewer could not start: ${err.message}`;
});
