// Builds a room's architecture from room-spec.json: floor, walls with openings, ceiling, trim,
// windows, doors (and their swing arcs), the closet, outlets/switches/grilles, existing blinds and
// ceiling fans. Everything is in room coordinates (inches, z up) under the room root group.
import * as THREE from 'three';
import { mergeStatic } from './merge.js';
import { box, cyl, plane, group, strut, sphere } from './shapes.js';
import { mat, plankTexture, planarUV, texturedMat } from './materials.js';
import { pointAlong } from '../core/catalog.js';
import { pointInRegion } from '../core/geom.js';

const T = 4.5; // drawn wall thickness (outside the room outline, so interior sizes stay exact)
const CASING = 2.5; // door casing width
const ALUMINUM = '#C8CACC';

export function buildRoom(cat, roomId) {
  const room = cat.rooms.get(roomId);
  const f = room.finishes;
  const M = {
    wall: mat(f.walls.hex, { roughness: 0.93 }),
    cap: mat('#55514c', { roughness: 0.93 }), // same finish as the wall so both draw together
    ceiling: mat(f.ceiling.hex, { roughness: 0.95, side: THREE.BackSide }),
    trim: mat(f.trim.hex, { roughness: 0.6 }),
    door: mat(f.trim.hex, { roughness: 0.55 }),
    nickel: mat('#B9BBBD', { metalness: 0.85, roughness: 0.35 }),
    aluminum: mat(ALUMINUM, { metalness: 0.6, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: '#cfe3ea', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, depthWrite: false }),
    plate: mat('#F7F6F2', { roughness: 0.5 }),
    dark: mat('#2a2a2a', { roughness: 0.7 }),
    blinds: mat('#F2F1EC', { roughness: 0.6, side: THREE.DoubleSide }),
  };
  for (const tw of room.window_treatments_existing || []) M.blinds.color.set(tw.color_hex);

  const root = group();
  root.name = `room-${roomId}`;
  const out = { room, root, wallGroups: [], windows: [], backdrops: [], fans: [], closetDoors: null, materials: M, swingArcs: group() };

  // Floor ----------------------------------------------------------------------------------------
  const floorTex = plankTexture(f.floor.hex);
  const eastWestAxis = roomId === 'living' ? 'x' : 'y'; // planks run east-west (room-spec finishes)
  const floorMat = texturedMat(floorTex, [1, 1], { roughness: 0.55 });
  floorMat.map.repeat.set(1, 1);
  const addFloor = (poly) => {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(shape);
    planarUV(g, eastWestAxis, eastWestAxis === 'x' ? 'y' : 'x', floorTex.userData.repeatInches);
    const m = new THREE.Mesh(g, floorMat);
    m.receiveShadow = true;
    m.name = 'floor';
    root.add(m);
    return m;
  };
  for (const r of room.regions) addFloor(r);
  const ceilMeshes = [];
  const addCeiling = (poly, z = room.ceiling) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y))));
    const m = new THREE.Mesh(g, M.ceiling);
    m.position.z = z;
    m.name = 'ceiling';
    m.receiveShadow = true;
    m.userData.keep = true; // hidden on its own when looking from above
    root.add(m);
    ceilMeshes.push(m);
  };
  for (const r of room.regions) addCeiling(r);

  // Walls ----------------------------------------------------------------------------------------
  for (const wall of room.walls.values()) {
    if (wall.open) continue;
    const wg = group();
    wg.name = `wall-${wall.id}`;
    const nOut = { x: -wall.normal.x, y: -wall.normal.y };
    wg.userData = { wallId: wall.id, out: nOut, point: { x: (wall.from.x + wall.to.x) / 2, y: (wall.from.y + wall.to.y) / 2 } };
    const yaw = Math.atan2(wall.dir.y, wall.dir.x);
    const holes = wall.openings
      .filter((o) => o.type !== 'open boundary')
      .map((o) => ({ a0: o.along_from, a1: o.along_to, z0: o.sill_z ?? 0, z1: o.type === 'closet' ? room.ceiling - 2 : o.head_z ?? o.height ?? room.ceiling }));
    // Extend past convex corners so the drawn wall thickness closes the corner.
    const extendAt = (pt, sign) => {
      const c = { x: pt.x + wall.dir.x * sign * (T / 2) + nOut.x * (T / 2), y: pt.y + wall.dir.y * sign * (T / 2) + nOut.y * (T / 2) };
      return !pointInRegion(c.x, c.y, room.regions);
    };
    const a0 = extendAt(wall.from, -1) ? -T : 0;
    const a1 = wall.len + (extendAt(wall.to, 1) ? T : 0);
    for (const piece of wallPieces(a0, a1, 0, room.ceiling, holes)) {
      const len = piece.a1 - piece.a0, h = piece.z1 - piece.z0;
      if (len < 0.01 || h < 0.01) continue;
      const g = new THREE.BoxGeometry(len, T, h);
      const m = new THREE.Mesh(g, M.wall);
      const mid = pointAlong(wall, (piece.a0 + piece.a1) / 2);
      m.position.set(mid.x + nOut.x * (T / 2), mid.y + nOut.y * (T / 2), piece.z0 + h / 2);
      m.rotation.z = yaw;
      m.castShadow = true;
      m.receiveShadow = true;
      wg.add(m);
      if (piece.z1 >= room.ceiling - 0.01) {
        // dark cap on the cut top of the wall (seen in the cut-away view from above)
        const cap = new THREE.Mesh(new THREE.PlaneGeometry(len, T), M.cap);
        cap.position.set(m.position.x, m.position.y, piece.z1 + 0.02);
        cap.rotation.z = yaw;
        cap.castShadow = false;
        cap.receiveShadow = true;
        wg.add(cap);
      }
    }
    buildBaseboard(wg, room, wall, M);
    for (const o of wall.openings) buildOpening(out, wg, room, wall, o, M);
    for (const fx of wall.fixtures) buildFixture(wg, wall, fx, M);
    root.add(wg);
    out.wallGroups.push(wg);
  }

  // Closet recess (bedroom): back and side walls, ceiling, doors
  for (const o of room.openings.filter((x) => x.type === 'closet')) buildCloset(out, root, room, o, M, addCeiling);

  // Context beyond the open edge / pass-through (living): the kitchen
  if (roomId === 'living') buildKitchen(out, root, room, M, addFloor, addCeiling);

  // Existing blinds
  for (const tw of room.window_treatments_existing || []) buildBlinds(out, room, tw, M);

  // Ceiling fans (existing pieces with light kits)
  for (const fx of room.ceiling_fixtures || []) out.fans.push(buildFan(root, fx, roomId, M));

  root.add(out.swingArcs);
  out.ceilings = ceilMeshes;
  addShadowCasters(out, root, ceilMeshes);
  for (const b of out.backdrops) b.userData.keep = true;
  if (out.closetDoors) out.closetDoors.userData.keep = true;
  for (const wg of out.wallGroups) { mergeStatic(wg); wg.userData.keep = true; } // each wall hides on its own
  mergeStatic(root);
  return out;
}

// The cut-away hides walls and the ceiling from the camera, but the sun must still come in only
// through the windows whatever the view. Hidden objects cast no shadows in three.js, so each wall and
// ceiling gets an always-visible copy that only draws into the shadow map.
function addShadowCasters(out, root, ceilMeshes) {
  const wallMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const ceilMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const casters = group();
  casters.name = 'shadow-casters';
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const add = (m, material) => {
    const c = new THREE.Mesh(m.geometry, material);
    c.matrixAutoUpdate = false;
    c.matrix.multiplyMatrices(rootInv, m.matrixWorld);
    c.castShadow = true;
    c.raycast = () => {};
    casters.add(c);
  };
  for (const wg of out.wallGroups) {
    wg.traverse((m) => {
      if (!m.isMesh || !m.castShadow || m.name === 'glass' || isInside(m, out.closetDoors)) return;
      add(m, wallMat);
      m.castShadow = false;
    });
  }
  for (const m of ceilMeshes) add(m, ceilMat);
  mergeStatic(casters);
  casters.userData.keep = true;
  root.add(casters);
  out.shadowCasters = casters;
}

function isInside(o, parent) {
  for (let p = o; p; p = p.parent) if (p === parent) return true;
  return false;
}

/** Split a wall face [a0,a1]x[z0,z1] into solid rectangles around the holes. */
export function wallPieces(a0, a1, z0, z1, holes) {
  const xs = [...new Set([a0, a1, ...holes.flatMap((h) => [h.a0, h.a1])].filter((v) => v >= a0 && v <= a1))].sort((p, q) => p - q);
  const pieces = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const c0 = xs[i], c1 = xs[i + 1], cm = (c0 + c1) / 2;
    const cuts = holes.filter((h) => h.a0 < cm && h.a1 > cm).map((h) => [h.z0, h.z1]).sort((p, q) => p[0] - q[0]);
    let z = z0;
    for (const [h0, h1] of cuts) { if (h0 > z) pieces.push({ a0: c0, a1: c1, z0: z, z1: h0 }); z = Math.max(z, h1); }
    if (z < z1) pieces.push({ a0: c0, a1: c1, z0: z, z1 });
  }
  // merge vertically-identical neighbours to keep the draw count low
  const merged = [];
  for (const p of pieces) {
    const last = merged.find((m) => m.z0 === p.z0 && m.z1 === p.z1 && Math.abs(m.a1 - p.a0) < 1e-6);
    if (last) last.a1 = p.a1; else merged.push({ ...p });
  }
  return merged;
}

/** Group in wall-local coordinates (x along, y into the room, z up). */
function wallLocal(wall, along) {
  const g = new THREE.Group();
  const p = pointAlong(wall, along);
  g.position.set(p.x, p.y, 0);
  // basis: x = dir, y = normal (into room), z = up. Build via matrix so mirrored walls stay right-handed.
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(wall.dir.x, wall.dir.y, 0), new THREE.Vector3(wall.normal.x, wall.normal.y, 0), new THREE.Vector3(0, 0, 1));
  if (m.determinant() < 0) {
    // x must flip so the basis stays a rotation; callers use symmetric content or pass along explicitly
    m.makeBasis(new THREE.Vector3(-wall.dir.x, -wall.dir.y, 0), new THREE.Vector3(wall.normal.x, wall.normal.y, 0), new THREE.Vector3(0, 0, 1));
    g.userData.flipX = true;
  }
  g.quaternion.setFromRotationMatrix(m);
  return g;
}
/** Converts an along-wall offset to wall-local x (handles walls whose basis was flipped). */
const lx = (g, dx) => (g.userData.flipX ? -dx : dx);

function buildBaseboard(wg, room, wall, M) {
  const h = room.finishes.trim.baseboard_height ?? 4;
  const gaps = wall.openings.filter((o) => (o.sill_z ?? 0) < h).map((o) => [o.along_from - (o.type === 'door' || o.type === 'cased opening' ? CASING : 0), o.along_to + (o.type === 'door' || o.type === 'cased opening' ? CASING : 0)]);
  let a = 0;
  const runs = [];
  for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 > a) runs.push([a, g0]); a = Math.max(a, g1); }
  if (a < wall.len) runs.push([a, wall.len]);
  for (const [r0, r1] of runs) {
    const g = wallLocal(wall, (r0 + r1) / 2);
    g.add(box(r1 - r0, 0.6, h, M.trim, 0, 0.3, 0, { cast: false }));
    wg.add(g);
  }
}

function buildOpening(out, wg, room, wall, o, M) {
  const mid = (o.along_from + o.along_to) / 2;
  const w = o.along_to - o.along_from;
  const g = wallLocal(wall, mid);
  g.name = o.id;
  if (o.type === 'window') {
    const h = o.head_z - o.sill_z;
    const fr = 1.25, depthC = -T / 2; // frame sits mid-wall
    const frame = group(
      box(w, 2, fr, M.aluminum, 0, depthC, o.sill_z), box(w, 2, fr, M.aluminum, 0, depthC, o.head_z - fr),
      box(fr, 2, h, M.aluminum, -w / 2 + fr / 2, depthC, o.sill_z), box(fr, 2, h, M.aluminum, w / 2 - fr / 2, depthC, o.sill_z),
      box(1.4, 2.6, h, M.aluminum, 0, depthC, o.sill_z), // meeting rail of the two sliding sashes
    );
    const glass = group(
      plane(w / 2 - fr, h - 2 * fr, M.glass, -w / 4, depthC - 0.6, o.sill_z + h / 2, { receive: false }),
      plane(w / 2 - fr, h - 2 * fr, M.glass, w / 4, depthC + 0.6, o.sill_z + h / 2, { receive: false }),
    );
    glass.traverse((m) => { m.castShadow = false; m.name = 'glass'; });
    g.add(frame, glass);
    wg.add(g);
    // outside view backdrop (procedural: tree for the living room, neighbour building for the bedroom)
    const bd = backdrop(room.id, w, h);
    bd.position.set(0, -60, o.sill_z + h / 2);
    g.add(bd);
    out.backdrops.push(bd);
    out.windows.push({ opening: o, wall, wallGroup: wg, local: g });
    return;
  }
  if (o.type === 'door' || o.type === 'cased opening') {
    const h = o.height ?? 80;
    // casing on the room side
    g.add(box(CASING, 0.75, h + CASING, M.trim, -w / 2 - CASING / 2, 0.375, 0), box(CASING, 0.75, h + CASING, M.trim, w / 2 + CASING / 2, 0.375, 0), box(w, 0.75, CASING, M.trim, 0, 0.375, h));
    if (o.type === 'door') {
      const slab = group(box(w - 0.25, 1.75, h - 0.5, M.door, 0, 0, 0));
      // hinge side from the spec ("south (y=158)"): find which end of the opening is nearer that coordinate
      const hingeAlong = hingeAlongOf(wall, o);
      const knobX = lx(g, hingeAlong === o.along_from ? w / 2 - 2.75 : -w / 2 + 2.75);
      slab.add(sphere(1.1, M.nickel, knobX, 1.6, 36), cyl(0.4, 0.4, 1, M.nickel, knobX, 1.2, 35.5));
      if (/front/i.test(o.description || '')) slab.add(cyl(0.75, 0.75, 0.6, M.nickel, knobX, 1.1, 41.7), cyl(0.3, 0.3, 0.4, M.dark, 0, 1.1, 60));
      const hx = lx(g, hingeAlong === o.along_from ? -w / 2 + 0.3 : w / 2 - 0.3);
      for (const z of [8, h / 2, h - 12]) slab.add(box(0.6, 0.4, 3.5, M.nickel, hx, 0.9, z, { cast: false }));
      slab.position.y = -1.0;
      g.add(slab);
      if (o.swing && /inward/i.test(o.swing)) out.swingArcs.add(swingArc(wall, o, hingeAlong));
    } else {
      // cased opening into the hallway: short hallway stub so it doesn't open onto nothing
      const depth = 40;
      const hall = group(
        box(w + 2 * T, depth, 0.01, mat(room.finishes.floor.hex, { roughness: 0.6 }), 0, -T - depth / 2, -0.01),
        box(T, depth, room.ceiling, M.wall, -w / 2 - T / 2, -T - depth / 2, 0),
        box(T, depth, room.ceiling, M.wall, w / 2 + T / 2, -T - depth / 2, 0),
        box(w, T, room.ceiling, M.wall, 0, -T - depth - T / 2, 0),
        box(w, depth + T, 0.5, M.wall, 0, -T / 2 - depth / 2, room.ceiling),
      );
      g.add(hall);
    }
    wg.add(g);
    return;
  }
  if (o.type === 'interior opening') {
    // kitchen pass-through: white returns are the wall's own cut faces; add a slim sill cap
    g.add(box(w, T, 0.75, M.trim, 0, -T / 2, o.sill_z - 0.75));
    wg.add(g);
  }
}

function hingeAlongOf(wall, o) {
  const m = /([xy])\s*=\s*([\d.]+)/.exec(o.hinge_side || '');
  if (!m) return /north|west/i.test(o.hinge_side || '') ? o.along_from : o.along_to;
  const [ , axis, val] = m;
  const a = pointAlong(wall, o.along_from), b = pointAlong(wall, o.along_to);
  return Math.abs(a[axis] - Number(val)) < Math.abs(b[axis] - Number(val)) ? o.along_from : o.along_to;
}

function swingArc(wall, o, hingeAlong) {
  const r = o.swing_radius ?? o.width;
  const hinge = pointAlong(wall, hingeAlong);
  const closedDir = hingeAlong === o.along_from ? { x: wall.dir.x, y: wall.dir.y } : { x: -wall.dir.x, y: -wall.dir.y };
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * (Math.PI / 2);
    const dx = closedDir.x * Math.cos(t) + wall.normal.x * Math.sin(t), dy = closedDir.y * Math.cos(t) + wall.normal.y * Math.sin(t);
    pts.push(new THREE.Vector3(hinge.x + dx * r, hinge.y + dy * r, 0.15));
  }
  pts.push(new THREE.Vector3(hinge.x, hinge.y, 0.15));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: '#8a7f74', dashSize: 3, gapSize: 2, transparent: true, opacity: 0.7 }));
  line.computeLineDistances();
  line.name = `swing-${o.id}`;
  return line;
}

function buildFixture(wg, wall, fx, M) {
  const g = wallLocal(wall, fx.along ?? (fx.along_from + fx.along_to) / 2);
  g.name = fx.id;
  const t = fx.type.toLowerCase();
  if (t.includes('grille') || t.includes('register')) {
    const w = fx.along_to - fx.along_from, h = fx.z_to - fx.z_from;
    g.add(box(w, 0.5, h, M.plate, 0, 0.25, fx.z_from, { cast: false }));
    const n = Math.max(3, Math.round(h / 1.1));
    for (let i = 1; i < n; i++) g.add(box(w - 1.5, 0.3, 0.35, M.dark, 0, 0.5, fx.z_from + (h * i) / n, { cast: false }));
  } else if (t.includes('smoke')) {
    const c = cyl(2.6, 2.6, 1.4, M.plate, 0, 0, 0, 24, { cast: false });
    c.rotation.set(Math.PI / 2, 0, 0); c.position.set(0, 0.7, fx.z);
    g.add(c);
  } else if (t.includes('round')) {
    const c = cyl(2.4, 2.4, 0.25, M.plate, 0, 0, 0, 24, { cast: false });
    c.rotation.set(Math.PI / 2, 0, 0); c.position.set(0, 0.12, fx.z);
    g.add(c);
  } else {
    const dbl = t.includes('double');
    const w = dbl ? 4.6 : 2.85, h = 4.6;
    g.add(box(w, 0.25, h, M.plate, 0, 0.12, fx.z - h / 2, { cast: false }));
    if (t.includes('outlet')) for (const dz of [-0.85, 0.85]) g.add(box(1.4, 0.2, 1.1, mat('#e9e7e1'), 0, 0.3, fx.z + dz - 0.55, { cast: false }));
    else for (const dx of dbl ? [-1, 1] : [0]) g.add(box(0.45, 0.4, 0.9, mat('#efeee9'), dx, 0.4, fx.z - 0.45, { cast: false }));
  }
  wg.add(g);
}

function buildCloset(out, root, room, o, M, addCeiling) {
  const wall = room.walls.get(o.wall);
  const nOut = { x: -wall.normal.x, y: -wall.normal.y };
  const a = pointAlong(wall, o.along_from), b = pointAlong(wall, o.along_to);
  const d = o.depth;
  const at = (p, k) => ({ x: p.x + nOut.x * k, y: p.y + nOut.y * k });
  const wg = group();
  wg.name = 'closet';
  wg.userData = { wallId: o.wall, out: nOut, point: at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d / 2), closet: true };
  // back wall and two side walls of the recess
  const yaw = Math.atan2(wall.dir.y, wall.dir.x);
  const back = box(o.width + 2 * T, T, room.ceiling, M.wall);
  const bc = at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d + T / 2);
  back.position.set(bc.x, bc.y, room.ceiling / 2); back.rotation.z = yaw;
  wg.add(back);
  for (const [p, s] of [[a, -1], [b, 1]]) {
    const side = box(T, d, room.ceiling, M.wall);
    const c = at({ x: p.x + wall.dir.x * s * (T / 2), y: p.y + wall.dir.y * s * (T / 2) }, d / 2);
    side.position.set(c.x, c.y, room.ceiling / 2); side.rotation.z = yaw;
    wg.add(side);
  }
  root.add(wg);
  out.wallGroups.push(wg);
  // doors (in the closet front plane)
  const g = wallLocal(wall, (o.along_from + o.along_to) / 2);
  const w = o.width;
  const lower = o.lower, upper = o.upper;
  const doors = group();
  doors.name = 'closet-doors';
  // bypass sliding doors: two panels on offset tracks, overlapping 1"
  const pw = w / 2 + 0.5;
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const panel = box(pw, 1.25, lower.z_to - lower.z_from - 0.5, M.door, s * (w / 4 - 0.25), -1.2 - i * 1.4, lower.z_from + 0.25);
    doors.add(panel);
    doors.add(box(0.5, 0.6, 7, M.nickel, s * (w / 4 - 0.25) - s * (pw / 2 - 2.2), -1.2 - i * 1.4 + 0.9, 34));
  }
  // header between lower doors and upper cabinets, and above the cabinets
  g.add(box(w, 1.5, upper.z_from - lower.z_to, M.trim, 0, -0.75, lower.z_to));
  g.add(box(w, 1.5, room.ceiling - upper.z_to, M.trim, 0, -0.75, upper.z_to));
  // upper cabinets: 2 pairs of hinged doors
  const cw = w / 4;
  for (let i = 0; i < 4; i++) {
    const cx = -w / 2 + cw / 2 + i * cw;
    doors.add(box(cw - 0.3, 0.75, upper.z_to - upper.z_from - 0.3, M.door, cx, -0.6, upper.z_from + 0.15));
    const pullX = cx + (i % 2 === 0 ? cw / 2 - 1.2 : -cw / 2 + 1.2);
    doors.add(box(0.45, 0.6, 5, M.nickel, pullX, 0.1, upper.z_from + 1.5));
  }
  // casing around the closet front
  g.add(box(CASING, 0.75, room.ceiling, M.trim, -w / 2 - CASING / 2, 0.375, 0), box(CASING, 0.75, room.ceiling, M.trim, w / 2 + CASING / 2, 0.375, 0));
  g.add(doors);
  wg.add(g);
  out.closetDoors = doors;
}

function buildKitchen(out, root, room, M, addFloor, addCeiling) {
  // Context only: room-spec gives the kitchen's finishes (white shaker cabinets, black counter) but
  // not its layout. Standard cabinet sizes (24" deep base, 36" counter, 12" deep uppers) are used
  // along the dining end wall line, where the dining photo shows the counter.
  const pass = room.walls.get('LR-W-PASS'), edge = room.walls.get('LR-EDGE-KITCHEN'), south = room.walls.get('LR-W-SOUTH');
  if (!pass || !edge || !south) return;
  const x0 = Math.min(pass.from.x, pass.to.x), x1 = edge.from.x, y0 = pass.from.y, y1 = south.from.y;
  const poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  addFloor(poly);
  addCeiling(poly);
  const k = room.finishes.kitchen_visible;
  const cab = mat(k.cabinets.split(' ')[0], { roughness: 0.55 });
  const counter = mat(k.counter.split(' ')[0], { roughness: 0.3 });
  const kg = group();
  kg.name = 'kitchen';
  // walls: east (continues the window wall) and south (continues the dining end wall); each hides
  // in the cut-away view like the room's own walls
  const eastW = group(box(T, y1 - y0 + T, room.ceiling, M.wall, x0 - T / 2, (y0 + y1) / 2 + T / 2, 0));
  eastW.userData = { out: { x: -1, y: 0 }, point: { x: x0, y: (y0 + y1) / 2 } };
  const southW = group(box(x1 - x0 + T, T, room.ceiling, M.wall, (x0 + x1) / 2 - T / 2, y1 + T / 2, 0));
  southW.userData = { out: { x: 0, y: 1 }, point: { x: (x0 + x1) / 2, y: y1 } };
  for (const w of [eastW, southW]) { w.name = 'kitchen-wall'; root.add(w); out.wallGroups.push(w); }
  const baseLen = 84, upLen = 54;
  kg.add(box(baseLen, 24, 34.5, cab, x1 - baseLen / 2, y1 - 12, 0), box(baseLen + 1, 25.5, 1.5, counter, x1 - baseLen / 2, y1 - 12.75, 34.5));
  kg.add(box(baseLen - 1, 1, 4, mat('#e8e6e0'), x1 - baseLen / 2, y1 - 24.3, 0)); // toe kick shadow line
  for (let i = 0; i < 4; i++) {
    const cx = x1 - 10.5 - i * 21;
    kg.add(box(20, 0.6, 26, cab, cx, y1 - 24.3, 4.5));
    kg.add(box(5, 0.6, 0.45, M.nickel, cx, y1 - 24.9, 26));
  }
  kg.add(box(upLen, 12, 30, cab, x1 - upLen / 2, y1 - 6, 54));
  for (let i = 0; i < 3; i++) kg.add(box(0.45, 0.6, 5, M.nickel, x1 - 7 - i * 18, y1 - 12.3, 56));
  root.add(kg);
}

function buildBlinds(out, room, tw, M) {
  const win = room.openings.find((o) => o.id === tw.opening);
  const wall = room.walls.get(win.wall);
  const wg = out.wallGroups.find((g) => g.userData.wallId === wall.id);
  const a0 = tw.headrail.along_from, a1 = tw.headrail.along_to, zTop = tw.headrail.z;
  const g = wallLocal(wall, (a0 + a1) / 2);
  g.name = tw.id;
  const w = a1 - a0;
  g.add(box(w, 2.6, 2.4, M.blinds, 0, 1.9, zTop - 2.4));
  const vertical = /^vertical/i.test(tw.type.trim()); // bedroom type reads 'horizontal ... (not vertical)'
  if (vertical) {
    const vane = 3.5, pitch = 3.0;
    const n = Math.floor(w / pitch);
    const bottom = room.finishes.trim.baseboard_height ?? 4; // vanes stop just above the baseboard (photo)
    const len = zTop - 2.4 - bottom;
    const geo = new THREE.BoxGeometry(vane, 0.08, len);
    geo.translate(0, 0, len / 2);
    const inst = new THREE.InstancedMesh(geo, M.blinds, n);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.userData = { kind: 'vertical', n, pitch, w, bottom, axisY: 1.75 };
    g.add(inst);
    out.blinds = out.blinds || [];
    out.blinds.push(inst);
  } else {
    const slat = 2.0, pitch = 1.8;
    const zBottom = (win.sill_z ?? 36) + 0.5;
    const n = Math.floor((zTop - 2.4 - zBottom) / pitch);
    const geo = new THREE.BoxGeometry(w - 0.6, slat, 0.12);
    const inst = new THREE.InstancedMesh(geo, M.blinds, n);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.userData = { kind: 'horizontal', n, pitch, zTop: zTop - 2.4, axisY: 1.6 };
    g.add(inst);
    g.add(box(w - 0.4, 2.2, 0.9, M.blinds, 0, 1.6, zBottom - 0.9)); // bottom rail
    out.blinds = out.blinds || [];
    out.blinds.push(inst);
  }
  wg.add(g);
}

/** Open (day) or closed (night) the existing blinds by turning their vanes/slats. */
export function setBlinds(roomBuild, open) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (const inst of roomBuild.blinds || []) {
    const u = inst.userData;
    for (let i = 0; i < u.n; i++) {
      if (u.kind === 'vertical') {
        p.set(-u.w / 2 + u.pitch / 2 + i * u.pitch + 0.25, u.axisY, u.bottom);
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), open ? 1.15 : 0.12);
      } else {
        p.set(0, u.axisY, u.zTop - (i + 0.5) * u.pitch);
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), open ? -0.35 : -1.35);
      }
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }
}

function buildFan(root, fx, roomId, M) {
  const g = group();
  g.name = fx.id;
  const fin = fx.finish.toLowerCase();
  const body = mat('#B4B6B8', { metalness: 0.8, roughness: 0.3 });
  const bladeMat = mat(fin.includes('black blades') ? '#1d1d1d' : '#9ea1a4', { roughness: 0.5, metalness: fin.includes('silver') ? 0.4 : 0 });
  const domeMat = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.3, emissive: '#ffd9a8', emissiveIntensity: 0 });
  const ceil = 96;
  const lightZ = fx.position.z; // light kit center (room-spec)
  g.add(cyl(2.6, 2.6, 0.8, body, 0, 0, ceil - 0.8)); // canopy
  g.add(cyl(0.45, 0.45, ceil - 0.8 - (lightZ + 6), body, 0, 0, lightZ + 6)); // downrod
  g.add(cyl(4.6, 4.2, 4, body, 0, 0, lightZ + 2)); // motor housing
  const blades = fin.includes('black blades') ? 5 : 4; // counts as seen in the photos
  const span = fx.blade_span;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const len = span / 2 - 4.5;
    const blade = box(len, 4.6, 0.3, bladeMat, 0, 0, 0);
    blade.position.set(Math.cos(a) * (4.5 + len / 2), Math.sin(a) * (4.5 + len / 2), lightZ + 4.2);
    blade.rotation.z = a;
    blade.rotation.x = 0.12;
    g.add(blade);
  }
  const dome = sphere(3.6, domeMat, 0, 0, lightZ + 1.6, 24);
  dome.scale.z = 0.62;
  dome.castShadow = false;
  g.add(dome);
  g.add(cyl(3.9, 3.9, 0.6, body, 0, 0, lightZ + 1.4));
  if (fin.includes('pull') || roomId === 'bedroom') {
    for (const dx of [-1.5, 1.5]) g.add(strut([dx, 1, lightZ + 1.5], [dx, 1, lightZ - 6], 0.08, body, 4), sphere(0.35, body, dx, 1, lightZ - 6.2, 8));
  }
  g.position.set(fx.position.x, fx.position.y, 0);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  root.add(g);
  return { id: fx.id, group: g, dome: domeMat, lightPos: { ...fx.position } };
}

/** Procedural view out of the window (no real photo is used). */
function backdrop(roomId, w, h) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const r = (() => { let s = 11; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#cfe2f1'); sky.addColorStop(1, '#eef4f6');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  if (roomId === 'living') {
    g.fillStyle = '#e9e9e4'; g.fillRect(0, 150, 512, 106); // neighbour's white wall below the tree
    g.strokeStyle = '#6b5a48'; g.lineWidth = 6;
    for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(240 + (r() - 0.5) * 40, 256); g.quadraticCurveTo(250 + (r() - 0.5) * 200, 150, 256 + (r() - 0.5) * 420, 30 + r() * 60); g.stroke(); g.lineWidth = 2 + r() * 3; }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `hsla(${78 + r() * 35},${35 + r() * 30}%,${32 + r() * 30}%,${0.35 + r() * 0.4})`;
      g.beginPath(); g.ellipse(r() * 512, r() * 190, 6 + r() * 16, 4 + r() * 10, r() * 3, 0, Math.PI * 2); g.fill();
    }
  } else {
    g.fillStyle = '#d8c6ae'; g.fillRect(0, 40, 512, 216); // neighbouring stucco building
    for (let i = 0; i < 3; i++) { g.fillStyle = '#9fa7ab'; g.fillRect(60 + i * 160, 90, 80, 70); g.strokeStyle = '#3d3b39'; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(64 + i * 160 + k * 15, 90); g.lineTo(64 + i * 160 + k * 15, 160); g.stroke(); } }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = plane(w * 2.6, h * 2.4, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 0, 0, { receive: false });
  m.name = 'backdrop';
  m.castShadow = false;
  return m;
}
