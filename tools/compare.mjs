// Renders every photo-matched preset and puts it next to the photo: <outDir>/compare-<id>.jpg
// node tools/compare.mjs <outDir> [mode=day] [port=5199]
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import { PRESETS } from '../src/scene/views.js';
const [outDir, mode = 'day', port = '5199'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1024, height: 768 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const pr of PRESETS) {
  await p.goto(`http://localhost:${port}/?clean&room=${pr.room}&view=${pr.id}`);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 });
  await p.evaluate(async (m) => { const a = window.__app; await a.loading; if (m !== a.mode) a.setMode(m); a.applyPreset(new URLSearchParams(location.search).get('view'), false); }, mode);
  await p.waitForTimeout(1500);
  const shot = await p.screenshot();
  const photo = await sharp(`../photos/${pr.id}.jpg`).resize(1024, 768).toBuffer();
  const label = (t) => Buffer.from(`<svg width="1024" height="40"><rect width="100%" height="100%" fill="#1f1d1a"/><text x="14" y="27" font-size="20" fill="#fff" font-family="Arial">${t}</text></svg>`);
  await sharp({ create: { width: 2058, height: 808, channels: 3, background: '#1f1d1a' } })
    .composite([{ input: label(`Photo: ${pr.id}`), left: 0, top: 0 }, { input: photo, left: 0, top: 40 }, { input: label(`App: ${pr.label} (facing ${pr.facing}), ${mode}, fit ${pr.fitPx}px`), left: 1034, top: 0 }, { input: shot, left: 1034, top: 40 }])
    .jpeg({ quality: 82 }).toFile(`${outDir}/compare-${pr.id}${mode === 'day' ? '' : '-' + mode}.jpg`);
  console.log('ok', pr.id);
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await b.close();
