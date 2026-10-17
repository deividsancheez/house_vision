// Materials and small procedural textures (planks, chenille, weaves, wood grain, cane).
// Colors always come from the JSON hex values; the textures only add surface detail.
import * as THREE from 'three';

const cache = new Map();
let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = Math.min(8, n); }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Deterministic pseudo-random so textures look the same on every load.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** sRGB bytes of a JSON hex color (canvas pixels are sRGB, so no linear conversion here). */
function hexToRgb(hex) {
  const v = new THREE.Color(hex).getHex(THREE.SRGBColorSpace);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const shade = ([r, g, b], f) => `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;

function toTexture(c, repeatInches, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.userData.repeatInches = repeatInches; // texture covers this many inches (used by planar UVs)
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Light gray-washed oak-look planks. One tile = 4 planks (7.25" wide) by 48" long. */
export function plankTexture(hex) {
  return cached(`plank${hex}`, () => {
    const W = 1024, H = 512; // 48" x 29" tile: 4 planks
    const c = canvas(W, H), g = c.getContext('2d');
    const base = hexToRgb(hex);
    const r = rng(7);
    const rows = 4, rh = H / rows;
    for (let row = 0; row < rows; row++) {
      const offset = (row * 0.37 % 1) * W;
      const plankLen = W; // 48" planks; one plank per tile width keeps the tile seamless
      for (let x0 = offset - Math.ceil(offset / plankLen) * plankLen; x0 < W; x0 += plankLen) {
        const f = 0.93 + r() * 0.14;
        g.fillStyle = shade(base, f);
        g.fillRect(x0, row * rh, plankLen, rh);
        // grain streaks along the plank
        for (let i = 0; i < 40; i++) {
          const y = row * rh + r() * rh;
          g.strokeStyle = shade(base, f * (0.9 + r() * 0.16));
          g.globalAlpha = 0.25 + r() * 0.3;
          g.lineWidth = 0.6 + r() * 1.6;
          g.beginPath();
          g.moveTo(x0, y);
          const len = plankLen;
          for (let s = 0; s <= 12; s++) g.lineTo(x0 + (len * s) / 12, y + Math.sin(s * 0.9 + i) * (1 + r() * 2));
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = shade(base, 0.72);
        g.fillRect(x0, row * rh, 2, rh); // end joint
      }
      g.fillStyle = shade(base, 0.7);
      g.fillRect(0, row * rh, W, 2); // long joint
    }
    return toTexture(c, { u: 48, v: 29 });
  });
}

/** Soft noise for upholstery (chenille, boucle, linen). */
export function fabricTexture(hex, kind = 'linen') {
  return cached(`fab${hex}${kind}`, () => {
    const S = 256;
    const c = canvas(S, S), g = c.getContext('2d');
    const base = hexToRgb(hex);
    g.fillStyle = shade(base, 1);
    g.fillRect(0, 0, S, S);
    const r = rng(kind.length * 97 + base[0]);
    if (kind === 'linen') {
      for (let i = 0; i < S; i += 2) {
        g.fillStyle = shade(base, 0.92 + r() * 0.14); g.globalAlpha = 0.55; g.fillRect(0, i, S, 1);
        g.fillStyle = shade(base, 0.92 + r() * 0.14); g.fillRect(i, 0, 1, S);
      }
    } else {
      const n = kind === 'boucle' ? 2600 : 1800;
      for (let i = 0; i < n; i++) {
        g.globalAlpha = 0.35;
        g.fillStyle = shade(base, 0.8 + r() * 0.4);
        const x = r() * S, y = r() * S, rad = kind === 'boucle' ? 1.5 + r() * 2.5 : 0.8 + r() * 1.5;
        g.beginPath(); g.ellipse(x, y, rad * (kind === 'chenille' ? 2.2 : 1), rad, 0, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    return toTexture(c, { u: kind === 'linen' ? 6 : 10, v: kind === 'linen' ? 6 : 10 });
  });
}

export function woodTexture(hex, grain = 'straight') {
  return cached(`wood${hex}${grain}`, () => {
    const W = 512, H = 512;
    const c = canvas(W, H), g = c.getContext('2d');
    const base = hexToRgb(hex);
    g.fillStyle = shade(base, 1); g.fillRect(0, 0, W, H);
    const r = rng(base[1] * 13 + 5);
    for (let i = 0; i < 90; i++) {
      const y = r() * H;
      g.strokeStyle = shade(base, 0.78 + r() * 0.35);
      g.globalAlpha = 0.25 + r() * 0.35;
      g.lineWidth = 0.8 + r() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let s = 0; s <= 16; s++) g.lineTo((W * s) / 16, y + Math.sin(s * 0.7 + i * 1.3) * (grain === 'figured' ? 9 : 3));
      g.stroke();
    }
    g.globalAlpha = 1;
    return toTexture(c, { u: 30, v: 30 });
  });
}

/** Rattan cane webbing (octagon weave) on a light frame color. */
export function caneTexture(hex) {
  return cached(`cane${hex}`, () => {
    const S = 256;
    const c = canvas(S, S), g = c.getContext('2d');
    const base = hexToRgb(hex);
    g.fillStyle = shade(base, 0.42); g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    const step = 16;
    const lines = (dx, dy, f) => {
      g.strokeStyle = shade(base, f); g.lineWidth = 3.2;
      for (let k = -S; k < 2 * S; k += step) {
        g.beginPath();
        if (dx === 0) { g.moveTo(k, 0); g.lineTo(k, S); }
        else if (dy === 0) { g.moveTo(0, k); g.lineTo(S, k); }
        else { g.moveTo(k, 0); g.lineTo(k + S * dx, S * dy); }
        g.stroke();
      }
    };
    lines(0, 1, 1.1); lines(1, 0, 1.05); g.lineWidth = 2; lines(1, 1, 1.18); lines(-1, 1, 1.18);
    return toTexture(c, { u: 2.5, v: 2.5 });
  });
}

/** Woven rattan (basket weave) for lamp shades and lanterns. */
export function weaveTexture(hex) {
  return cached(`weave${hex}`, () => {
    const S = 128;
    const c = canvas(S, S), g = c.getContext('2d');
    const base = hexToRgb(hex);
    g.fillStyle = shade(base, 0.55); g.fillRect(0, 0, S, S);
    const cell = 16;
    for (let y = 0; y < S; y += cell) for (let x = 0; x < S; x += cell) {
      const horiz = ((x + y) / cell) % 2 === 0;
      g.fillStyle = shade(base, horiz ? 1.12 : 0.95);
      if (horiz) g.fillRect(x + 1, y + 3, cell - 2, cell - 6); else g.fillRect(x + 3, y + 1, cell - 6, cell - 2);
    }
    return toTexture(c, { u: 3, v: 3 });
  });
}

export function stripesTexture(colors, vertical = true, px = 8) {
  return cached(`str${colors}${vertical}${px}`, () => {
    const S = 128;
    const c = canvas(S, S), g = c.getContext('2d');
    for (let i = 0; i < S; i += px) {
      g.fillStyle = colors[(i / px) % colors.length];
      if (vertical) g.fillRect(i, 0, px, S); else g.fillRect(0, i, S, px);
    }
    return toTexture(c, { u: 4, v: 4 });
  });
}

/** Material helper with sensible defaults. */
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
}

/** Material from a texture that already carries the JSON color (generated textures are tinted at creation). */
export function texturedMat(tex, repeat = [1, 1], opts = {}) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.85, metalness: 0, ...opts });
}

// ---------------------------------------------------------------------------------------------
// Product photos (product-images/<id>.jpg) as textures, optionally cropped.
const loader = new THREE.ImageLoader();
const imageCache = new Map();
export function loadImage(url) {
  if (!imageCache.has(url)) imageCache.set(url, new Promise((res, rej) => loader.load(url, res, undefined, () => rej(new Error(`Could not load ${url}`)))));
  return imageCache.get(url);
}

/** A texture made from a crop of a product photo: crop = [x0, y0, x1, y1] in 0..1 of the image. */
export function photoTexture(url, crop = [0, 0, 1, 1], { size = 512, repeat = false } = {}) {
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.userData.ready = loadImage(url).then((img) => {
    const [x0, y0, x1, y1] = crop;
    const sw = (x1 - x0) * img.width, sh = (y1 - y0) * img.height;
    const scale = Math.min(1, size / Math.max(sw, sh));
    const c = canvas(Math.max(4, Math.round(sw * scale)), Math.max(4, Math.round(sh * scale)));
    c.getContext('2d').drawImage(img, x0 * img.width, y0 * img.height, sw, sh, 0, 0, c.width, c.height);
    tex.image = c;
    tex.needsUpdate = true;
    return tex;
  }).catch(() => tex);
  return tex;
}

/** Average color of a photo crop (used to tint generated textures toward the real product). */
export async function photoColor(url, crop) {
  const img = await loadImage(url);
  const [x0, y0, x1, y1] = crop;
  const c = canvas(16, 16), g = c.getContext('2d');
  g.drawImage(img, x0 * img.width, y0 * img.height, (x1 - x0) * img.width, (y1 - y0) * img.height, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return new THREE.Color(`rgb(${(r / n) | 0},${(gg / n) | 0},${(b / n) | 0})`);
}

/** Planar UVs in inches for a geometry built in room units, so tiling textures stay true to scale. */
export function planarUV(geometry, axisU = 'x', axisV = 'y', inchesPerTile = { u: 48, v: 48 }) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos[`get${axisU.toUpperCase()}`](i) / inchesPerTile.u;
    uv[i * 2 + 1] = pos[`get${axisV.toUpperCase()}`](i) / inchesPerTile.v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Box UVs in inches (each face mapped on its own plane). */
export function boxUVInches(geometry, inchesPerTile = 24) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (nz >= nx && nz >= ny) { u = x; v = y; } else if (nx >= ny) { u = y; v = z; } else { u = x; v = z; }
    uv[i * 2] = u / inchesPerTile; uv[i * 2 + 1] = v / inchesPerTile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
