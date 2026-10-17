// Dev helper (Walk mode): node tools/walkdev.mjs <outDir> <w> <h> <touch 0|1> <steps.json>; needs npx vite --port 5199
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [outDir, w = '1280', h = '800', touch = '0', stepsFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, ...(touch === '1' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const p = await ctx.newPage();
const logs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await p.goto(`http://localhost:5199/?${steps.query ?? 'tutorial=0&mode=walk'}`);
await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 });
await p.evaluate(() => window.__app.whenLoaded());
await p.waitForTimeout(800);
for (const s of steps.steps) {
  if (s.js) { const r = await p.evaluate(s.js); if (r !== undefined) console.log(s.name || 'js', '->', typeof r === 'string' ? r : JSON.stringify(r)); }
  if (s.key) await p.keyboard.press(s.key);
  if (s.hold) { await p.keyboard.down(s.hold); await p.waitForTimeout(s.ms || 500); await p.keyboard.up(s.hold); }
  if (s.click) await p.click(s.click);
  if (s.wait) await p.waitForTimeout(s.wait);
  if (s.shot) await p.screenshot({ path: `${outDir}/${s.shot}.png` });
}
console.log(logs.join('\n') || 'no console errors');
await b.close();
