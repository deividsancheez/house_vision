// Walk mode: first-person walking through the rooms, aiming at pieces, carrying them (with a
// placement preview), storing them, and the doorway between the rooms. The rules live in
// src/core (walk.js, carry.js, inventory.js); this file is the three.js and input side.
import * as THREE from 'three';
import { makeRoomRoot, roomToWorld } from '../units.js';
import { buildItems, pieceByKey, itemBoxes, effDims, poseRef } from '../core/items.js';
import { DEG, normDeg } from '../core/geom.js';
import { WALK, outlineSegments, bodyObstacles, stepBody, startPose, arrivalPose, doorwayHit, nearDoorway, roomSurfaces, aimAt, fwdOf, onRug, openEdgeContact, bodyClear } from '../core/walk.js';
import { previewPlacement, isSmall, shortName } from '../core/carry.js';
import { dependentsDeep } from '../core/inventory.js';
import { explainWarning } from '../core/explain.js';
import { buildProduct } from '../scene/products.js';
import { buildExisting } from '../scene/existing.js';
import { mergeStatic } from '../scene/merge.js';
import { Hands } from './hands.js';

const COLORS = { ok: '#35c46a', warn: '#f2bf2f', bad: '#e5484d', aim: '#ffffff' };
const LOOK_MOUSE = 0.13; // degrees per pixel
const LOOK_TOUCH = 0.28;
const STRIDE = 26; // inches between footsteps
const HOLD_R_MS = 380; // holding R turns in 90° steps after this long

export class WalkMode {
  constructor(app) {
    this.app = app;
    this.cat = app.cat;
    this.active = false;
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.yaw = 0;
    this.pitch = -8;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.lookQueue = { yaw: 0, pitch: 0 };
    this.carry = null;
    this.aim = null;
    this.stepDist = 0;
    this.transition = null;
    this.root = makeRoomRoot();
    this.root.name = 'walk-root';
    this.aimOutline = new THREE.Group();
    this.ghost = new THREE.Group();
    this.root.add(this.aimOutline, this.ghost);
    this.hands = new Hands();
    this.ghostMats = Object.fromEntries(['ok', 'warn', 'bad'].map((k) => [k, new THREE.MeshBasicMaterial({ color: COLORS[k], transparent: true, opacity: 0.4, depthWrite: false })]));
    this.edgeMats = Object.fromEntries(['ok', 'warn', 'bad', 'aim'].map((k) => [k, new THREE.LineBasicMaterial({ color: COLORS[k], transparent: true, opacity: 0.95, depthTest: false })]));
    this.modelCache = new Map();
  }

  get eyeHeight() { return this.app.settings.eyeHeight; }
  get headZ() { return this.eyeHeight + WALK.headroom; }
  get roomId() { return this.app.roomId; }

  // ------------------------------------------------------------------------------------------
  enter() {
    this.active = true;
    this.app.scene.add(this.root);
    if (!this.placedIn || this.placedIn !== this.roomId) this.toStart();
    this.applyCamera();
    this.hands.setPose('idle');
    this.dirtyWorld();
  }

  exit() {
    if (this.carry) this.cancel(true);
    this.active = false;
    this.app.scene.remove(this.root);
    this.setAim(null);
    this.keys.clear();
    this.joy = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  /** Go to the room's start spot (first visit, or the room switch in the top bar). */
  toStart() {
    const p = startPose(this.cat, this.roomId, this.app.items, { headZ: this.headZ });
    this.teleport(p.x, p.y, p.yaw, -8);
  }

  teleport(x, y, yaw = this.yaw, pitch = this.pitch) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.yaw = normDeg(yaw);
    this.pitch = pitch;
    this.placedIn = this.roomId;
    this.applyCamera();
    this.app.invalidate();
  }

  /** The room's walls and furniture changed (layout edit, room switch). */
  dirtyWorld() { this.world = null; }

  getWorld() {
    if (this.world && this.world.roomId === this.roomId) return this.world;
    const room = this.app.room.room;
    const items = this.app.items;
    const exclude = new Set(this.carry ? this.carry.keys : []);
    this.world = {
      roomId: this.roomId,
      room,
      segs: outlineSegments(room),
      obstacles: bodyObstacles(items, this.headZ, exclude),
      r: WALK.radius,
      surfaces: roomSurfaces(room, { closetOpen: !this.app.room.closetDoorsVisible }),
    };
    return this.world;
  }

  // ------------------------------------------------------------------------------------------
  /** One frame. Returns true when something on screen changed. */
  update(dt, now) {
    if (!this.active) return false;
    let changed = false;
    if (this.transition) changed = this.stepTransition(now) || changed;
    // look
    if (this.lookQueue.yaw || this.lookQueue.pitch) {
      this.yaw = normDeg(this.yaw - this.lookQueue.yaw);
      this.pitch = Math.max(-80, Math.min(80, this.pitch - this.lookQueue.pitch));
      this.lookQueue = { yaw: 0, pitch: 0 };
      changed = true;
    }
    if (this.keys.has('turnL')) { this.yaw = normDeg(this.yaw + 90 * dt); changed = true; }
    if (this.keys.has('turnR')) { this.yaw = normDeg(this.yaw - 90 * dt); changed = true; }
    // walk
    const f = fwdOf(this.yaw), right = { x: f.y, y: -f.x };
    let fw = 0, st = 0;
    if (this.keys.has('fwd')) fw += 1;
    if (this.keys.has('back')) fw -= 1;
    if (this.keys.has('right')) st += 1;
    if (this.keys.has('left')) st -= 1;
    fw += this.joy.y; st += this.joy.x;
    let inp = { x: f.x * fw + right.x * st, y: f.y * fw + right.y * st };
    const il = Math.hypot(inp.x, inp.y);
    if (il > 1) inp = { x: inp.x / il, y: inp.y / il };
    if (this.transition) inp = { x: 0, y: 0 };
    if (il > 0.01 || Math.hypot(this.vel.x, this.vel.y) > 0.01) {
      const w = this.getWorld();
      const s = stepBody({ ...this.pos, vx: this.vel.x, vy: this.vel.y }, { ...inp, run: this.keys.has('run') }, dt, w);
      const moved = Math.hypot(s.x - this.pos.x, s.y - this.pos.y);
      this.pos = { x: s.x, y: s.y };
      this.vel = { x: s.vx, y: s.vy };
      changed = changed || moved > 1e-4;
      this.stepDist += moved;
      if (this.stepDist > STRIDE) { this.stepDist = 0; this.app.sounds.play('step', { rug: onRug(this.app.items, this.pos) }); }
      if (openEdgeContact(s.contacts) && il > 0.01) this.app.ui.walkHud?.note('Kitchen not modeled');
      if (!this.transition && il > 0.01) {
        const d = doorwayHit(this.cat, this.roomId, this.pos, inp);
        if (d) this.goThrough(d);
      }
    }
    this.applyCamera();
    const door = nearDoorway(this.cat, this.roomId, this.pos);
    this.updateAim();
    if (this.carry) this.updatePreview();
    const handsMoving = this.hands.update(dt, this.app.settings.sway);
    this.app.ui.walkHud?.update({ door, aim: this.aim, carry: this.carry });
    return changed || handsMoving || !!this.carry;
  }

  applyCamera() {
    const cam = this.app.camera;
    const eye = roomToWorld({ x: this.pos.x, y: this.pos.y, z: this.eyeHeight });
    cam.position.copy(eye);
    const d = this.dir();
    cam.up.set(0, 1, 0);
    cam.lookAt(roomToWorld({ x: this.pos.x + d.x, y: this.pos.y + d.y, z: this.eyeHeight + d.z }));
    cam.updateMatrixWorld();
    this.hands.follow(cam);
  }

  /** Unit view direction in room coords. */
  dir() {
    const f = fwdOf(this.yaw), c = Math.cos(this.pitch * DEG);
    return { x: f.x * c, y: f.y * c, z: Math.sin(this.pitch * DEG) };
  }

  eye() { return { x: this.pos.x, y: this.pos.y, z: this.eyeHeight }; }

  look(dx, dy, touch = false) {
    const k = touch ? LOOK_TOUCH : LOOK_MOUSE;
    this.lookQueue.yaw += dx * k;
    this.lookQueue.pitch += dy * k;
    this.app.invalidate();
  }

  /** Turn to face a room point (tests, tutorial). */
  lookAtPoint(p) {
    const e = this.eye();
    const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
    this.yaw = normDeg((Math.atan2(-dx, dy) * 180) / Math.PI);
    this.pitch = (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI;
    this.applyCamera();
    this.app.invalidate();
  }

  // ------------------------------------------------------------------------------------------
  // Doorway between the rooms: fade to black, switch, fade back in.
  goThrough(d) {
    this.transition = { phase: 'out', t0: performance.now(), to: d };
    this.vel = { x: 0, y: 0 };
    this.app.ui.walkHud?.fade(true);
  }

  stepTransition(now) {
    const tr = this.transition;
    if (tr.phase === 'out' && now - tr.t0 >= 200) {
      tr.phase = 'switch';
      const { toRoom, toOpening } = tr.to;
      this.app.setRoom(toRoom, { keepWalk: true }).then(() => {
        const p = arrivalPose(this.cat, toRoom, toOpening, this.app.items, { headZ: this.headZ });
        this.teleport(p.x, p.y, p.yaw, this.pitch);
        this.dirtyWorld();
        tr.phase = 'in';
        tr.t0 = performance.now();
        this.app.ui.walkHud?.fade(false);
        this.app.emit('walk-room');
      });
    }
    if (tr.phase === 'in' && now - tr.t0 >= 200) this.transition = null;
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Aiming
  updateAim() {
    if (this.carry || this.transition) { this.setAim(null); return; }
    const w = this.getWorld();
    const hit = aimAt(this.app.items, w.surfaces, this.eye(), this.dir(), { reach: WALK.reach });
    this.setAim(hit ? hit.key : null);
  }

  setAim(key) {
    if ((this.aim?.key || null) === key) return;
    this.aim = key ? { key, item: this.app.item(key) } : null;
    this.aimOutline.clear();
    if (this.aim?.item) this.aimOutline.add(outlineOf(this.aim.item, this.edgeMats.aim));
    this.app.invalidate();
  }

  // ------------------------------------------------------------------------------------------
  // Carrying
  /** E / Pick up: pick up what you're aiming at. */
  pickUp() {
    if (this.carry || !this.aim) return false;
    const it = this.app.item(this.aim.key);
    if (!it || it.hidden) return false;
    const deps = dependentsDeep(this.app.items, it);
    this.beginCarry({ it, deps, source: 'room', originRoom: this.roomId, relRot: it.mount === 'wall' ? 0 : normDeg(it.pose.rot - this.yaw) });
    this.app.sounds.play('pickup');
    this.app.emit('carry');
    return true;
  }

  /** Start carrying a stored group (inventory Place). catalog: undo the Catalog add on cancel. */
  carryFromInventory(uid, { catalog = false } = {}) {
    if (this.carry) this.cancel(true);
    const g = this.app.layout.inventory.find((x) => x.uid === uid);
    if (!g) return false;
    const it = pieceByKey(this.cat, this.app.layout, g.keys[0]);
    const deps = g.keys.slice(1).map((k) => pieceByKey(this.cat, this.app.layout, k)).filter(Boolean);
    if (it.mount === 'hidden') {
      // inserts live inside the covers: back where the slot puts them
      this.app.placeNow(it, deps);
      return true;
    }
    // from the inventory a piece faces you
    this.beginCarry({ it, deps, source: 'inventory', uid, catalog, originRoom: null, relRot: 180 });
    this.app.sounds.play('pickup');
    this.app.emit('carry');
    return true;
  }

  beginCarry(c) {
    const it = c.it;
    this.carry = { ...c, key: it.key, keys: [it.key, ...c.deps.map((d) => d.key)], spin: it.pose.spin || 0, small: isSmall(it), preview: null, built: false };
    for (const rs of this.app.rooms.values()) rs.setHiddenKeys(new Set(this.carry.keys));
    this.dirtyWorld();
    this.setAim(null);
    this.buildCarryModels(this.carry);
    const m = (v) => v * 0.0254;
    this.hands.setPose(this.carry.small ? 'hold' : 'guide', { w: m(Math.max(it.dims.w, it.dims.d)), d: m(Math.min(it.dims.w, it.dims.d)), h: m(it.dims.h) });
    this.updatePreview();
    this.app.invalidate(true);
  }

  async buildCarryModels(carry) {
    const pieces = [carry.it, ...carry.deps];
    const ghosts = await Promise.all(pieces.map((p) => this.modelFor(p)));
    if (this.carry !== carry) return;
    this.ghost.clear();
    carry.ghostParts = pieces.map((p, i) => {
      const g = new THREE.Group();
      const pivot = new THREE.Group();
      g.add(pivot);
      if (ghosts[i] && !p.hidden) {
        const m = ghosts[i].clone(true);
        m.traverse((o) => {
          if (!o.isMesh) return;
          if (o.userData.glowShell || o === ghosts[i].userData.flame) { o.visible = false; return; }
          o.material = this.ghostMats.ok;
          o.castShadow = false; o.receiveShadow = false;
          o.raycast = () => {};
        });
        pivot.add(m);
        g.userData.model = m;
      }
      g.userData.item = p;
      this.ghost.add(g);
      return g;
    });
    if (carry.small && ghosts[0]) {
      const held = ghosts[0].clone(true);
      held.traverse((o) => { if (o.isMesh && o.userData.glowShell) o.visible = false; });
      this.hands.hold(held, carry.it.dims);
      carry.held = held;
    }
    carry.built = true;
    this.updatePreview();
    this.app.invalidate();
  }

  /** A fresh model of a piece (cached per product / existing piece and piece index). */
  async modelFor(it) {
    const id = it.kind === 'product' ? `${it.product.id}#${it.index}` : it.key;
    if (!this.modelCache.has(id)) {
      const make = async () => {
        if (it.kind === 'existing') { const m = buildExisting(it.piece, it); mergeStatic(m); return m; }
        const bed = this.cat.existing.get(it.slot.on_top_of)?.mattress ? this.cat.existing.get(it.slot.on_top_of) : null;
        const b = await buildProduct(it.product, it, { bed });
        if (b.flame) b.object.userData.flame = b.flame;
        return b.object;
      };
      this.modelCache.set(id, make().catch((e) => { console.warn('ghost model', e); return null; }));
    }
    return this.modelCache.get(id);
  }

  /** Recompute where the carried piece would land. */
  updatePreview() {
    const c = this.carry;
    if (!c) return;
    const w = this.getWorld();
    const items = this.app.items.filter((o) => !c.keys.includes(o.key));
    const it = { ...c.it, pose: { ...c.it.pose, spin: c.spin } };
    const p = previewPlacement({ cat: this.cat, roomId: this.roomId, items, it, deps: c.deps, surfaces: w.surfaces, eye: this.eye(), dir: this.dir(), yaw: this.yaw, relRot: c.relRot, body: this.pos });
    p.titles = p.warnings.map((x) => explainWarning(this.cat, this.roomId, x, [...items, { ...it, pose: p.pose, wallId: p.wallId }, ...c.deps]).title);
    c.preview = p;
    this.drawGhost();
  }

  drawGhost() {
    const c = this.carry;
    if (!c?.ghostParts || !c.preview) return;
    const p = c.preview;
    const mat = this.ghostMats[p.status];
    // the piece in your hands turns with R too (wall pieces show their face)
    if (c.held) c.held.rotation.set(0, c.it.mount === 'wall' ? (c.spin || 0) * DEG : 0, c.it.mount === 'wall' ? Math.PI : c.relRot * DEG);
    const poses = [{ pose: p.pose, wallId: p.wallId }, ...c.deps.map((d) => ({ pose: p.deps.find((x) => x.key === d.key)?.pose || d.pose }))];
    const items = this.app.items.filter((o) => !c.keys.includes(o.key));
    c.ghostParts.forEach((g, i) => {
      const it = g.userData.item;
      const pose = poses[i].pose;
      const probe = { ...it, pose, roomId: this.roomId, wallId: poses[i].wallId ?? it.wallId };
      let baseZ;
      if (it.mount === 'wall') baseZ = pose.z - effDims(probe, pose).h / 2;
      else if (i === 0) baseZ = it.mount === 'top' ? supportTop(items, probe) : 0;
      else baseZ = c.it.kind === 'product' ? c.it.dims.h : it.defaultZ; // on a product: its top; on a piece you own: the designer's height
      placeGroup(g, probe, pose, baseZ);
      g.userData.model?.traverse((o) => { if (o.isMesh && o.visible) o.material = mat; });
    });
    this.app.invalidate();
  }

  /** E / tap / click while carrying: drop it on the preview (refused when red). */
  drop() {
    const c = this.carry;
    if (!c?.preview) return false;
    if (c.preview.status === 'bad') {
      this.app.sounds.play('invalid');
      this.app.ui.walkHud?.refuse(c.preview.reason);
      return false;
    }
    const p = c.preview;
    const placements = [{ key: c.key, pose: { ...p.pose, spin: c.spin }, wallId: p.wallId }, ...p.deps.map((d) => ({ key: d.key, pose: d.pose }))];
    const label = c.source === 'room' ? `Move ${shortName(c.it)}` : `Place ${shortName(c.it)}`;
    this.endCarry();
    this.app.placePieces(this.roomId, placements, label);
    this.app.sounds.play('drop');
    this.app.emit('dropped');
    return true;
  }

  /** Esc: put it back where it was (or back in the inventory). */
  cancel(silent = false) {
    const c = this.carry;
    if (!c) return false;
    this.endCarry();
    if (c.catalog) this.app.undo(true); // the Catalog add is undone: not in the budget
    if (!silent) this.app.ui.toast(c.source === 'room' ? 'Put back where it was.' : 'Back in the inventory.', 'info');
    this.app.emit('carry');
    return true;
  }

  endCarry() {
    this.carry = null;
    this.ghost.clear();
    this.hands.clearHeld();
    this.hands.setPose('idle');
    for (const rs of this.app.rooms.values()) rs.setHiddenKeys(new Set());
    this.dirtyWorld();
    this.app.invalidate(true);
  }

  /** F: store what you carry or aim at (and what rests on it). */
  store() {
    const c = this.carry;
    if (c) {
      if (c.source !== 'room') { this.cancel(true); this.app.ui.toast('Back in the inventory.', 'info'); this.app.sounds.play('store'); return true; }
      this.endCarry();
      this.app.storeKey(c.key, c.originRoom);
      return true;
    }
    if (!this.aim) return false;
    return this.app.storeKey(this.aim.key, this.roomId);
  }

  /** R: turn the carried piece 15° (wall pieces: a quarter turn in the wall plane). */
  rotate(step) {
    const c = this.carry;
    if (!c) return false;
    if (c.it.mount === 'wall') c.spin = ((c.spin || 0) + (step > 0 ? 90 : 270)) % 360;
    else c.relRot = normDeg(c.relRot + step);
    this.app.sounds.play('click');
    this.updatePreview();
    return true;
  }

  /** Hold R: snap to the next quarter turn. */
  rotateQuarter(dir) {
    const c = this.carry;
    if (!c || c.it.mount === 'wall') return this.rotate(dir * 90);
    const abs = normDeg(this.yaw + c.relRot);
    const next = dir > 0 ? Math.floor(abs / 90 + 1e-6) * 90 + 90 : Math.ceil(abs / 90 - 1e-6) * 90 - 90;
    c.relRot = normDeg(next - this.yaw);
    this.app.sounds.play('click');
    this.updatePreview();
    return true;
  }

  /** Q / Info: the item card for what you aim at. */
  info() {
    const key = this.carry?.key || this.aim?.key;
    if (!key) return false;
    if (this.carry && this.carry.source !== 'room') return false;
    this.app.select(key);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  /** State for the tests and the HUD. */
  state() {
    const c = this.carry;
    return {
      room: this.roomId, x: this.pos.x, y: this.pos.y, yaw: this.yaw, pitch: this.pitch, eye: this.eyeHeight,
      camZ: this.app.camera.position.y / 0.0254,
      aim: this.aim?.key || null,
      carry: c ? { key: c.key, keys: c.keys, small: c.small, status: c.preview?.status, reason: c.preview?.reason, titles: c.preview?.titles, pose: c.preview?.pose, relRot: c.relRot, spin: c.spin, source: c.source } : null,
      moving: Math.hypot(this.vel.x, this.vel.y),
      transition: !!this.transition,
      clear: (() => { const w = this.getWorld(); return bodyClear(this.pos, w.r - 0.05, w.room, w.segs, w.obstacles); })(),
    };
  }

  /**
   * Stand somewhere clear within reach of a piece and look at it, so that it is the piece you aim
   * at (used by the tests). Returns false when no such spot exists.
   */
  faceItem(key) {
    const it = this.app.item(key);
    if (!it) return false;
    const w = this.getWorld();
    const c = { x: it.pose.x, y: it.pose.y, z: (it.baseZ ?? 0) + effDims(it).h / 2 };
    for (let dist = 30; dist <= 84; dist += 6) {
      for (let a = 0; a < 360; a += 15) {
        const p = { x: c.x + Math.cos(a * DEG) * dist, y: c.y + Math.sin(a * DEG) * dist };
        if (!bodyClear(p, w.r, w.room, w.segs, w.obstacles)) continue;
        const eye = { ...p, z: this.eyeHeight };
        const d = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
        const n = Math.hypot(d.x, d.y, d.z);
        if (aimAt(this.app.items, w.surfaces, eye, { x: d.x / n, y: d.y / n, z: d.z / n }, { reach: WALK.reach })?.key !== key) continue;
        this.teleport(p.x, p.y);
        this.lookAtPoint(c);
        this.updateAim();
        return true;
      }
    }
    return false;
  }

  // keyboard state helpers
  keyDown(name) { this.keys.add(name); this.app.invalidate(); }
  keyUp(name) { this.keys.delete(name); }
}

/** Box outline of an item (all its parts) in room inches. */
function outlineOf(it, mat) {
  const g = new THREE.Group();
  for (const b of itemBoxes(it)) {
    const geo = new THREE.BoxGeometry(b.o.hw * 2 + 0.8, b.o.hd * 2 + 0.8, Math.max(0.4, b.z1 - b.z0) + 0.8);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
    e.position.set(b.o.cx, b.o.cy, (b.z0 + b.z1) / 2);
    e.rotation.z = Math.atan2(b.o.ux[1], b.o.ux[0]);
    e.renderOrder = 20;
    e.raycast = () => {};
    g.add(e);
  }
  return g;
}

/** Same placement as RoomScene.place: position + yaw, wall pieces spun in the wall plane. */
function placeGroup(g, it, pose, baseZ) {
  g.position.set(pose.x, pose.y, baseZ);
  g.rotation.set(0, 0, pose.rot * DEG);
  const pivot = g.children[0];
  const model = g.userData.model;
  if (it.mount === 'wall' && pose.spin) {
    const ed = effDims(it, pose);
    pivot.position.set(0, 0, ed.h / 2);
    pivot.rotation.set(0, pose.spin * DEG, 0);
    if (model) model.position.z = -it.dims.h / 2;
  } else {
    pivot.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    if (model) model.position.z = 0;
  }
}

function supportTop(items, it) {
  const sup = items.find((o) => o.id === it.supportId && o.index === 0);
  if (!sup) return it.defaultZ;
  return sup.kind === 'product' ? (sup.baseZ ?? 0) + sup.dims.h : it.defaultZ;
}

export { poseRef };
