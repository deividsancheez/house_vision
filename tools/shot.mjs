// Dev helper: node tools/shot.mjs <outDir> <name> [query] [w] [h] [js-to-run]
import { chromium } from '@playwright/test';
const [outDir, name, query = '', w = '1280', h = '800', js = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await p.goto(`http://localhost:5199/?${query}`);
await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 }).catch(() => logs.push('not ready'));
await p.evaluate(() => window.__app?.loading).catch(() => {});
await p.waitForTimeout(1500);
if (js) { console.log('js ->', JSON.stringify(await p.evaluate(js))); await p.waitForTimeout(1200); }
await p.screenshot({ path: `${outDir}/${name}.png` });
console.log(logs.join('\n') || 'no console errors');
await b.close();
