// Downloads each IKEA .glb listed in products.json ("model_3d_url") ONCE into assets-src/models/.
// The live app never contacts IKEA: build-assets.mjs compresses these files into public/models/.
// Run: npm run fetch-models   (re-downloads only files that are missing; pass --force to refresh)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const handoff = path.resolve(root, '..');
const outDir = path.join(root, 'assets-src', 'models');
const force = process.argv.includes('--force');

const products = JSON.parse(fs.readFileSync(path.join(handoff, 'products.json'), 'utf8')).products;
fs.mkdirSync(outDir, { recursive: true });

// Several products can share one model URL (the same curtain is used in both rooms),
// so files are keyed by URL and a manifest maps every product id to its file.
const manifest = {};
const byUrl = new Map();
for (const p of products) {
  if (!p.model_3d_url) continue;
  if (!byUrl.has(p.model_3d_url)) byUrl.set(p.model_3d_url, `${p.id}.glb`);
  manifest[p.id] = byUrl.get(p.model_3d_url);
}

for (const [url, file] of byUrl) {
  const dest = path.join(outDir, file);
  if (fs.existsSync(dest) && !force) { console.log('have', file); continue; }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${file}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error(`${file} is not a binary glTF file`);
  fs.writeFileSync(dest, buf);
  console.log('downloaded', file, (buf.length / 1024).toFixed(0) + ' KB');
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('manifest:', manifest);
