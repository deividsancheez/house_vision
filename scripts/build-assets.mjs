// Prepares everything the web app serves, from the hand-off folder:
//   ../room-spec.json, ../products.json      -> public/data/          (copied as-is)
//   ../product-images/<id>.jpg              -> public/product-images/ (same names, resized + recompressed)
//   assets-src/models/*.glb (from fetch-models) -> public/models/     (Draco geometry, WebP textures)
// It never reads ../photos or ../plans: those show the home and its address and must not be published.
// Run: npm run assets   (also runs automatically before `npm run dev` and `npm run build`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, draco, resample, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const handoff = path.resolve(root, '..');
const pub = path.join(root, 'public');
const force = process.argv.includes('--force');

const newer = (src, dest) => force || !fs.existsSync(dest) || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// 1) data -----------------------------------------------------------------------------------------
fs.mkdirSync(path.join(pub, 'data'), { recursive: true });
const products = JSON.parse(fs.readFileSync(path.join(handoff, 'products.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(handoff, 'room-spec.json'), 'utf8')); // fail loudly if broken
for (const f of ['room-spec.json', 'products.json']) fs.copyFileSync(path.join(handoff, f), path.join(pub, 'data', f));
console.log('data: copied room-spec.json and products.json');

// 2) product photos ------------------------------------------------------------------------------
const imgOut = path.join(pub, 'product-images');
fs.mkdirSync(imgOut, { recursive: true });
const missing = [];
let imgBytes = 0;
for (const p of products.products) {
  const rel = p.image_file || `product-images/${p.id}.jpg`;
  const src = path.join(handoff, rel);
  if (!fs.existsSync(src)) { missing.push(`${p.id}: ${rel}`); continue; }
  const dest = path.join(pub, rel);
  if (newer(src, dest)) {
    await sharp(src).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(dest);
  }
  imgBytes += fs.statSync(dest).size;
}
if (missing.length) throw new Error(`Missing product photos:\n  ${missing.join('\n  ')}`);
console.log(`images: ${products.products.length} photos, ${kb(imgBytes)} total`);

// 3) 3D models -----------------------------------------------------------------------------------
const srcModels = path.join(root, 'assets-src', 'models');
const outModels = path.join(pub, 'models');
fs.mkdirSync(outModels, { recursive: true });
const manifestPath = path.join(srcModels, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const needModels = products.products.filter((p) => p.model_3d_url).map((p) => p.id);
const lacking = needModels.filter((id) => !manifest[id] || !fs.existsSync(path.join(srcModels, manifest[id])));
if (lacking.length) throw new Error(`3D models not downloaded yet for ${lacking.join(', ')}. Run: npm run fetch-models`);

// Texture budget per model (px, longest side). Art keeps more detail; fabrics and wood tile fine at 512.
const TEXTURE_SIZE = { 'BR-ART-A': 1024, 'BR-ART-B': 1024 };
const MAX_TRIANGLES = 40000;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;

// Scanned meshes (the FLINTAN chair) are full of UV seams that block regular simplification;
// meshopt's 'sloppy' mode ignores topology and gets them to the triangle budget for phones.
function sloppySimplify(maxTris) {
  return (doc) => {
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    const total = prims.reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
    if (total <= maxTris) return;
    for (const prim of prims) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const target = Math.floor((idx.getCount() * maxTris) / total / 3) * 3;
      const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), Float32Array.from(pos.getArray()), 3, null, target, 0.01);
      idx.setArray(out);
      compactPrimitive(prim);
    }
  };
}

for (const file of [...new Set(Object.values(manifest))]) {
  const src = path.join(srcModels, file);
  const dest = path.join(outModels, file);
  if (!newer(src, dest)) { console.log(`model: ${file} up to date (${kb(fs.statSync(dest).size)})`); continue; }
  const doc = await io.read(src);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const prim of m.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  const id = file.replace(/\.glb$/, '');
  const steps = [dedup(), prune(), resample()];
  if (tris > MAX_TRIANGLES) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIANGLES / tris, error: 0.02 }), sloppySimplify(MAX_TRIANGLES));
  const size = TEXTURE_SIZE[id] ?? 512;
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 80 }));
  steps.push(draco({ method: 'edgebreaker', quantizePosition: 14 }));
  await doc.transform(...steps);
  await io.write(dest, doc);
  let after = 0;
  for (const m of doc.getRoot().listMeshes()) for (const prim of m.listPrimitives()) after += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  console.log(`model: ${file} ${kb(fs.statSync(src).size)} -> ${kb(fs.statSync(dest).size)}, triangles ${tris} -> ${after}`);
}
fs.writeFileSync(path.join(outModels, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4) Draco decoder (served locally so the app never depends on another site) --------------------
const dracoSrc = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
fs.mkdirSync(path.join(pub, 'draco'), { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) fs.copyFileSync(path.join(dracoSrc, f), path.join(pub, 'draco', f));

// 5) privacy guard --------------------------------------------------------------------------------
const privateNames = new Set([...fs.readdirSync(path.join(handoff, 'photos')), ...fs.readdirSync(path.join(handoff, 'plans'))]);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
const leaked = walk(pub).filter((n) => privateNames.has(n));
if (leaked.length) throw new Error(`Private photo/plan files found in public/: ${leaked.join(', ')}`);
console.log('privacy: no room photos or floor plans in public/');
