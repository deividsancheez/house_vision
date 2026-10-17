// The deployed app is public: nothing from photos/ or plans/ (they show the home and its address) may
// be in the build, and the app must not load anything from other sites (no IKEA hot-linking).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { root, products } from './helpers.js';

const dist = path.join(root, 'dist');
const handoff = path.resolve(root, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('the build contains no photos, plans or address', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'file check runs once');
  expect(fs.existsSync(dist), 'run npm run build first').toBe(true);
  const files = walk(dist);
  const rel = files.map((f) => path.relative(dist, f).replace(/\\/g, '/'));
  expect(rel.filter((f) => /^(photos|plans)\//.test(f) || /(^|\/)(photos|plans)\//.test(f))).toEqual([]);

  // no copy of any private file, by name or by content
  const privateFiles = ['photos', 'plans'].flatMap((d) => walk(path.join(handoff, d)));
  const names = new Set(privateFiles.map((f) => path.basename(f)));
  expect(rel.filter((f) => names.has(path.basename(f)))).toEqual([]);
  const sizes = new Map(privateFiles.map((f) => [fs.statSync(f).size, f]));
  for (const f of files) {
    const st = fs.statSync(f);
    if (sizes.has(st.size)) expect(Buffer.compare(fs.readFileSync(f), fs.readFileSync(sizes.get(st.size))), `${f} is a copy of a private file`).not.toBe(0);
  }
  // the address on the floor plan appears nowhere in the build. The words to look for are kept in a
  // local file that is never committed (tests/e2e/private-words.txt, one per line), so this public
  // code doesn't contain them either.
  const wordsFile = path.join(root, 'tests', 'e2e', 'private-words.txt');
  const words = fs.existsSync(wordsFile) ? fs.readFileSync(wordsFile, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean) : [];
  if (!words.length) test.info().annotations.push({ type: 'note', description: 'no tests/e2e/private-words.txt: address check skipped' });
  for (const f of files.filter((x) => /\.(html|js|json|css|txt|md|svg)$/i.test(x))) {
    const text = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const w of words) expect(text.includes(w), `${f} mentions "${w}"`).toBe(false);
  }
  // the product photos that ship are exactly the 49 product images
  const shipped = rel.filter((f) => f.startsWith('product-images/'));
  expect(shipped.length).toBe(products.products.length);
  for (const p of products.products) expect(shipped).toContain(`product-images/${p.id}.jpg`);
  // the 8 IKEA models are stored with the app
  expect(rel.filter((f) => f.startsWith('models/') && f.endsWith('.glb')).length).toBe(8);
});
