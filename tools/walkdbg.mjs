// Dev helper: run a snippet in Walk mode on the dev server and print what it returns.
// node tools/walkdbg.mjs "<async js using a = window.__app>" [phone]   (needs npx vite --port 5199)
import { chromium } from '@playwright/test';
const [code, phone] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(phone ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await p.goto('http://localhost:5199/?mode=walk&tutorial=0');
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
const frames = 'const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));';
console.log(JSON.stringify(await p.evaluate(`(async () => { const a = window.__app; ${frames} ${code} })()`), null, 1));
await b.close();
