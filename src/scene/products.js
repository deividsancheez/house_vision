// 3D models for products.json items.
//  - Products with "model_3d_url" use the IKEA .glb stored with the app, fitted to the product's size.
//  - Everything else is built here from its dimensions, main_color_hex and material, with surface
//    detail from its photo in product-images/ where the photo shows the surface (art, rugs, pillows).
// Local frame: inches, z up, front = +y, origin at the bottom center; size = item.dims (w, d, h).
import * as THREE from 'three';
import { box, rbox, cyl, group, taperedLeg, sphere, plane, cushion, fluted, strut, lathe } from './shapes.js';
import { mat, fabricTexture, texturedMat, woodTexture, caneTexture, weaveTexture, photoTexture, stripesTexture } from './materials.js';
import { hasModel, loadTemplate, fitTemplate } from './glb.js';
import { productKind } from '../core/items.js';
import { mergeStatic } from './merge.js';

const base = import.meta.env?.BASE_URL ?? './';
export const photoUrl = (p) => `${base}${p.image_file || `product-images/${p.id}.jpg`}`;

// Which part of each product photo shows its surface (x0, y0, x1, y1 as fractions of the image).
const PHOTO_CROPS = {
  'LR-ART-A': [0.07, 0.15, 0.97, 0.78],
  'LR-ART-B': [0.15, 0.405, 0.85, 0.585],
  'LR-RUG-A': [0.25, 0.2, 0.75, 0.8],
  'LR-RUG-B': [0.25, 0.2, 0.75, 0.8],
  'BR-RUG-A': [0.3, 0.35, 0.7, 0.65],
  'BR-RUG-B': [0.3, 0.3, 0.7, 0.7],
  'LR-PILLOW-NEUTRAL-A': [0.3, 0.3, 0.7, 0.7],
  'LR-PILLOW-ACCENT-A': [0.3, 0.3, 0.7, 0.7],
  'LR-PILLOW-ACCENT-B': [0.32, 0.4, 0.58, 0.62],
  'BR-DECOR-A': [0.3, 0.42, 0.62, 0.74],
};

/** Night glow shells for GLB lamps (fractions of the lamp's size, read off the model renders). */
/** The photo crop of a product (lookbook products use the crop of their 3D plan id). A lookbook rug
 *  or pillow without one shows the middle of its photo, where store photos show the surface. */
function cropOf(p, surface = false) {
  const c = PHOTO_CROPS[p.modelId || p.id];
  if (c) return c;
  return surface && p.lookbook ? [0.3, 0.3, 0.7, 0.7] : null;
}

const GLB_SHADES = {
  'LR-FLOORLAMP-A': { z0: 0.775, z1: 1.0, r: 0.45 },
  'LR-FLOORLAMP-B': { z0: 0.786, z1: 0.906, r: 0.5 },
};

export async function buildProduct(product, item, ctx = {}) {
  const kind = productKind(product);
  const dims = item.dims;
  const out = { object: null, glow: [], flame: null, curtain: null, kind };
  // lookbook products use the model of their 3D plan id, or their own stored IKEA model (modelId)
  const mid = product.modelId || product.id;
  if (await hasModel(mid)) {
    const tpl = await loadTemplate(mid);
    if (tpl) {
      if (kind === 'curtain') return glbCurtain(tpl, product, item, out);
      let filter = null;
      if (product.pieces > 1) {
        // PJÄTTERYD: one model holds the three canvases in a row; each item instance is one canvas.
        const n = product.pieces, i = item.index % n, span = 1.728 / n;
        filter = (c) => c.x >= -0.864 + i * span - 0.01 && c.x < -0.864 + (i + 1) * span;
      }
      out.object = fitTemplate(tpl, mid, dims, filter, !!product.lookbook);
      const sh = GLB_SHADES[mid];
      if (sh) out.glow.push(addGlowShell(out.object, dims, sh));
      return finish(out);
    }
  }
  const color = product.main_color_hex;
  const B = BUILDERS[kind] || BUILDERS.box;
  B(product, dims, out, ctx, item);
  return finish(out);
}

function finish(out) {
  out.object.traverse((o) => { if (o.isMesh) { o.castShadow ??= true; o.receiveShadow = true; } });
  if (out.flame) out.flame.userData.keep = true;
  // GLB models are already compact; curtains change shape when they open and close
  if (!out.object.userData.glb && out.kind !== 'curtain') mergeStatic(out.object);
  return out;
}

function glowMat(color = '#ffd2a0') {
  return new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: 0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
}

function addGlowShell(obj, dims, sh) {
  const m = glowMat();
  const r = (dims.w / 2) * sh.r * 2 * 0.98;
  const c = cyl(r, r, (sh.z1 - sh.z0) * dims.h, m, 0, 0, sh.z0 * dims.h, 32, { open: true, cast: false });
  c.castShadow = false;
  c.userData.glowShell = true;
  obj.add(c);
  return m;
}

/** Shade material that glows warm at night (lighting.js sets emissiveIntensity). */
function shadeMat(color, tex) {
  const m = tex ? texturedMat(tex, [1, 1], { roughness: 0.9, side: THREE.DoubleSide }) : mat(color, { roughness: 0.9, side: THREE.DoubleSide });
  m.emissive = new THREE.Color('#ffc58a');
  m.emissiveIntensity = 0;
  return m;
}

// ---------------------------------------------------------------------------------------------
const BUILDERS = {
  rug(p, { w, d, h }, out) {
    const crop = cropOf(p, true);
    const top = crop ? new THREE.MeshStandardMaterial({ map: photoTexture(photoUrl(p), crop, { repeat: true }), roughness: 1 }) : mat(p.main_color_hex, { roughness: 1 });
    // pile/weave tile size in inches: jute diamonds are small; shag rugs read as an even surface
    const tile = /jute/i.test(p.name) ? 10 : 30;
    if (top.map) top.map.repeat.set(w / tile, d / tile);
    // pile edges as one box, the photo-textured surface on top (two draw calls instead of six)
    const body = box(w, d, h - 0.05, mat(p.main_color_hex, { roughness: 1 }), 0, 0, 0, { cast: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, d), top);
    face.position.z = h;
    face.castShadow = false;
    out.object = group(body, face);
  },

  curtain(p, dims, out) {
    out.object = pleatedPanel(p, dims, out);
  },

  rod(p, { w, d, h }, out) {
    const black = mat(p.main_color_hex, { roughness: 0.35, metalness: 0.6 });
    // everything stays inside the product's box: 1" profile (h) and 4" bracket projection (d)
    const r = h * 0.38;
    const g = group();
    const rodY = d / 2 - h / 2;
    g.add(strut([-w / 2 + 1.5, rodY, h / 2], [w / 2 - 1.5, rodY, h / 2], r, black, 16));
    for (const s of [-1, 1]) {
      const cap = cyl(h / 2, h / 2, 1.5, black, 0, 0, 0, 16); // end caps
      cap.rotation.set(0, Math.PI / 2, 0); cap.position.set(s * (w / 2 - 1.5), rodY, h / 2);
      if (s > 0) cap.position.x = w / 2;
      g.add(cap);
    }
    const brackets = w > 90 ? [-w / 2 + 6, 0, w / 2 - 6] : [-w / 2 + 6, w / 2 - 6];
    for (const x of brackets) g.add(box(0.8, d - 0.5, h * 0.45, black, x, -0.25, h * 0.3), box(1.0, 0.5, h, black, x, -d / 2 + 0.25, 0));
    out.object = g;
  },

  throw(p, { w, d, h }, out) {
    const m = texturedMat(fabricTexture(p.main_color_hex, 'linen'), [w / 12, d / 12], { roughness: 1 });
    out.object = group(cushion(w, d, h, m, 0.05));
  },

  duvet(p, dims, out, ctx) {
    out.object = duvet(p, dims, ctx.bed);
  },

  pillow(p, { w, d, h }, out) {
    const crop = cropOf(p, true);
    const m = crop ? new THREE.MeshStandardMaterial({ map: photoTexture(photoUrl(p), crop, { repeat: true }), roughness: 1 }) : mat(p.main_color_hex);
    if (m.map) m.map.repeat.set(2, 2);
    const c = cushion(w, d, h, m, 0.55); // standing against the sectional's back
    c.geometry.computeBoundingBox();
    c.scale.y = d / (c.geometry.boundingBox.max.y - c.geometry.boundingBox.min.y); // puffed middle exactly d thick
    out.object = group(c);
  },

  insert(p, { w, d, h }, out) {
    out.object = group(cushion(w - 0.5, d * 0.6, h - 0.5, mat(p.main_color_hex)));
  },

  sconce(p, { w, d, h }, out) {
    const g = group();
    if (/brass/i.test(p.name)) {
      // Threshold rattan sconce: round brass backplate, curved arm, cone rattan shade
      const brass = mat('#C9A46E', { metalness: 0.85, roughness: 0.3 });
      // overall 16.75" H: the arm rises from the plate to the top, the shade hangs down to the bottom
      const plate = cyl(2.4, 2.4, 0.6, brass, 0, 0, 0, 24);
      plate.rotation.set(Math.PI / 2, 0, 0); plate.position.set(0, -d / 2 + 0.3, h * 0.5);
      g.add(plate);
      const tip = [0, d / 2 - w / 2, h - 0.3];
      g.add(strut([0, -d / 2 + 0.6, h * 0.5], [0, -d / 2 + 4, h * 0.85], 0.3, brass, 8), strut([0, -d / 2 + 4, h * 0.85], tip, 0.3, brass, 8));
      g.add(strut(tip, [tip[0], tip[1], h * 0.55], 0.15, brass, 6));
      const shade = shadeMat('#C9A46E', weaveTexture('#C9A46E'));
      g.add(cyl(2.2, w / 2, h * 0.55, shade, 0, tip[1], 0, 32, { open: true }));
      out.glow.push(shade);
    } else {
      // FRIDEKO rattan plug-in sconce: wood holder on the wall, arm, woven lantern shade
      const wood = texturedMat(woodTexture('#C49A6C'), [0.3, 0.3], { roughness: 0.6 });
      g.add(box(2.2, 0.94, h * 0.75, wood, 0, -d / 2 + 0.47, h * 0.25));
      g.add(strut([0, -d / 2 + 0.9, h - 1.2], [0, d / 2 - w / 2, h - 1.2], 0.45, wood, 8));
      g.add(strut([0, d / 2 - w / 2, h - 1.2], [0, d / 2 - w / 2, h * 0.52], 0.06, mat('#7a5c3c'), 4));
      const shade = shadeMat(p.main_color_hex, weaveTexture(p.main_color_hex));
      g.add(cyl(w / 2 * 0.86, w / 2, h * 0.5, shade, 0, d / 2 - w / 2, 0, 28, { open: true }));
      g.add(cyl(w / 2 * 0.5, w / 2 * 0.86, 0.6, shade, 0, d / 2 - w / 2, h * 0.5, 28, { open: true }));
      out.glow.push(shade);
    }
    out.object = g;
  },

  floorlamp(p, { w, d, h }, out) {
    // (Both floor lamps have IKEA models; this is only a fallback.)
    const wood = mat('#C9A57A');
    const shade = shadeMat('#F3F1EA');
    const g = group(cyl(w / 2, w / 2, h * 0.22, shade, 0, 0, h * 0.78, 32, { open: true }));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.add(taperedLeg(0, 0, h * 0.5, 0.6, 0.5, wood, Math.cos(a) * w * 0.4, Math.sin(a) * w * 0.4)); }
    g.add(cyl(0.4, 0.4, h * 0.4, wood, 0, 0, h * 0.45));
    out.glow.push(shade);
    out.object = g;
  },

  tablelamp(p, { w, d, h }, out) {
    const g = group();
    if (/scallop|ceramic/i.test(p.name)) {
      // Hearth & Hand ceramic lamp: rounded ceramic base, pleated scalloped shade
      const ceramic = mat('#ECE8E1', { roughness: 0.35 });
      g.add(lathe([[0.01, 0], [2.4, 0], [3.0, 1.5], [3.1, 3.6], [2.3, 5.6], [0.9, 6.6], [0.6, 7.2], [0.01, 7.2]], ceramic, 32));
      g.add(cyl(0.2, 0.2, 1.5, mat('#b8a780', { metalness: 0.7, roughness: 0.4 }), 0, 0, 7.2));
      const shade = shadeMat(p.main_color_hex, fabricTexture('#E2D6C3', 'linen'));
      g.add(fluted(w / 2 * 0.62, w / 2, h - 8.2, 16, 0.09, shade, 8.2, { open: true }));
      out.glow.push(shade);
    } else {
      // STORSEGEL: three ash legs and a white fabric cylinder shade
      const wood = mat('#CDAF88', { roughness: 0.6 });
      const shade = shadeMat('#F1EFEA', fabricTexture('#F1EFEA', 'linen'));
      g.add(cyl(w / 2, w / 2, h * 0.5, shade, 0, 0, h * 0.5, 32, { open: true }));
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; g.add(taperedLeg(Math.cos(a) * 1.2, Math.sin(a) * 1.2, h * 0.62, 0.35, 0.28, wood, Math.cos(a) * (w / 2 - 1.5), Math.sin(a) * (w / 2 - 1.5))); }
      out.glow.push(shade);
    }
    out.object = g;
  },

  coffeetable(p, { w, d, h }, out) {
    const g = group();
    if (/fluted/i.test(p.name)) {
      const oak = texturedMat(woodTexture(p.main_color_hex), [1, 1], { roughness: 0.55 });
      g.add(fluted(w / 2, w / 2, h - 1.2, 40, 0.035, oak, 0));
      g.add(cyl(w / 2, w / 2, 1.2, oak, 0, 0, h - 1.2, 64));
    } else {
      const walnut = texturedMat(woodTexture(p.main_color_hex, 'figured'), [1, 1], { roughness: 0.4 });
      const legM = mat('#2b211b', { roughness: 0.5 });
      g.add(cyl(w / 2, w / 2, 1.25, walnut, 0, 0, h - 1.25, 64));
      g.add(cyl(w / 2 - 4, w / 2 - 4, 2.5, legM, 0, 0, h - 3.75, 48)); // apron ring
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; g.add(taperedLeg(Math.cos(a) * (w / 2 - 6), Math.sin(a) * (w / 2 - 6), h - 3, 0.9, 0.5, legM, Math.cos(a) * 2.5, Math.sin(a) * 2.5)); }
    }
    out.object = g;
  },

  mirror(p, { w, d, h }, out) {
    const r = Math.min(w, h) / 2;
    const frame = mat(p.main_color_hex, { roughness: 0.4, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: '#e7ecee', metalness: 1, roughness: 0.03 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - 0.6, 0.6, 12, 64), frame);
    ring.rotation.x = Math.PI / 2; ring.position.set(0, -d / 2 + 0.6, r);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r - 0.8, 64), glass);
    disc.rotation.x = -Math.PI / 2; disc.position.set(0, -d / 2 + 0.5, r);
    const back = cyl(r - 0.5, r - 0.5, 0.4, frame, 0, 0, 0, 48);
    back.rotation.set(Math.PI / 2, 0, 0); back.position.set(0, -d / 2 + 0.2, r);
    const g = group(back, disc, ring);
    if (/santa monica/i.test(p.brand || '') || (p.modelId || p.id).endsWith('-A')) {
      // listing photo: hangs from a braided rope loop
      const rope = mat('#b59a6e', { roughness: 1 });
      g.add(strut([-r * 0.55, -d / 2 + 0.3, r * 1.6], [0, -d / 2 + 0.3, h * 0.98], 0.35, rope, 6), strut([r * 0.55, -d / 2 + 0.3, r * 1.6], [0, -d / 2 + 0.3, h * 0.98], 0.35, rope, 6));
    }
    out.object = g;
  },

  art(p, { w, d, h }, out) {
    const crop = cropOf(p) || [0.1, 0.1, 0.9, 0.9];
    const face = new THREE.MeshStandardMaterial({ map: photoTexture(photoUrl(p), crop, { size: 1024 }), roughness: 0.85 });
    const g = group();
    if (/framed/i.test(p.name)) {
      const wood = texturedMat(woodTexture('#8a6744'), [0.5, 0.5], { roughness: 0.6 });
      const f = 1.2;
      g.add(box(w, d, f, wood, 0, 0, 0), box(w, d, f, wood, 0, 0, h - f), box(f, d, h, wood, -w / 2 + f / 2, 0, 0), box(f, d, h, wood, w / 2 - f / 2, 0, 0));
      g.add(box(w - 2 * f, d * 0.5, h - 2 * f, mat('#f1efe8'), 0, -d * 0.25, f));
      g.add(plane(w - 2 * f - 2.5, h - 2 * f - 2.5, face, 0, 0.02, h / 2));
    } else {
      // gallery-wrapped canvas: the picture continues around the edges
      g.add(box(w, d, h, mat(p.main_color_hex, { roughness: 0.9 }), 0, 0, 0));
      g.add(plane(w, h, face, 0, d / 2 + 0.02, h / 2));
    }
    out.object = g;
  },

  tree(p, { w, d, h }, out) {
    out.object = oliveTree(p, { w, d, h });
  },

  plant(p, { w, d, h }, out) {
    const g = group();
    const vh = h * 0.42, vr = w * 0.32;
    g.add(lathe([[0.01, 0], [vr * 0.75, 0], [vr, vh * 0.3], [vr * 0.95, vh * 0.75], [vr * 0.62, vh], [0.01, vh]], mat('#9b9c98', { roughness: 0.6 }), 28));
    g.add(lathe([[vr * 0.98, vh * 0.55], [vr * 0.95, vh * 0.75], [vr * 0.62, vh], [vr * 0.58, vh + 0.02]], mat('#efeee9', { roughness: 0.5 }), 28, { cast: false }));
    g.add(leaves(p.main_color_hex, { cx: 0, cy: 0, z0: vh + 0.7, z1: h - 0.7, rx: w / 2 - 0.7, ry: d / 2 - 0.7 }, 140, 1.4, 41)); // leaf tips stay inside the product box
    out.object = g;
  },

  raceway(p, { w, d, h }, out) {
    const m = mat(p.main_color_hex, { roughness: 0.5 });
    const geo = new THREE.CylinderGeometry(d * 0.9, d * 0.9, w, 12, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    const c = new THREE.Mesh(geo, m);
    c.scale.set(1, 1, h / d);
    c.position.set(0, -d / 2, 0);
    out.object = group(c, box(w, d, Math.min(h, 0.15), m, 0, 0, 0));
  },

  candle(p, { w, d, h }, out) {
    const g = group();
    const crop = cropOf(p);
    if (crop) {
      // Hearth & Hand jar with the label from Target's photo (off-white jar, red interior)
      const body = new THREE.MeshStandardMaterial({ map: photoTexture(photoUrl(p), crop), roughness: 0.5 });
      g.add(cyl(w / 2, w / 2 * 0.95, h, body, 0, 0, 0, 32, { open: true }));
      g.add(cyl(w / 2 - 0.15, w / 2 - 0.15, 0.05, mat('#b5372f'), 0, 0, h - 0.4, 32));
    } else {
      // perforated ceramic jar: cream with leaf-shaped cut-outs
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const ctx = c.getContext('2d'); ctx.fillStyle = p.main_color_hex; ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#6f5a44';
      for (let i = 0; i < 8; i++) for (const dy of [-6, 0, 6]) { ctx.beginPath(); ctx.ellipse(16 + i * 32 + (dy ? 5 : 0) * Math.sign(dy), 18 + Math.abs(dy), 2.2, 4.5, dy * 0.08, 0, Math.PI * 2); ctx.fill(); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      g.add(cyl(w / 2, w / 2 * 0.97, h, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), 0, 0, 0, 32, { open: true }));
      g.add(cyl(w / 2 - 0.2, w / 2 - 0.2, 0.05, mat('#efe6d5'), 0, 0, h - 0.5, 32));
    }
    g.add(cyl(w / 2 - 0.12, w / 2 - 0.12, h * 0.6, mat('#efe8da', { roughness: 0.8 }), 0, 0, 0.2, 32)); // wax
    g.add(cyl(0.05, 0.05, 0.4, mat('#222'), 0, 0, h * 0.6 + 0.2, 6));
    const flameM = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0 });
    const flame = sphere(0.22, flameM, 0, 0, h * 0.6 + 0.85, 10);
    flame.scale.z = 2.2; flame.castShadow = false;
    g.add(flame);
    out.flame = flame;
    out.object = g;
  },

  vase(p, { w, d, h }, out) {
    const glaze = mat(p.main_color_hex, { roughness: 0.25 });
    const g = group(lathe([[0.01, 0], [w / 2 * 0.9, 0], [w / 2, h * 0.08], [w / 2, h * 0.62], [w / 2 * 0.62, h * 0.86], [w / 2 * 0.72, h], [w / 2 * 0.6, h], [0.01, h * 0.9]], glaze, 6));
    out.object = g;
  },

  nightstand(p, { w, d, h }, out) {
    // Boho wood nightstand from the listing photo: open cubby on top, rattan drawer, tapered legs
    const wood = texturedMat(woodTexture(p.main_color_hex), [w / 24, h / 24], { roughness: 0.55 });
    const cane = texturedMat(caneTexture('#C9A46E'), [w / 2.5, 4], { roughness: 0.8 });
    const legH = h * 0.24, bodyH = h - legH;
    const g = group();
    g.add(box(w, d, 0.75, wood, 0, 0, h - 0.75), box(w, d, 0.75, wood, 0, 0, legH));
    g.add(box(0.75, d, bodyH, wood, -w / 2 + 0.375, 0, legH), box(0.75, d, bodyH, wood, w / 2 - 0.375, 0, legH), box(w, 0.5, bodyH, wood, 0, -d / 2 + 0.25, legH));
    g.add(box(w - 1.5, d - 1, 0.6, wood, 0, 0, legH + bodyH * 0.5));
    g.add(box(w - 1.6, 0.6, bodyH * 0.48, wood, 0, d / 2 - 0.3, legH + 0.4));
    g.add(plane(w - 3.4, bodyH * 0.48 - 2.2, cane, 0, d / 2 + 0.02, legH + 0.4 + bodyH * 0.24));
    g.add(sphere(0.55, mat('#6d5235'), 0, d / 2 + 0.3, legH + bodyH * 0.36, 10));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(taperedLeg(sx * (w / 2 - 1.5), sy * (d / 2 - 1.5), legH, 0.7, 0.45, wood, sx * 0.8, sy * 0.6));
    out.object = g;
  },

  desk(p, { w, d, h }, out) {
    const wood = texturedMat(woodTexture(p.main_color_hex), [w / 30, d / 30], { roughness: 0.5 });
    const g = group();
    const topT = 1.25;
    g.add(rbox(w, d, topT, 0.3, wood, 0, 0, h - topT));
    const pull = mat('#2a2018', { roughness: 0.5 });
    if (/3 drawers/i.test(p.name)) {
      // pedestal desk: three-drawer pedestal on the right, panel leg on the left, modesty panel
      const pw = 15;
      g.add(box(pw, d - 1, h - topT, wood, w / 2 - pw / 2 - 0.5, 0, 0));
      for (let i = 0; i < 3; i++) {
        const dz = (h - topT - 3) / 3;
        g.add(box(pw - 1.5, 0.6, dz - 0.6, wood, w / 2 - pw / 2 - 0.5, d / 2 - 0.1, 2.5 + i * dz));
        g.add(box(4, 0.5, 0.6, pull, w / 2 - pw / 2 - 0.5, d / 2 + 0.3, 2.5 + i * dz + dz / 2));
      }
      g.add(box(1.5, d - 1, h - topT, wood, -w / 2 + 1.25, 0, 0));
      g.add(box(w - pw - 3, 0.75, h * 0.45, wood, -pw / 2 + 0.5, -d / 2 + 1.5, h * 0.5));
      g.add(box(w - pw - 3, 0.6, 3.5, wood, -pw / 2 + 0.5, d / 2 - 0.5, h - topT - 3.5));
    } else {
      // mid-century writing desk: two drawers on the left, splayed tapered legs
      const apronH = 5;
      g.add(box(w - 2, d - 2, apronH, wood, 0, 0, h - topT - apronH));
      g.add(box(13, d - 2, 9, wood, -w / 2 + 7.5, 0, h - topT - 9));
      for (let i = 0; i < 2; i++) g.add(box(4, 0.5, 0.6, pull, -w / 2 + 7.5, d / 2 - 0.6, h - topT - 2.3 - i * 4.4));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(taperedLeg(sx * (w / 2 - 2.5), sy * (d / 2 - 2.5), h - topT - 1, 0.85, 0.5, wood, sx * 1.6, sy * 1.2));
    }
    out.object = g;
  },

  chair(p, { w, d, h }, out) {
    // High-back padded office chair (the listing photo shows black leather)
    const leather = mat(p.main_color_hex, { roughness: 0.42 });
    const metal = mat('#1a1a1a', { roughness: 0.4, metalness: 0.7 });
    const g = group();
    const seatZ = 19;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
      const tip = [Math.cos(a) * (w / 2 - 1.2), Math.sin(a) * (d / 2 - 1.2), 2.6];
      g.add(strut([0, 0, 4.2], tip, 0.55, metal, 6));
      g.add(sphere(1.1, metal, tip[0], tip[1], 1.1, 10));
    }
    g.add(cyl(1.1, 1.3, 3, metal, 0, 0, 3.4, 12), cyl(0.7, 0.7, seatZ - 9, metal, 0, 0, 6, 12));
    g.add(cushion(w * 0.8, d * 0.78, 4, leather, 0.2, 0, d * 0.04, seatZ - 4));
    const back = cushion(w * 0.78, 4.5, h - seatZ - 1, leather, 0.35, 0, -d / 2 + 3.2, seatZ + 1);
    back.rotation.x = -0.12;
    g.add(back);
    for (const sx of [-1, 1]) {
      g.add(strut([sx * w * 0.38, -d * 0.2, seatZ - 1], [sx * w * 0.42, -d * 0.05, seatZ + 7], 0.5, metal, 6));
      g.add(rbox(2.6, d * 0.5, 1.6, 0.6, leather, sx * w * 0.42, d * 0.05, seatZ + 7));
    }
    out.object = g;
  },

  desklamp(p, { w, d, h }, out) {
    const g = group();
    if (/tertial|work lamp/i.test(p.name)) {
      // TERTIAL: clamp on the desk's back edge, two-arm spring arm, cone shade aimed at the desk
      const gray = mat(p.main_color_hex, { roughness: 0.45, metalness: 0.5 });
      const back = -d / 2 + 1;
      g.add(box(2.2, 2.5, 2.5, gray, 0, back, 0), cyl(0.5, 0.5, 4, gray, 0, back, 2.5, 8));
      const j1 = [0, back, h * 0.65], j2 = [0, d * 0.2, h * 0.92];
      g.add(strut([0, back, 6.5], j1, 0.3, gray, 6), strut(j1, j2, 0.3, gray, 6), sphere(0.6, gray, ...j1, 8));
      const shade = shadeMat(p.main_color_hex);
      shade.metalness = 0.4; shade.roughness = 0.5;
      const c = cyl(1.1, w / 2, 6, shade, 0, 0, 0, 24, { open: true });
      c.rotation.x = 0.9; c.position.set(0, j2[1] + 1.5, j2[2] - 3.5);
      g.add(c);
      out.glow.push(shade);
    } else {
      // Crosby schoolhouse lamp: round base, brass arm with counterweight, black dome shade
      const black = mat('#1c1c1c', { roughness: 0.4, metalness: 0.5 });
      const brass = mat('#b28c56', { roughness: 0.3, metalness: 0.85 });
      g.add(cyl(w / 2 * 0.85, w / 2, 1.2, black, 0, -d / 2 + w / 2, 0, 28));
      g.add(strut([0, -d / 2 + w / 2, 1], [0, -d / 2 + w / 2, h * 0.75], 0.35, brass, 8));
      g.add(strut([0, -d / 2, h * 0.68], [0, d / 2 - 3, h * 0.78], 0.3, brass, 8), sphere(0.9, black, 0, -d / 2 + 0.5, h * 0.68, 10));
      const shade = shadeMat('#1E1E1E');
      g.add(lathe([[1.2, 4.5], [2.6, 3.8], [3.6, 1.2], [3.75, 0]], shade, 28, { open: true }));
      g.children.at(-1).position.set(0, d / 2 - 3.5, h - 5.5);
      out.glow.push(shade);
    }
    out.object = g;
  },

  hamper(p, { w, d, h }, out) {
    const g = group();
    if (/rope/i.test(p.name)) {
      const rope = texturedMat(fabricTexture(p.main_color_hex, 'boucle'), [3, 3], { roughness: 1 });
      const body = cyl(w / 2, w / 2 * 0.92, h, rope, 0, 0, 0, 32, { open: true });
      body.scale.y = d / w;
      g.add(body, cyl(w / 2 * 0.9, w / 2 * 0.9, 0.3, rope, 0, 0, 0.2, 32));
      for (const s of [-1, 1]) g.add(box(0.4, 3, 1, mat('#b0703f'), s * (w / 2 - 0.2), 0, h - 3)); // leather handles on the sides
    } else {
      const canvasM = texturedMat(fabricTexture(p.main_color_hex, 'linen'), [2, 3], { roughness: 1 });
      const wood = mat('#c9a073', { roughness: 0.6 });
      const t = 0.25;
      g.add(box(w, t, h, canvasM, 0, -d / 2 + t / 2, 0), box(w, t, h, canvasM, 0, d / 2 - t / 2, 0), box(t, d, h, canvasM, -w / 2 + t / 2, 0, 0), box(t, d, h, canvasM, w / 2 - t / 2, 0, 0), box(w, d, t, canvasM, 0, 0, 0));
      for (const s of [-1, 1]) g.add(strut([-w / 2 + 2, s * (d / 2 - 0.3), h - 1.5], [w / 2 - 2, s * (d / 2 - 0.3), h - 1.5], 0.45, wood, 8));
    }
    out.object = g;
  },

  cabinet(p, { w, d, h }, out) {
    const g = group();
    if (/black frame/i.test(p.name)) {
      // tall rattan cabinet: black frame, two cane doors over an open shelf, short legs
      const black = mat('#1b1b1b', { roughness: 0.5 });
      const rattan = texturedMat(caneTexture(p.main_color_hex), [w / 2.5, h / 5], { roughness: 0.8 });
      const legH = 6;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(1.2, 1.2, legH, black, sx * (w / 2 - 0.8), sy * (d / 2 - 0.8), 0));
      g.add(box(w, d, 1, black, 0, 0, legH), box(w, d, 1, black, 0, 0, h - 1), box(w, d, 1, black, 0, 0, legH + 14));
      for (const sx of [-1, 1]) g.add(box(1, d, h - legH, black, sx * (w / 2 - 0.5), 0, legH));
      g.add(box(w, 0.5, h - legH, black, 0, -d / 2 + 0.25, legH));
      const doorH = h - 1 - (legH + 15);
      for (const sx of [-1, 1]) {
        g.add(box(w / 2 - 1.2, 0.8, doorH, black, sx * (w / 4 - 0.1), d / 2 - 0.4, legH + 15));
        g.add(plane(w / 2 - 4, doorH - 3, rattan, sx * (w / 4 - 0.1), d / 2 + 0.03, legH + 15 + doorH / 2));
        g.add(cyl(0.35, 0.35, 0.8, mat('#b08d57', { metalness: 0.8, roughness: 0.3 }), sx * 1.2, d / 2 + 0.4, legH + 15 + doorH * 0.45, 8));
      }
    } else {
      // Rattan side table: cane door below, open top shelf, splayed legs (listing photo). Built 1"
      // shallower and shifted back so the knob and splayed legs stay inside the listed 16" depth.
      d -= 1;
      const inner = group();
      inner.position.y = -0.5;
      g.add(inner);
      const wood = texturedMat(woodTexture(p.main_color_hex), [0.6, 0.6], { roughness: 0.55 });
      const rattan = texturedMat(caneTexture('#d2ac7a'), [w / 2.5, 5], { roughness: 0.8 });
      const legH = 7, bodyH = h - legH;
      inner.add(box(w, d, 0.75, wood, 0, 0, h - 0.75), box(w, d, 0.75, wood, 0, 0, legH), box(w - 1, d - 1, 0.6, wood, 0, 0, legH + bodyH * 0.6));
      for (const sx of [-1, 1]) inner.add(box(0.75, d, bodyH, wood, sx * (w / 2 - 0.375), 0, legH));
      inner.add(box(w, 0.5, bodyH, wood, 0, -d / 2 + 0.25, legH));
      inner.add(box(w - 1.4, 0.7, bodyH * 0.6 - 0.8, wood, 0, d / 2 - 0.35, legH + 0.75));
      inner.add(plane(w - 3.6, bodyH * 0.6 - 3, rattan, 0, d / 2 + 0.03, legH + 0.75 + (bodyH * 0.6 - 0.8) / 2));
      inner.add(sphere(0.5, mat('#6d5235'), w / 2 - 2.2, d / 2 + 0.3, legH + bodyH * 0.35, 8));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) inner.add(taperedLeg(sx * (w / 2 - 1.3), sy * (d / 2 - 1.3), legH, 0.6, 0.4, wood, sx * 0.9, sy * 0.9));
    }
    out.object = g;
  },

  box(p, { w, d, h }, out) {
    out.object = group(box(w, d, h, mat(p.main_color_hex)));
  },
};

// ---------------------------------------------------------------------------------------------
function leaves(color, { cx, cy, z0, z1, rx, ry }, n, size, seed) {
  // olive leaves: narrow ellipses scattered through an ellipsoid canopy
  const geo = new THREE.PlaneGeometry(size * 0.38, size * 1.6);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, m, n);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const tmp = new THREE.Object3D();
  const silver = new THREE.Color(color).offsetHSL(0, -0.08, 0.12);
  for (let i = 0; i < n; i++) {
    const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1), k = Math.cbrt(r());
    tmp.position.set(cx + Math.cos(u) * Math.sin(v) * rx * k, cy + Math.sin(u) * Math.sin(v) * ry * k, (z0 + z1) / 2 + Math.cos(v) * ((z1 - z0) / 2) * k);
    tmp.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
    tmp.updateMatrix();
    inst.setMatrixAt(i, tmp.matrix);
    inst.setColorAt(i, r() < 0.35 ? silver : new THREE.Color(color).offsetHSL(0, 0, (r() - 0.5) * 0.08));
  }
  inst.castShadow = true;
  return inst;
}

function oliveTree(p, { w, d, h }) {
  // as in the product photo: ribbed beige pot, slim light trunk, open sprays of narrow leaves
  const g = group();
  const potH = Math.min(11, h * 0.22), potR = Math.min(w, d) * 0.26;
  g.add(lathe([[0.01, 0], [potR * 0.86, 0], [potR * 0.97, potH * 0.5], [potR, potH], [potR * 0.93, potH], [0.01, potH * 0.9]], texturedMat(stripesTexture(['#cfc3b1', '#c2b5a2'], false, 8), [1, 4], { roughness: 0.85 }), 32));
  g.add(cyl(potR * 0.9, potR * 0.9, 0.2, mat('#4a3b2c', { roughness: 1 }), 0, 0, potH - 0.8, 24));
  const bark = mat('#b48a5f', { roughness: 0.85 });
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const top = [0.4, 0.2, h * 0.97];
  const trunkAt = (z) => { const t = (z - potH) / (top[2] - potH); return [top[0] * t, top[1] * t, z]; };
  g.add(strut([0, 0, potH - 1], top, 0.45, bark, 6));
  const twigs = [[trunkAt(h * 0.55), top]];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const z = h * (0.4 + 0.47 * f);
    const a = i * 2.4 + r() * 0.6;
    const len = (w / 2) * (0.75 + 0.25 * r()) * (1 - 0.4 * f);
    const start = trunkAt(z);
    const end = [start[0] + Math.cos(a) * len, start[1] + Math.sin(a) * len * (d / w), z + h * (0.07 + 0.07 * r())];
    g.add(strut(start, end, 0.14, bark, 4));
    twigs.push([start, end]);
  }
  g.add(leafSprays(p.main_color_hex, twigs, 2.6, 23));
  return g;
}

/** Narrow olive leaves growing from the outer part of each twig ([start, end] in inches). */
function leafSprays(color, twigs, size, seed) {
  const geo = new THREE.PlaneGeometry(size * 0.2, size);
  geo.translate(0, size / 2, 0); // the leaf grows from its stem end
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide });
  const per = twigs.map(([a, b]) => Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 2.2));
  const inst = new THREE.InstancedMesh(geo, m, per.reduce((x, y) => x + y, 0));
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const tmp = new THREE.Object3D();
  const base = new THREE.Color(color);
  const silver = base.clone().offsetHSL(0, -0.1, 0.16);
  const dark = base.clone().offsetHSL(0, 0.02, -0.08);
  let k = 0;
  twigs.forEach(([a, b], ti) => {
    for (let i = 0; i < per[ti]; i++) {
      const t = 0.3 + 0.7 * r();
      tmp.position.set(a[0] + (b[0] - a[0]) * t + (r() - 0.5) * 1.2, a[1] + (b[1] - a[1]) * t + (r() - 0.5) * 1.2, a[2] + (b[2] - a[2]) * t + (r() - 0.5) * 1.2);
      tmp.rotation.set((r() - 0.5) * 2.4, (r() - 0.5) * 2.4, r() * Math.PI * 2);
      tmp.updateMatrix();
      inst.setMatrixAt(k, tmp.matrix);
      const c = r();
      inst.setColorAt(k, c < 0.35 ? silver : c < 0.7 ? base : dark);
      k++;
    }
  });
  inst.castShadow = true;
  return inst;
}

/** Procedural pleated curtain panel (used when no 3D model is available, e.g. Quince linen). */
function pleatedPanel(p, { w, d, h }, out) {
  const fabric = texturedMat(fabricTexture(p.main_color_hex, 'linen'), [w / 8, h / 8], { roughness: 1, side: THREE.DoubleSide });
  const seg = 64;
  const geo = new THREE.PlaneGeometry(1, h, seg, 4);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, h / 2);
  const pos = geo.attributes.position;
  const basePos = Float32Array.from(pos.array);
  const mesh = new THREE.Mesh(geo, fabric);
  const g = group(mesh);
  out.curtain = {
    setWidth(width, foldDepth) {
      const pleats = Math.max(3, Math.round(width / 4));
      for (let i = 0; i < pos.count; i++) {
        const u = basePos[i * 3]; // -0.5..0.5
        pos.setX(i, u * width);
        pos.setY(i, Math.sin((u + 0.5) * pleats * Math.PI * 2) * (foldDepth / 2));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    },
  };
  out.curtain.setWidth(w, 3);
  // heading tape and rings
  g.add(box(1, 0.6, 1.5, mat('#e8e4da'), 0, 0, h - 1.5));
  return g;
}

/** GINSTMOTT: take one panel from IKEA's two-panel model; the scene stretches it open/closed. */
function glbCurtain(tpl, p, item, out) {
  const panel = fitTemplate(tpl, p.id, { w: 30, d: 4, h: item.dims.h }, (c) => c.x < 0);
  const holder = group(panel);
  out.object = group(holder);
  out.curtain = {
    setWidth(width, foldDepth) {
      holder.scale.set(width / 30, foldDepth / 4, 1);
    },
  };
  out.curtain.setWidth(item.dims.w, 4);
  return finish(out);
}

/** Duvet over the queen mattress: top over the bed, sides draping (w - mattress)/2, folded back at the head. */
function duvet(p, dims, bed) {
  const mt = bed?.mattress ?? { w: 60, l: 80, top_z: 22 };
  const fabric = texturedMat(fabricTexture(p.main_color_hex, 'linen'), [6, 6], { roughness: 1, side: THREE.DoubleSide });
  const g = group();
  // dims: w across the bed, d along the bed (local +y toward the foot), z0 = item base (8" in the spec)
  const top = mt.top_z - 8; // mattress top above the item base
  const L = dims.d, W = Math.min(dims.w, mt.w + 4);
  const thick = 1.2;
  g.add(rbox(W, L, thick, 0.9, fabric, 0, 0, top));
  const drop = top + thick; // the sides hang to the bottom of the slot's placement box (room-spec bbox)
  for (const s of [-1, 1]) {
    const side = rbox(0.8, L, drop, 0.35, fabric, s * (W / 2 - 0.2), 0, top + thick - drop);
    g.add(side);
  }
  const footDrop = Math.max(0, Math.min(p.dimensions_in.d - L - 18, top));
  if (footDrop > 0.5) g.add(rbox(W, 0.8, footDrop, 0.35, fabric, 0, L / 2 - 0.2, top + thick - footDrop));
  // folded-back roll at the head
  const roll = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, W - 3, 6, 16), fabric);
  roll.rotation.z = Math.PI / 2; roll.position.set(0, -L / 2 + 1.6, top + thick - 0.5);
  g.add(roll);
  // two pillowcases from the set, on the pillows at the head
  for (const s of [-1, 1]) {
    const pil = cushion(26, 18, 6, fabric, 0.35, s * 14, -L / 2 - 6, top - 0.5);
    pil.rotation.x = 0.35;
    pil.userData.setPiece = true; // part of the set but outside the duvet's own placement box
    g.add(pil);
  }
  return g;
}
