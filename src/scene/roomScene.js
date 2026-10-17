// One room in the 3D scene: architecture + placed items + lights, kept in sync with the layout.
// Rooms are built the first time they're opened, so the app only loads the room being viewed.
import * as THREE from 'three';
import { mergeStatic } from './merge.js';
import { makeRoomRoot, roomToWorld, worldToRoom } from '../units.js';
import { buildRoom, setBlinds } from './room.js';
import { buildExisting } from './existing.js';
import { buildProduct } from './products.js';
import { RoomLighting } from './lighting.js';
import { buildItems, itemBoxes, effDims, isLightSource, productKind } from '../core/items.js';
import { wallCoords, pointAlong } from '../core/catalog.js';
import { rotate2, pointInRegion, DEG } from '../core/geom.js';

const ACCENT = '#2f7df6';
const WARN = '#e5484d';

let blobTexture = null;
function blobTex() {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

export class RoomScene {
  constructor(app, roomId) {
    this.app = app;
    this.cat = app.cat;
    this.roomId = roomId;
    this.room = this.cat.rooms.get(roomId);
    this.root = makeRoomRoot();
    this.root.name = `root-${roomId}`;
    this.rb = buildRoom(this.cat, roomId);
    this.root.add(this.rb.root);
    this.itemsGroup = new THREE.Group();
    this.overlay = new THREE.Group();
    this.root.add(this.itemsGroup, this.overlay);
    this.objects = new Map(); // item key -> { group, pivot, model, build, item, productId }
    this.items = [];
    this.lighting = null;
    this.pending = new Set();
    this.curtainT = 0; // 0 open .. 1 closed (animated)
    this.curtainTarget = 0;
    this.closetDoorsVisible = true;
    this.mode = 'day';
    this.hiddenKeys = new Set(); // pieces being carried in Walk mode
    this.highlight = new THREE.Group(); // "Show me" for a warning
    this.root.add(this.highlight);
  }

  attach(scene) {
    scene.add(this.root);
    // lamps of both rooms: a lamp carried into the other room still lights up at night
    if (!this.lighting) this.lighting = new RoomLighting(scene, this.rb, this.app.quality, Object.values(this.cat.lighting || {}).flat());
    else scene.add(this.lighting.group);
  }

  detach(scene) {
    scene.remove(this.root);
    if (this.lighting) scene.remove(this.lighting.group);
  }

  // ------------------------------------------------------------------------------------------
  /** Rebuild/refresh item objects for the current layout. Returns a promise that resolves when models are loaded. */
  sync(layout) {
    this.items = buildItems(this.cat, layout, this.roomId);
    const keep = new Set();
    const loads = [];
    for (const it of this.items) {
      keep.add(it.key);
      const productId = it.kind === 'product' ? it.product.id : it.id;
      let o = this.objects.get(it.key);
      if (o && o.productId !== productId) { this.disposeObject(o); this.objects.delete(it.key); o = null; }
      if (!o) {
        o = this.createObject(it, productId);
        this.objects.set(it.key, o);
        if (o.ready) loads.push(o.ready);
      }
      o.item = it;
      this.place(o);
    }
    for (const [k, o] of this.objects) if (!keep.has(k)) { this.disposeObject(o); this.objects.delete(k); }
    this.updateLights();
    this.applyCurtains(true);
    this.app.invalidate(true);
    return Promise.all(loads);
  }

  createObject(it, productId) {
    const group = new THREE.Group();
    group.userData.itemKey = it.key;
    group.name = it.key;
    const pivot = new THREE.Group();
    group.add(pivot);
    this.itemsGroup.add(group);
    const o = { group, pivot, model: null, build: null, item: it, productId, blobs: [] };
    if (it.hidden) { group.visible = false; return o; }
    if (it.kind === 'existing') {
      const model = buildExisting(it.piece, it);
      mergeStatic(model);
      this.setModel(o, { object: model, glow: [], flame: null, curtain: null });
    } else {
      // placeholder box while the model (or its GLB) loads
      const ph = new THREE.Mesh(new THREE.BoxGeometry(it.dims.w, it.dims.d, it.dims.h), new THREE.MeshStandardMaterial({ color: '#d9d4cc', transparent: true, opacity: 0.5 }));
      ph.position.z = it.dims.h / 2;
      pivot.add(ph);
      o.placeholder = ph;
      const bed = this.cat.existing.get(it.slot.on_top_of)?.mattress ? this.cat.existing.get(it.slot.on_top_of) : null;
      o.ready = buildProduct(it.product, it, { bed })
        .then((build) => {
          if (o.disposed) return;
          pivot.remove(ph);
          ph.geometry.dispose();
          this.setModel(o, build);
          this.place(o);
          this.updateLights();
          this.applyCurtains(true);
          this.app.invalidate(true);
        })
        .catch((err) => {
          console.error(`Could not build ${it.product.id}`, err);
          this.app.reportError?.(`Could not build ${it.product.id}: ${err.message}`);
        });
    }
    if (it.mount === 'floor' && !it.isRug && it.dims.h > 1.5) this.addBlobs(o);
    return o;
  }

  setModel(o, build) {
    o.build = build;
    o.model = build.object;
    o.model.traverse((m) => { if (m.isMesh) m.userData.itemKey = o.item.key; });
    o.pivot.add(o.model);
  }

  /** Soft contact shadow under each floor piece (it stays when the sun is off). All of them are
   *  one instanced mesh, so they cost a single draw call. */
  addBlobs(o) {
    const it = o.item;
    const parts = it.localParts || [{ ox: 0, oy: 0, hw: it.dims.w / 2, hd: it.dims.d / 2 }];
    o.blobs = parts.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.ox, p.oy, 0.08), new THREE.Quaternion(), new THREE.Vector3(p.hw * 2 + 7, p.hd * 2 + 7, 1)));
    this.blobsDirty = true;
  }

  refreshBlobs() {
    if (!this.blobMesh) {
      const m = new THREE.MeshBasicMaterial({ color: '#000', alphaMap: blobTex(), transparent: true, opacity: 0.32, depthWrite: false });
      this.blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, 256);
      this.blobMesh.renderOrder = -1;
      this.blobMesh.frustumCulled = false;
      this.blobMesh.castShadow = false;
      this.blobMesh.raycast = () => {};
      this.itemsGroup.add(this.blobMesh);
    }
    const tmp = new THREE.Matrix4();
    let i = 0;
    for (const o of this.objects.values()) {
      if (!o.blobs.length || !o.group.visible || o.disposed) continue;
      o.group.updateMatrix();
      for (const b of o.blobs) if (i < 256) this.blobMesh.setMatrixAt(i++, tmp.multiplyMatrices(o.group.matrix, b));
    }
    this.blobMesh.count = i;
    this.blobMesh.instanceMatrix.needsUpdate = true;
    this.blobsDirty = false;
  }

  disposeObject(o) {
    o.disposed = true;
    this.blobsDirty = true;
    this.itemsGroup.remove(o.group);
    o.group.traverse((m) => {
      if (m.isMesh && !m.userData.shared) {
        if (!o.build?.object?.userData?.glb) m.geometry?.dispose?.();
      }
    });
  }

  /** Position an item's object from its pose (room inches; wall items may be spun in the wall plane). */
  place(o) {
    const it = o.item;
    const p = it.pose;
    o.group.position.set(p.x, p.y, it.baseZ ?? 0);
    o.group.rotation.set(0, 0, p.rot * DEG);
    if (it.mount === 'wall' && p.spin) {
      const ed = effDims(it, p);
      o.pivot.position.set(0, 0, ed.h / 2);
      o.pivot.rotation.set(0, p.spin * DEG, 0);
      if (o.model) o.model.position.z = -it.dims.h / 2;
    } else {
      o.pivot.position.set(0, 0, 0);
      o.pivot.rotation.set(0, 0, 0);
      if (o.model && o.build?.kind !== 'curtain') o.model.position.set(0, 0, 0);
    }
    o.group.visible = !it.hidden && !this.hiddenKeys.has(it.key);
    if (o.blobs.length) this.blobsDirty = true;
  }

  /** Hide the pieces being carried (they're drawn as a preview instead); their lights go out. */
  setHiddenKeys(keys) {
    const same = keys.size === this.hiddenKeys.size && [...keys].every((k) => this.hiddenKeys.has(k));
    if (same) return;
    this.hiddenKeys = keys;
    for (const o of this.objects.values()) this.place(o);
    this.updateLights();
  }

  /** Mark a warning's zone on the floor (or the covered part of a wall, or the pieces) for a while. */
  showHighlight(hl, ms = 6000) {
    this.highlight.clear();
    clearTimeout(this.highlightTimer);
    if (!hl) { this.app.invalidate(); return; }
    const color = '#ff3b30';
    const add = (geo, pos, rot) => {
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      fill.position.copy(pos);
      if (rot) fill.rotation.copy(rot);
      fill.renderOrder = 15;
      fill.raycast = () => {};
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, depthTest: false }));
      edge.position.copy(pos);
      if (rot) edge.rotation.copy(rot);
      edge.renderOrder = 16;
      edge.raycast = () => {};
      this.highlight.add(fill, edge);
    };
    if (hl.zone) {
      const z = hl.zone;
      add(new THREE.PlaneGeometry(Math.abs(z.x1 - z.x0), Math.abs(z.y1 - z.y0)), new THREE.Vector3((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 0.6));
    }
    if (hl.wallId) {
      const wall = this.room.walls.get(hl.wallId);
      const a = (hl.along[0] + hl.along[1]) / 2, len = hl.along[1] - hl.along[0];
      const p = pointAlong(wall, a);
      const geo = new THREE.PlaneGeometry(len, hl.zRange[1] - hl.zRange[0]);
      const rot = new THREE.Euler(Math.PI / 2, 0, Math.atan2(wall.dir.y, wall.dir.x), 'ZXY');
      add(geo, new THREE.Vector3(p.x + wall.normal.x * 0.6, p.y + wall.normal.y * 0.6, (hl.zRange[0] + hl.zRange[1]) / 2), rot);
    }
    for (const key of hl.keys || []) {
      const it = this.items.find((i) => i.key === key);
      if (it) this.highlight.add(this.outline(it, color));
    }
    this.highlightUntil = performance.now() + ms;
    this.highlightTimer = setTimeout(() => { this.highlight.clear(); this.app.invalidate(); }, ms);
    this.app.invalidate();
  }

  object(key) { return this.objects.get(key); }

  // ------------------------------------------------------------------------------------------
  /** Lights follow the item they belong to (room-spec "source"); they go out if it's removed. */
  lightAnchors() {
    const anchors = new Map();
    const slots = [...this.cat.slots.keys()].sort((a, b) => b.length - a.length);
    for (const spec of this.lighting?.specs || this.room.lights) {
      if (!spec.position) continue;
      const src = spec.source || '';
      const fan = (this.room.ceiling_fixtures || []).find((f) => src.startsWith(f.id));
      if (fan) { anchors.set(spec.id, { pos: spec.position, fan: fan.id }); continue; }
      const slotId = slots.find((s) => src.startsWith(s));
      if (!slotId) continue;
      const slot = this.cat.slots.get(slotId);
      let idx = 0;
      const dirWord = (src.match(/\b(east|west|north|south)\b/i) || [])[1];
      if (dirWord) idx = Math.max(0, slot.placements.findIndex((pl) => new RegExp(`\\b${dirWord}\\b`, 'i').test(pl.label || '')));
      const it = this.items.find((i) => i.id === slotId && i.index === idx);
      if (!it || !isLightSource(it.product) || this.hiddenKeys.has(it.key)) { anchors.set(spec.id, { pos: null }); continue; }
      // offset of the light from the designer's default placement, carried into the item's frame
      const pl = slot.placements[idx];
      const def = { x: pl.position_center.x, y: pl.position_center.y, z: slot.mount === 'wall' ? pl.position_center.z : pl.bbox.min.z, rot: pl.rotation_deg_z ?? 0 };
      const defBase = slot.mount === 'wall' ? pl.bbox.min.z : pl.bbox.min.z;
      const rel = rotate2(spec.position.x - def.x, spec.position.y - def.y, -def.rot);
      const defH = pl.bbox.max.z - pl.bbox.min.z;
      const zRel = (spec.position.z - defBase) * (it.dims.h / (defH || it.dims.h));
      const w = rotate2(rel.x, rel.y, it.pose.rot);
      anchors.set(spec.id, { pos: { x: it.pose.x + w.x, y: it.pose.y + w.y, z: (it.baseZ ?? 0) + zRel }, key: it.key });
    }
    return anchors;
  }

  updateLights() {
    if (!this.lighting) return;
    const anchors = this.lightAnchors();
    const on = this.lightsOn = new Set(this.lighting.apply(this.mode, anchors, this.app.renderer, this.app.scene));
    const night = this.mode === 'night';
    const litKeys = new Set([...anchors.entries()].filter(([id]) => on.has(id)).map(([, a]) => a.key));
    for (const o of this.objects.values()) {
      const lit = litKeys.has(o.item.key);
      for (const m of o.build?.glow || []) {
        m.emissiveIntensity = lit ? (m.userData.glowStrength ?? 1.6) : 0;
        if (m.transparent && m.opacity !== undefined && m.color?.getHex() === 0) m.opacity = lit ? 0.85 : 0;
      }
      if (o.build?.flame) o.build.flame.material.opacity = lit ? 1 : 0;
    }
    for (const f of this.rb.fans) f.dome.emissiveIntensity = night ? 2.2 : 0;
    // daylight bounced off the floor and walls lights the ceiling (the studio environment is dark below)
    const ceil = this.rb.materials.ceiling;
    ceil.emissive.copy(ceil.color);
    ceil.emissiveIntensity = night ? 0 : 0.28;
    for (const b of this.rb.backdrops) b.material.color.set(night ? '#0d1424' : '#ffffff');
    this.app.invalidate(true);
  }

  setMode(mode) {
    this.mode = mode;
    setBlinds(this.rb, mode === 'day');
    this.updateLights();
  }

  // ------------------------------------------------------------------------------------------
  // Curtains: the slot placements are the open (stacked) panels; closed, each panel covers half of
  // the rod (or half of the designer's rod position if the rod was removed).
  setCurtainsClosed(closed, animate = true) {
    this.curtainTarget = closed ? 1 : 0;
    if (!animate) this.curtainT = this.curtainTarget;
    this.applyCurtains(true);
  }

  stepAnimations(dt) {
    if (this.curtainT === this.curtainTarget) return false;
    const s = Math.sign(this.curtainTarget - this.curtainT);
    this.curtainT = Math.max(0, Math.min(1, this.curtainT + s * dt * 1.6));
    if ((s > 0 && this.curtainT > this.curtainTarget) || (s < 0 && this.curtainT < this.curtainTarget)) this.curtainT = this.curtainTarget;
    this.applyCurtains(false);
    return true;
  }

  applyCurtains() {
    const t = this.curtainT * this.curtainT * (3 - 2 * this.curtainT);
    const curtains = this.items.filter((i) => i.kind === 'product' && i.productKind === 'curtain');
    const byWall = new Map();
    for (const c of curtains) (byWall.get(c.wallId) || byWall.set(c.wallId, []).get(c.wallId)).push(c);
    for (const [wallId, list] of byWall) {
      const wall = this.room.walls.get(wallId);
      const rod = this.items.find((i) => i.productKind === 'rod' && i.wallId === wallId);
      let r0, r1;
      if (rod) { const a = wallCoords(wall, rod.pose.x, rod.pose.y).along; const w = effDims(rod).w; r0 = a - w / 2; r1 = a + w / 2; }
      else {
        const rodSlot = [...this.cat.slots.values()].find((s) => s.room === this.roomId && s.wall === wallId && s.options.some((p) => productKind(this.cat.products.get(p)) === 'rod'));
        const bb = rodSlot?.placements[0].bbox;
        const a0 = bb ? wallCoords(wall, bb.min.x, bb.min.y).along : 0, a1 = bb ? wallCoords(wall, bb.max.x, bb.max.y).along : wall.len;
        r0 = Math.min(a0, a1); r1 = Math.max(a0, a1);
      }
      const sorted = [...list].sort((a, b) => wallCoords(wall, a.pose.x, a.pose.y).along - wallCoords(wall, b.pose.x, b.pose.y).along);
      const half = (r1 - r0) / sorted.length;
      sorted.forEach((c, i) => {
        const o = this.objects.get(c.key);
        if (!o?.build?.curtain) return;
        const openAlong = wallCoords(wall, c.pose.x, c.pose.y).along;
        const closedAlong = r0 + half * (i + 0.5);
        const along = openAlong + (closedAlong - openAlong) * t;
        const width = c.dims.w + (half - c.dims.w) * t;
        o.build.curtain.setWidth(width, 4 - 1.5 * t);
        // convert the along-wall shift to the item's local x axis
        const pt = pointAlong(wall, along), here = pointAlong(wall, openAlong);
        const d = rotate2(pt.x - here.x, pt.y - here.y, -c.pose.rot);
        // hang from the rod line, in front of the existing blinds
        o.model.position.set(d.x, d.y + 2.5, 0);
      });
    }
    this.app.invalidate(true);
  }

  setClosetDoorsVisible(v) {
    this.closetDoorsVisible = v;
    if (this.rb.closetDoors) this.rb.closetDoors.visible = v;
    this.app.invalidate(true);
  }

  // ------------------------------------------------------------------------------------------
  /** Dollhouse cut-away: hide walls between the camera and the room, and the ceiling from above. */
  updateCutaway(camera) {
    if (this.blobsDirty) this.refreshBlobs();
    const c = worldToRoom(camera.position);
    const inside = pointInRegion(c.x, c.y, this.room.regions) && c.z < this.room.ceiling;
    const hiddenWalls = new Set();
    for (const g of this.rb.wallGroups) {
      const u = g.userData;
      const outside = (c.x - u.point.x) * u.out.x + (c.y - u.point.y) * u.out.y > 0;
      const vis = inside || !outside;
      g.visible = vis;
      if (!vis && u.wallId && !u.closet) hiddenWalls.add(u.wallId);
    }
    // pieces hung on a cut-away wall would float in the air, so they hide with their wall
    for (const o of this.objects.values()) {
      if (o.item.mount === 'wall' && !o.item.hidden) o.group.visible = !hiddenWalls.has(o.item.wallId);
    }
    for (const m of this.rb.ceilings) m.visible = inside || c.z < this.room.ceiling;
    // the painted view outside the windows only makes sense from inside the room
    for (const b of this.rb.backdrops) b.visible = inside;
    if (this.rb.closetDoors) this.rb.closetDoors.visible = this.closetDoorsVisible;
  }

  // ------------------------------------------------------------------------------------------
  // Selection and warning overlays
  setSelection(key, warnings = []) {
    this.overlay.clear();
    const it = this.items.find((i) => i.key === key);
    if (it) this.overlay.add(this.outline(it, warnings.some((w) => w.key === key) ? WARN : ACCENT));
    for (const w of warnings) {
      if (!w.zone) continue;
      const z = w.zone;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.y1 - z.y0), new THREE.MeshBasicMaterial({ color: WARN, transparent: true, opacity: 0.22, depthWrite: false }));
      m.position.set((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 0.3);
      m.raycast = () => {};
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: WARN }));
      edge.position.copy(m.position);
      edge.raycast = () => {};
      this.overlay.add(m, edge);
    }
    this.app.invalidate(true);
  }

  outline(it, color) {
    const g = new THREE.Group();
    for (const b of itemBoxes(it)) {
      const geo = new THREE.BoxGeometry(b.o.hw * 2 + 0.6, b.o.hd * 2 + 0.6, Math.max(0.4, b.z1 - b.z0) + 0.6);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      e.position.set(b.o.cx, b.o.cy, (b.z0 + b.z1) / 2);
      e.rotation.z = Math.atan2(b.o.ux[1], b.o.ux[0]);
      e.renderOrder = 10;
      e.raycast = () => {};
      g.add(e);
      const fp = new THREE.Mesh(new THREE.PlaneGeometry(b.o.hw * 2 + 1, b.o.hd * 2 + 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
      fp.position.set(b.o.cx, b.o.cy, it.mount === 'wall' ? b.z0 : b.z0 + 0.25);
      fp.rotation.z = e.rotation.z;
      if (it.mount === 'wall') fp.visible = false;
      fp.raycast = () => {};
      g.add(fp);
    }
    return g;
  }

  /** Room-space point for a world point. */
  toRoom(v) { return worldToRoom(v); }
  toWorld(p) { return roomToWorld(p); }
}
