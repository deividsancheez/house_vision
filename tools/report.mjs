// Builds the local test report: test-report/index.html (+ screenshots and photo comparisons).
// PRIVATE: the report shows the home photos next to the app. It is git-ignored; never upload it.
// Inputs: test-results/ (Playwright JSON, per-product records, perf, links, unit TAP output),
// test-report/compare/ (tools/compare.mjs), ../room-spec.json, ../products.json.
// node tools/report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../src/scene/views.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = (...p) => path.join(root, ...p);
const out = R('test-report');
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const spec = readJson(R('../room-spec.json'));
const products = readJson(R('../products.json'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

// ---- Playwright results
const pw = readJson(R('test-results/results.json'), { suites: [] });
const perfPw = readJson(R('test-results/results-perf.json'), { suites: [] });
const tests = [];
const walk = (s, file) => {
  for (const x of s.suites || []) walk(x, x.file || file);
  for (const sp of s.specs || []) for (const t of sp.tests) {
    const res = t.results.at(-1);
    tests.push({ file: (sp.file || file || '').replace(/^.*[\\/]/, ''), title: sp.title, project: t.projectName, status: t.status === 'skipped' ? 'skipped' : res?.status, ms: res?.duration, error: res?.error?.message?.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0] });
  }
};
walk(pw); walk(perfPw);
const ran = tests.filter((t) => t.status !== 'skipped');
const passed = ran.filter((t) => t.status === 'passed').length;

// ---- unit tests (TAP)
const tap = fs.existsSync(R('test-results/unit.tap')) ? fs.readFileSync(R('test-results/unit.tap'), 'utf8') : '';
const unit = [...tap.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].filter((m) => !/^tests[\\/]/.test(m[2]) && !/\.test\.mjs$/.test(m[2])).map((m) => ({ ok: m[1] === 'ok', name: m[2] }));

// ---- per-product records
const prodDir = R('test-results/products');
const prodRecs = fs.existsSync(prodDir) ? fs.readdirSync(prodDir).flatMap((f) => readJson(path.join(prodDir, f))) : [];
const links = readJson(R('test-results/links.json'), []);
const perf = fs.existsSync(R('test-results/perf')) ? fs.readdirSync(R('test-results/perf')).map((f) => readJson(R('test-results/perf', f))) : [];

// ---- copy screenshots
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
const shotsSrc = R('test-results/shots');
const shots = fs.existsSync(shotsSrc) ? fs.readdirSync(shotsSrc).filter((f) => f.endsWith('.png')) : [];
for (const f of shots) fs.copyFileSync(path.join(shotsSrc, f), path.join(out, 'shots', f));

// ---- ESTIMATED values
const est = [];
const walkEst = (o, p) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkEst(v, `${p}${Array.isArray(o) ? `[${v?.id ?? k}]` : `.${k}`}`);
  else if (typeof o === 'string' && /ESTIMATED/.test(o) && !/estimated_flag|source_of_truth/.test(p)) est.push(p.replace(/^\./, ''));
};
walkEst(spec, '');
const prodEst = products.products.filter((p) => p.dimensions_estimated?.length).map((p) => `${p.id}: ${p.dimensions_estimated.join(', ')} (${p.dimensions_source || ''})`);

const statusCell = (s) => `<td class="${s === 'passed' || s === 'ok' ? 'ok' : s === 'skipped' ? 'skip' : 'bad'}">${esc(s)}</td>`;
const verdictClass = (v) => (/right product|search page/.test(v) ? 'ok' : /blocked|check by hand/.test(v) ? 'warn' : 'bad');

const desk = (id) => prodRecs.find((r) => r.product === id && r.project === 'desktop');
const productRows = products.products.map((p) => {
  const r = desk(p.id) || {};
  const sz = (r.sizes || []).filter((s) => !s.hidden).map((s) => `${s.got.w}×${s.got.d}×${s.got.h}`).join('<br>') || (r.sizes?.length ? 'not drawn (insert)' : '');
  const want = (r.sizes || []).find((s) => s.want)?.want;
  const l = links.find((x) => x.id === p.id && x.kind === 'buy');
  const b = links.find((x) => x.id === p.id && x.kind === 'backup');
  return `<tr><td><img src="../public/product-images/${esc(p.id)}.jpg" alt=""></td><td><b>${esc(p.id)}</b><br>${esc(p.name)}</td>
    <td>${p.model_3d_url ? 'IKEA model' : 'built'}</td>
    <td>${want ? `${want.w}×${want.d}×${want.h}` : ''}</td><td>${sz}</td>
    <td class="${r.swap ? 'ok' : 'bad'}">${esc(r.swap || '—')}</td><td class="${r.select ? 'ok' : 'bad'}">${esc(r.select ? (r.select === 'ok' ? 'click' : 'Items list') : '—')}</td>
    <td class="${r.move ? 'ok' : r.sizes?.[0]?.hidden ? 'skip' : 'bad'}">${esc(r.move || (r.sizes?.[0]?.hidden ? 'n/a' : '—'))}</td>
    <td class="${r.rotate ? (/blocked/.test(r.rotate) ? 'warn' : 'ok') : r.sizes?.[0]?.hidden ? 'skip' : 'bad'}">${esc(r.rotate ? r.rotate.replace('rotate-', '') : r.sizes?.[0]?.hidden ? 'n/a' : '—')}</td>
    <td class="${r.remove ? 'ok' : 'bad'}">${esc(r.remove || '—')}</td>
    <td class="${r.buy ? 'ok' : 'bad'}">${r.buy ? 'opens buy_url' : '—'}${r.backup ? ' + backup' : ''}</td>
    <td class="${l ? verdictClass(l.verdict) : ''}">${esc(l?.verdict || '')}${l?.title ? `<br><small>${esc(l.title)}</small>` : ''}${b ? `<br><small>backup: ${esc(b.verdict)}</small>` : ''}</td></tr>`;
}).join('\n');

// ---- budget combos (recomputed the same way the test does)
const byId = new Map(products.products.map((p) => [p.id, p]));
const total = (opts) => { let t = 0, u = 0; for (const s of products.slots) { const pid = s.slot_id in opts ? opts[s.slot_id] : s.default_option; if (!pid) continue; const p = byId.get(pid); const c = Math.round(p.price * 100) * (p.qty ?? 1); if (p.taxed) t += c; else u += c; } const tax = Math.floor((t * 975 + 5000) / 10000); return { t, tax, u, total: t + tax + u }; };
const combos = [['Designer\'s layout', {}], ['Rug B + desk B', { 'LR-RUG': 'LR-RUG-B', 'BR-DESK': 'BR-DESK-B' }], ['Bedroom budget picks (nightstand B, chair B, desk lamp B)', { 'BR-NIGHTSTAND': 'BR-NIGHTSTAND-B', 'BR-CHAIR': 'BR-CHAIR-B', 'BR-DESKLAMP': 'BR-DESKLAMP-B' }], ['Living alternates (floor lamp B, sconce B, curtain B, art B)', { 'LR-FLOORLAMP': 'LR-FLOORLAMP-B', 'LR-SCONCE': 'LR-SCONCE-B', 'LR-CURTAIN': 'LR-CURTAIN-B', 'LR-ART': 'LR-ART-B' }], ['WiFi cabinet removed', { 'LR-WIFI': null }]];
const budgetTest = (name) => tests.filter((t) => t.file === 'budget.spec.js' && (name ? t.title.includes(name) : t.title.includes('1,018.17')));
const budgetRows = combos.map(([name, o], i) => {
  const x = total(o);
  const ts = i === 0 ? budgetTest() : budgetTest(['', 'rug B + desk B', 'bedroom budget picks', 'living alternates', 'WiFi cabinet removed'][i]);
  const st = ts.length && ts.every((t) => t.status === 'passed') ? 'passed' : ts.length ? 'failed' : '—';
  return `<tr><td>${esc(name)}</td><td class="num">${money(x.t)}</td><td class="num">${money(x.tax)}</td><td class="num">${money(x.u)}</td><td class="num"><b class="${x.total > 100000 ? 'over' : 'under'}">${money(x.total)}</b></td>${statusCell(st)}</tr>`;
}).join('');

const compareImgs = (mode) => PRESETS.map((p) => {
  const f = `compare/compare-${p.id}${mode === 'day' ? '' : '-night'}.jpg`;
  return fs.existsSync(path.join(out, f)) ? `<figure><img src="${f}" alt="${esc(p.id)}" loading="lazy"><figcaption>${esc(p.label)} · facing ${esc(p.facing)} · camera fit ${p.fitPx}px</figcaption></figure>` : '';
}).join('');
const shotFig = (f, cap) => (shots.includes(f) ? `<figure><img src="shots/${f}" alt="" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>` : '');

const choices = [
  'Unit conversion lives in one place (src/units.js): 1 three.js unit = 1 m; a room group turns room inches (z up) into the scene.',
  'Kitchen beyond the open edge and pass-through: context only. room-spec gives its finishes, not its layout, so standard cabinet sizes (24" deep base, 36" counter, 12" deep uppers) are drawn along the dining end wall.',
  'BR-ART-B (PJÄTTERYD set of 3): the spec places one canvas; the other two hang beside it on the south wall at x 120.5, y 19.25 and 42.75, z 57 (app choice, src/core/items.js EXTRA_PIECE_PLACEMENTS).',
  'Curtains hang from the rod about 4" off the wall, in front of the existing blinds (the slot box is 1–2" deep). Closed = each panel spreads over half the rod. Drawn 91.5" tall as required.',
  'Duvet and throw: drawn to the slot\'s placement box (their spread-out state), not their flat catalog size; the duvet set\'s 2 pillowcases sit on the bed pillows.',
  'IKEA models are scaled to the product\'s listed size (not always the same factor in each direction).',
  'Rod brackets and finials are kept inside the listed 1" profile (ESTIMATED); the Rattan side table is drawn so its knob stays inside the listed 16" depth.',
  'Photo views: camera position, direction and lens were solved from points marked on each photo (tools/camera-solve.mjs). Camera tilt (roll) is not applied (bedroom-06 is tilted 5.2°) and phone-lens bending is not drawn, so photo edges curve where the app is straight. living-07 was taken from the open front doorway (x = −10"); the view is placed just inside the closed door (x = 2").',
  'The view outside each window is a painted backdrop (trees, a neighbor\'s wall), not a photo.',
  'Day light strength (sun, sky) is chosen to look natural; the spec gives the sun\'s direction. Night: each lamp gives its listed lumens at its color temperature; the image is white-balanced like a phone camera (3400K) and exposure adapts to how much light the room has.',
  'A small amount of day "bounce" light is added to ceilings (they face only the floor, which a studio light setup leaves too dark).',
  'Floor planks: a generated oak-look texture in the spec\'s sampled color, planks running east–west.',
];
const issues = [
  'LR-SCONCE-B (Target, $75) is priced per sconce (qty 1) but the slot shows two sconces. The budget uses the file\'s qty, so choosing B adds $75 + tax, not $150 + tax. The product description says "you\'d want two".',
  'LR-CURTAIN-B (Quince linen, $82) is one panel (qty 1); the window needs 2 ($164). Same budget effect as above.',
  'LR-PLATE-1 (blank wall plate, ESTIMATED z = 46") looks about 15" lower in photo living-02, which is why that view\'s camera fit is the weakest (28.7 px). Worth a tape-measure check.',
  'BR-ROD-B (HUGAD 47¼–82¾") is noted in products.json as too short for the bedroom window plus overlap; it is drawn at its full 82.75".',
  'Links: Walmart (LR-SCONCE-A, LR-PLANT-A, LR-CABLE-A, BR-PLANT-A) shows "Robot or human?" to automated browsers, so those pages could not be confirmed automatically (the LR-SCONCE-A block page names a "Motent 2 Pack Plug-in Wall Light with Cord, Rattan", which matches). OfferUp returned 403 for LR-COFFEE-A but its title names the right table. Facebook asks to log in for LR-WIFI-B (it may be sold). Please open these by hand.',
];

const unitOk = unit.filter((u) => u.ok).length;
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room viewer test report</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f4f0;color:#222}main{max-width:1200px;margin:auto}
h1{margin:0 0 4px}h2{margin-top:40px;border-bottom:1px solid #ddd;padding-bottom:4px}.priv{background:#fff3cd;border:1px solid #e6c55a;padding:8px 12px;border-radius:8px}
table{border-collapse:collapse;width:100%;background:#fff;font-size:12.5px}td,th{border:1px solid #e3e0da;padding:4px 6px;vertical-align:top;text-align:left}th{background:#efece6}
.ok{background:#e8f5e9}.bad{background:#fde8e8}.warn{background:#fff6dc}.skip{color:#999}.num{text-align:right;white-space:nowrap}.over{color:#c62828}.under{color:#2e7d32}
td img{width:56px;height:56px;object-fit:cover;border-radius:4px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
figure{margin:0;background:#fff;padding:6px;border-radius:8px}figure img{width:100%;display:block;border-radius:4px}figcaption{font-size:12px;color:#555;padding-top:4px}
.wide figure{grid-column:1/-1}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#fff;border-radius:10px;padding:10px 14px;min-width:150px}.card b{font-size:22px;display:block}
.scroll{overflow-x:auto}small{color:#666}
</style><main>
<h1>Room viewer test report</h1>
<p>${new Date().toLocaleString('en-US')} · Chromium (Playwright) at desktop 1440×900 and phone 412×892 (touch) on this computer (AMD Ryzen 5 5500U, Radeon graphics).</p>
<p class="priv"><b>Private:</b> this report shows your home photos next to the app. It stays on this computer; it is not part of the app and must not be uploaded.</p>
<div class="cards">
<div class="card"><b>${passed}/${ran.length}</b>browser tests passed</div>
<div class="card"><b>${unitOk}/${unit.length}</b>unit tests passed</div>
<div class="card"><b>${products.products.length}</b>products checked</div>
<div class="card"><b>${money(total({}).total)}</b>designer's total (red, over $1,000)</div>
<div class="card"><b>${links.filter((l) => /right product|search page/.test(l.verdict)).length}/${links.length}</b>links confirmed</div>
</div>

<h2>Photo vs app (day)</h2>
<p>Each photo next to the matching camera view (no furniture from the photos: the app shows the designer's layout). Positions of windows, doors, the pass-through, closet, fans and outlets line up; "camera fit" is how far (in pixels of a 1024×768 image) the marked points land from where the 3D room puts them.</p>
<div class="grid wide">${compareImgs('day')}</div>
<h2>Photo vs app (night)</h2>
<div class="grid">${compareImgs('night')}</div>

<h2>Screenshots</h2>
<div class="grid">
${shotFig('desktop-living-day.png', 'Living room, day (desktop)')}${shotFig('desktop-living-night.png', 'Living room, night: curtains closed, lamps on')}
${shotFig('desktop-bedroom-day.png', 'Bedroom, day (desktop)')}${shotFig('desktop-bedroom-night.png', 'Bedroom, night')}
${shotFig('phone-living-day.png', 'Phone, living room, day')}${shotFig('phone-bedroom-night.png', 'Phone, bedroom, night')}
${shots.filter((f) => f.startsWith('warning-')).map((f) => shotFig(f, `Fit warning: ${f.replace(/^warning-|\.png$/g, '').replace(/_/g, '#')}`)).join('')}
${shots.filter((f) => f.startsWith('phone-preset-')).map((f) => shotFig(f, `Phone, photo view ${f.replace(/^phone-preset-|\.png$/g, '')}`)).join('')}
</div>

<h2>Every product</h2>
<p>Each option was swapped in from the item card, measured in 3D against its listed size (inches, W×D×H; must match within 1" or 6%), selected by clicking it in the 3D view, moved with the arrow pad, rotated, put back with "Reset spot", removed (and the budget checked), then added back from the Items list. Buy/Backup buttons were clicked and the new tab's address compared with the file; separately, every link was opened in a real browser.</p>
<div class="scroll"><table><tr><th></th><th>Product</th><th>3D</th><th>Listed</th><th>Drawn</th><th>Swap</th><th>Select</th><th>Move</th><th>Rotate</th><th>Remove</th><th>Buy button</th><th>Real page</th></tr>
${productRows}</table></div>

<h2>Budget</h2>
<p>New items + ${(products.tax_rate * 100).toFixed(2)}% tax, used items untaxed, against the $1,000 cap; whole-cent math, tax rounded half up. Each row was produced by swapping in the UI and reading the budget chip and breakdown.</p>
<table><tr><th>Layout</th><th>New items</th><th>Tax</th><th>Used items</th><th>Total</th><th>Test</th></tr>${budgetRows}</table>

<h2>Speed</h2>
<p>Frames per second while the camera orbits (worst case; the app draws only when something changes). "Phone" is 412×892 at 2× pixels with the CPU slowed 4× by Chrome DevTools, which on this laptop is slower than a current mid-range phone CPU. The phone's GPU cannot be simulated this way; the app lowers its resolution by itself if it can't hold 30 fps.</p>
<table><tr><th>Device</th><th>Room</th><th>CPU</th><th>Day fps</th><th>Night fps</th></tr>${perf.map((p) => `<tr><td>${p.project}</td><td>${p.room}</td><td>${p.cpuThrottle === 1 ? 'normal' : `${p.cpuThrottle}× slower`}</td><td class="num ${p.fps >= 30 ? 'ok' : 'bad'}">${p.fps}<br><small>${(p.samples?.day || []).join(' · ')}</small></td><td class="num ${p.fpsNight >= 30 ? 'ok' : 'bad'}">${p.fpsNight}<br><small>${(p.samples?.night || []).join(' · ')}</small></td></tr>`).join('')}</table>
<p><small>Each number is the median of five 3-second runs (all five shown under it).</small></p>
<p>Download: models ${(dirSize(R('dist/models')) / 1024).toFixed(0)} KB (8 IKEA models, Draco + WebP), product photos ${(dirSize(R('dist/product-images')) / 1024).toFixed(0)} KB, app code ${(dirSize(R('dist/assets')) / 1024).toFixed(0)} KB. Only the current room's models load.</p>

<h2>Things to check by hand</h2><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>

<h2>ESTIMATED values used</h2>
<p>These come from the input files marked ESTIMATED (not measured). The app uses them as given.</p>
<details><summary>room-spec.json: ${est.length} fields</summary><ul>${est.map((e) => `<li><code>${esc(e)}</code></li>`).join('')}</ul></details>
<details><summary>products.json: ${prodEst.length} products with estimated sizes</summary><ul>${prodEst.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>

<h2>Choices the app made (not in the files)</h2><ul>${choices.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

<h2>All tests</h2>
<h3>Unit (node --test)</h3><table>${unit.map((u) => `<tr><td>${esc(u.name)}</td>${statusCell(u.ok ? 'passed' : 'failed')}</tr>`).join('')}</table>
<h3>Browser (Playwright)</h3>
<table><tr><th>File</th><th>Test</th><th>Device</th><th>Result</th><th>Time</th></tr>${tests.filter((t) => t.status !== 'skipped').map((t) => `<tr><td>${esc(t.file)}</td><td>${esc(t.title)}${t.error ? `<br><small>${esc(t.error)}</small>` : ''}</td><td>${esc(t.project)}</td>${statusCell(t.status)}<td class="num">${((t.ms || 0) / 1000).toFixed(1)}s</td></tr>`).join('')}</table>
<p><small>Skipped on the phone (desktop covers them): the full product loop (the phone runs 3 sample slots), 12 of 14 photo views, the keyboard test and the file check.</small></p>
</main>`;
function dirSize(d) { return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0) : 0; }
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`test-report/index.html: ${passed}/${ran.length} browser tests passed, ${unitOk}/${unit.length} unit, ${shots.length} screenshots`);
