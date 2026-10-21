// Downloads each IKEA .glb listed in products.json ("model_3d_url") ONCE:
//   ../products.json (the 3D plan)                -> assets-src/models/
//   ../../Lookbook Handoff/products.json (new ids) -> assets-src/lookbook-models/
// The live app never contacts IKEA: build-assets.mjs compresses these files into public/.
// Lookbook products that are also in the 3D plan use the 3D plan's model (the 3D file wins for the
// 3D model), so only the new LB-... ids are fetched for the lookbook.
// Run: npm run fetch-models   (re-downloads only files that are missing; pass --force to refresh)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const handoff = path.resolve(root, '..');
const lookbookDir = path.resolve(handoff, '..', 'Lookbook Handoff');
const force = process.argv.includes('--force');

const products = JSON.parse(fs.readFileSync(path.join(handoff, 'products.json'), 'utf8')).products;
await fetchAll(products, path.join(root, 'assets-src', 'models'), { strict: true });

if (fs.existsSync(path.join(lookbookDir, 'products.json'))) {
  const ids3d = new Set(products.map((p) => p.id));
  const lb = JSON.parse(fs.readFileSync(path.join(lookbookDir, 'products.json'), 'utf8')).products.filter((p) => !ids3d.has(p.id));
  await fetchAll(lb, path.join(root, 'assets-src', 'lookbook-models'), { strict: false });
}

/**
 * Several products can share one model URL (the same curtain is used in both rooms), so files are
 * keyed by URL and a manifest maps every product id to its file. strict: a failed download stops
 * the run; otherwise it is listed and that product gets the model built from its size and color.
 */
async function fetchAll(list, outDir, { strict }) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {};
  const byUrl = new Map();
  for (const p of list) {
    if (!p.model_3d_url) continue;
    if (!byUrl.has(p.model_3d_url)) byUrl.set(p.model_3d_url, `${p.id}.glb`);
    manifest[p.id] = byUrl.get(p.model_3d_url);
  }
  const failed = [];
  for (const [url, file] of byUrl) {
    const dest = path.join(outDir, file);
    if (fs.existsSync(dest) && !force) { console.log('have', file); continue; }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${file}: ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error(`${file} is not a binary glTF file`);
      fs.writeFileSync(dest, buf);
      console.log('downloaded', file, (buf.length / 1024).toFixed(0) + ' KB');
    } catch (err) {
      if (strict) throw err;
      failed.push(`${file}: ${err.message}`);
    }
  }
  for (const [id, file] of Object.entries(manifest)) if (!fs.existsSync(path.join(outDir, file))) delete manifest[id];
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${path.basename(outDir)}: ${Object.keys(manifest).length} products with a stored model`);
  if (failed.length) console.warn(`Not downloaded (these use the model built from size and color):\n  ${failed.join('\n  ')}`);
}
