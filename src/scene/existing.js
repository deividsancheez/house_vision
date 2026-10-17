// Models of the owner's existing furniture (room-spec.json "existing_pieces").
// Built in the item's local frame: inches, z up, front = +y, origin at the bottom center.
// Sizes, positions and colors come from the spec; shapes follow the owner's photos.
import * as THREE from 'three';
import { box, rbox, cyl, group, taperedLeg, sphere, plane, cushion } from './shapes.js';
import { mat, fabricTexture, texturedMat, woodTexture, boxUVInches } from './materials.js';
import { rotate2 } from '../core/geom.js';

export function buildExisting(piece, item) {
  const id = piece.id;
  if (/BED/.test(id)) return buildBed(piece);
  if (piece.components) return sectional(piece, item);
  if (/TVCONSOLE/.test(id)) return tvConsole(piece);
  if (/LR-TV$/.test(id)) return tv(piece);
  if (/DININGTABLE/.test(id)) return diningTable(piece);
  if (/DININGCHAIRS/.test(id)) return diningChair(piece);
  if (/MIRROR/.test(id)) return floorMirror(piece, item);
  if (/FLAG/.test(id)) return flag(piece);
  if (/NIGHTSTAND-GRAY/.test(id)) return sideTable(piece);
  const d = item.dims;
  return group(box(d.w, d.d, d.h, mat(piece.color_hex || '#888')));
}

// ---------------------------------------------------------------------------------------------
function sectional(piece, item) {
  // Each component (long leg, corner wedge, short leg) is drawn from its own bbox and facing.
  // Local frame of the whole piece = room axes, origin at the overall bbox center (see items.js).
  const g = group();
  const fabric = texturedMat(fabricTexture(piece.color_hex, 'chenille'), [1, 1], { roughness: 1 });
  const seatZ = 19, backH = 40;
  const comps = piece.components;
  const center = { x: 0, y: 0 };
  {
    const xs = comps.flatMap((c) => [c.bbox.min.x, c.bbox.max.x]), ys = comps.flatMap((c) => [c.bbox.min.y, c.bbox.max.y]);
    center.x = (Math.min(...xs) + Math.max(...xs)) / 2; center.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const inBox = (x, y, skip) => comps.some((c) => c !== skip && x > c.bbox.min.x && x < c.bbox.max.x && y > c.bbox.min.y && y < c.bbox.max.y);
  for (const c of comps) {
    const rot = c.rotation_deg_z ?? 0;
    const dx = c.bbox.max.x - c.bbox.min.x, dy = c.bbox.max.y - c.bbox.min.y;
    const side = Math.abs(Math.sin((rot * Math.PI) / 180)) > 0.5;
    const L = side ? dy : dx, D = side ? dx : dy; // L along the seat, D depth (front-back)
    const cx = (c.bbox.min.x + c.bbox.max.x) / 2, cy = (c.bbox.min.y + c.bbox.max.y) / 2;
    const toRoom = (lx, ly) => { const r = rotate2(lx, ly, rot); return { x: cx + r.x, y: cy + r.y }; };
    const freeEnd = (s) => { const p = toRoom(s * (L / 2 + 3), 0); return !inBox(p.x, p.y, c); };
    const isCorner = /corner/i.test(c.part);
    const m = group();
    const armW = 7, backT = 10;
    const leftArm = !isCorner && freeEnd(-1), rightArm = !isCorner && freeEnd(1);
    const x0 = -L / 2 + (leftArm ? armW : 0), x1 = L / 2 - (rightArm ? armW : 0);
    // plinth and seat base
    m.add(rbox(L - 1, D - 2, 11, 1.5, fabric, 0, 0, 2.5));
    m.add(box(L - 4, D - 6, 2.5, mat('#121010', { roughness: 0.9 }), 0, 0, 0));
    // back
    m.add(rbox(L, backT, backH - 11, 3, fabric, 0, -D / 2 + backT / 2, 11));
    // corner: second back along the free side
    if (isCorner) {
      const s = freeEnd(1) ? 1 : -1;
      m.add(rbox(backT, D, backH - 11, 3, fabric, s * (L / 2 - backT / 2), 0, 11));
    }
    // seat cushions and plump back cushions
    const seatW = x1 - x0 - (isCorner ? backT : 0);
    const sx0 = isCorner && freeEnd(-1) ? x0 + backT : x0;
    const n = Math.max(1, Math.round(seatW / 30));
    for (let i = 0; i < n; i++) {
      const w = seatW / n, x = sx0 + w / 2 + i * w;
      m.add(cushion(w - 0.8, D - backT - 1, seatZ - 13.5, fabric, 0.12, x, backT / 2, 13.5));
      m.add(cushion(w - 1, 8, 20, fabric, 0.25, x, -D / 2 + backT + 3, seatZ - 1));
    }
    for (const [has, s] of [[leftArm, -1], [rightArm, 1]]) {
      if (!has) continue;
      m.add(rbox(armW, D, 25 - 11, 2.5, fabric, s * (L / 2 - armW / 2), 0, 11));
      m.add(cushion(armW + 1, D - 1, 4, fabric, 0.2, s * (L / 2 - armW / 2), 0, 24));
    }
    m.rotation.z = (rot * Math.PI) / 180;
    m.position.set(cx - center.x, cy - center.y, 0);
    g.add(m);
  }
  return g;
}

function tvConsole(piece) {
  const { w, d, h } = piece.dims;
  const black = mat('#141414', { roughness: 0.45, metalness: 0.5 });
  const glass = mat(piece.color_hex, { roughness: 0.08, metalness: 0.2 });
  const brass = mat(piece.accent_hex, { roughness: 0.3, metalness: 0.9 });
  const g = group();
  g.add(box(w, d, 0.4, glass, 0, 0, h - 0.4), box(w - 2, d - 1, 0.4, glass, 0, 0, 6));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    g.add(box(0.9, 0.9, h - 2.4, black, sx * (w / 2 - 0.6), sy * (d / 2 - 0.6), 2.4));
    g.add(box(0.95, 0.95, 2.4, brass, sx * (w / 2 - 0.6), sy * (d / 2 - 0.6), 0));
  }
  for (const z of [5.4, h - 1.2]) for (const sy of [-1, 1]) g.add(box(w - 1, 0.6, 0.8, black, 0, sy * (d / 2 - 0.6), z));
  return g;
}

function tv(piece) {
  const { w, d, h } = piece.dims;
  const frame = mat(piece.color_hex, { roughness: 0.4, metalness: 0.3 });
  const screen = new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.12, metalness: 0.4 });
  const g = group();
  const feetH = 2.6;
  g.add(box(w, 1.1, h - feetH, frame, 0, 0, feetH));
  g.add(plane(w - 0.6, h - feetH - 0.6, screen, 0, 0.56, feetH + (h - feetH) / 2));
  for (const sx of [-1, 1]) g.add(box(1.2, d, 0.4, frame, sx * (w / 2 - 5), 0, 0), box(0.8, 0.6, feetH, frame, sx * (w / 2 - 5), -0.2, 0.2));
  return g;
}

function diningTable(piece) {
  const { w, h } = piece.dims;
  const top = mat(piece.color_hex, { roughness: 0.35 });
  const edge = mat(piece.accent_hex, { roughness: 0.5 });
  const brass = mat(piece.accent_hex, { roughness: 0.3, metalness: 0.85 });
  const g = group();
  g.add(cyl(w / 2, w / 2, 0.9, top, 0, 0, h - 0.9, 48), cyl(w / 2 + 0.05, w / 2 + 0.05, 0.25, edge, 0, 0, h - 0.95, 48));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.add(taperedLeg(Math.cos(a) * 11, Math.sin(a) * 11, h - 1, 0.7, 0.45, brass, Math.cos(a) * 5, Math.sin(a) * 5));
  }
  g.add(cyl(12, 12, 0.6, mat('#1a1a1a'), 0, 0, h - 1.8, 24));
  return g;
}

function diningChair(piece) {
  const { w, d, h } = piece.dims;
  const up = texturedMat(fabricTexture(piece.color_hex, 'linen'), [1, 1], { roughness: 0.55 });
  const metal = mat('#101010', { roughness: 0.5, metalness: 0.6 });
  const g = group();
  const seatZ = 18;
  g.add(cushion(w - 1, d - 4, 3, up, 0.15, 0, 1.5, seatZ - 3));
  // channel-tufted curved back: vertical channels
  const n = 6, bw = (w - 2) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 1 + bw / 2 + i * bw;
    const c = rbox(bw - 0.2, 2.2, h - seatZ - 1, 1, up, x, -d / 2 + 1.6 + Math.abs(x) * 0.08, seatZ);
    c.rotation.x = -0.1;
    g.add(c);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(taperedLeg(sx * (w / 2 - 2.5), sy * (d / 2 - 3), seatZ - 3, 0.45, 0.35, metal, sx * 1.2, sy * 1.5));
  return g;
}

function floorMirror(piece, item) {
  // Arched walnut floor mirror leaning on the wall: bottom out in front, top touching the wall.
  const { w, d, h } = piece.dims; // frame size; item.dims.d is the leaning footprint
  const lean = ((piece.lean_deg ?? 8) * Math.PI) / 180;
  const wood = texturedMat(woodTexture(piece.color_hex), [1, 1], { roughness: 0.5 });
  const glassM = new THREE.MeshStandardMaterial({ color: '#dfe5e8', metalness: 1, roughness: 0.04 });
  const archShape = (W, H) => {
    const s = new THREE.Shape();
    const r = W / 2;
    s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, H - r); s.absarc(0, H - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
    return s;
  };
  const H = h / Math.cos(lean); // panel length so the leaning mirror is h tall
  const frameG = new THREE.ExtrudeGeometry(archShape(w, H), { depth: d, bevelEnabled: false, curveSegments: 24 });
  frameG.rotateX(Math.PI / 2); // shape y -> z (up); extrusion along -y
  const frame = new THREE.Mesh(frameG, wood);
  frame.castShadow = frame.receiveShadow = true;
  const glassG = new THREE.ShapeGeometry(archShape(w - 2.4, H - 2.4), 24);
  glassG.rotateX(Math.PI / 2);
  glassG.rotateZ(Math.PI);
  const glass = new THREE.Mesh(glassG, glassM);
  glass.position.set(0, 0.02, 1.2);
  const lean_ = group(frame, glass);
  lean_.rotation.x = lean; // top tips back toward the wall (-y)
  // The item box is the leaning footprint (bbox depth); place the foot so the top touches the wall.
  const boxD = item.dims.d;
  lean_.position.y = -boxD / 2 + H * Math.sin(lean) + d * Math.cos(lean);
  return group(lean_);
}

function flag(piece) {
  const { w, h } = piece.dims;
  const c = document.createElement('canvas');
  c.width = 768; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = piece.color_hex; g.fillRect(0, 0, 768, 512);
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 34, 512); // header sleeve
  g.fillStyle = '#9a9a9a';
  for (const y of [40, 472]) { g.beginPath(); g.arc(17, y, 10, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(17, y, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9a9a9a'; }
  g.fillStyle = piece.accent_hex;
  g.strokeStyle = '#1f3f73';
  g.lineWidth = 6;
  g.font = 'italic bold 230px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeText('Ucla', 400, 270);
  g.fillText('Ucla', 400, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  return group(plane(w, h, m, 0, 0.05, h / 2));
}

function sideTable(piece) {
  const { w, d, h } = piece.dims;
  const top = texturedMat(woodTexture(piece.color_hex), [1, 1], { roughness: 0.6 });
  const metal = mat('#151515', { roughness: 0.5, metalness: 0.6 });
  const g = group(box(w, d, 0.8, top, 0, 0, h - 0.8), box(w - 1.5, d - 1.5, 0.6, top, 0, 0, 5));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(0.75, 0.75, h - 0.8, metal, sx * (w / 2 - 0.6), sy * (d / 2 - 0.6), 0));
  return g;
}

/** Queen bed: built from its components (headboard + frame/mattress) in the bed's local frame. */
export function buildBed(piece) {
  const { w, d, h } = piece.dims;
  const mt = piece.mattress;
  const up = texturedMat(fabricTexture(piece.color_hex, 'linen'), [1, 1], { roughness: 0.9 });
  const shelf = texturedMat(woodTexture(piece.accent_hex), [1, 1], { roughness: 0.55 });
  const frameMat = mat('#2b2c2f', { roughness: 0.7 });
  const mattress = mat('#f0efea', { roughness: 0.95 });
  const g = group();
  const hb = 4; // headboard depth from components
  // headboard at local -y (back)
  g.add(box(w, hb, h - 1.5, up, 0, -d / 2 + hb / 2, 0));
  // tufting buttons
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) g.add(sphere(0.45, frameMat, -w / 2 + 6 + i * ((w - 12) / 5), -d / 2 + hb + 0.1, 28 + r * 8, 6));
  g.add(box(w + 0.5, hb + 1.5, 1.5, shelf, 0, -d / 2 + hb / 2 + 0.4, h - 1.5));
  // frame rails and mattress
  const railH = 10;
  g.add(rbox(w, d - hb, railH, 1, frameMat, 0, hb / 2, 2));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(1.6, 1.6, 2, frameMat, sx * (w / 2 - 2), hb / 2 + sy * ((d - hb) / 2 - 2), 0));
  g.add(rbox(mt.w, mt.l, mt.top_z - railH - 2, 2.5, mattress, 0, hb / 2 + (d - hb - mt.l) / 2 - 0, railH + 2));
  return g;
}
