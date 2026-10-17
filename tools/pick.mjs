// Dev helper: focus each item, click it, report what got selected. node tools/pick.mjs <outDir> <room> <key>...
import { chromium } from '@playwright/test';
const [out, room, ...keys] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`http://localhost:5199/?room=${room}`);
await p.waitForFunction(() => document.body.classList.contains('ready'));
await p.evaluate(() => window.__app.whenLoaded());
for (const k of keys) {
  await p.evaluate((k) => { __app.select(null); __app.focus(k); }, k);
  await p.waitForTimeout(900);
  const pos = await p.evaluate((k) => __app.screenOf(k), k);
  await p.mouse.click(pos.x, pos.y);
  await p.waitForTimeout(200);
  const sel = await p.evaluate(() => __app.selected);
  console.log(k, JSON.stringify(pos), '->', sel);
  await p.evaluate((pos) => { const d = document.createElement('div'); d.id='dot'; d.style.cssText = `position:fixed;left:${pos.x-6}px;top:${pos.y-6}px;width:12px;height:12px;border-radius:6px;background:red;z-index:99`; document.body.append(d); }, pos);
  await p.screenshot({ path: `${out}/pick-${k.replace('#','_')}.png` });
  await p.evaluate(() => document.getElementById('dot').remove());
}
await b.close();
