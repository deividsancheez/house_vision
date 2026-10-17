// Checks a deployed copy of the app: it loads, shows the designer's budget, both rooms and night mode
// work, every model loads and nothing errors. node tools/smoke-live.mjs <url> <outDir>
import { chromium } from '@playwright/test';
const [url, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errors = [], failed = [], hosts = new Set();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('requestfailed', (r) => failed.push(r.url()));
  p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  p.on('request', (r) => hosts.add(new URL(r.url()).host));
  await p.goto(url);
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  await p.evaluate(() => window.__app.whenLoaded());
  const total = await p.locator('[data-testid="budget-total"]').textContent();
  await p.screenshot({ path: `${out}/live-${name}-living.png` });
  await p.evaluate(async () => { await window.__app.setRoom('bedroom'); await window.__app.whenLoaded(); window.__app.setMode('night'); });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/live-${name}-bedroom-night.png` });
  const models = await p.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/models/') && r.name.endsWith('.glb')).length);
  console.log(JSON.stringify({ device: name, total, models, errors, failed, hosts: [...hosts] }));
  await ctx.close();
}
await b.close();
