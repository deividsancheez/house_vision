// Builds the lookbook's test report: test-report/lookbook.html, with the screenshots of every page
// (1440 px and 390 px), the 3D integration shots, the test results, the link check and what needs a
// manual check. Local only, like the rest of test-report/ (git-ignored, never uploaded).
// Inputs: test-results/results.json (Playwright), test-results/unit.tap (npm run test:unit:tap),
// test-results/lookbook-links.json (tools/check-lookbook-links.mjs), test-results/lookbook-data-gaps.json.
// node tools/lookbook-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = (...p) => path.join(root, ...p);
const out = R('test-report');
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- tests
const pw = readJson(R('test-results/results.json'), { suites: [] });
const tests = [];
const walk = (s, file) => {
  for (const x of s.suites || []) walk(x, x.file || file);
  for (const sp of s.specs || []) for (const t of sp.tests) {
    const res = t.results.at(-1);
    tests.push({ file: (sp.file || file || '').replace(/^.*[\\/]/, ''), title: sp.title, project: t.projectName, status: t.status === 'skipped' ? 'skipped' : res?.status, retried: t.results.length > 1, error: res?.error?.message?.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0] });
  }
};
walk(pw);
const tap = fs.existsSync(R('test-results/unit.tap')) ? fs.readFileSync(R('test-results/unit.tap'), 'utf8') : '';
const unit = [...tap.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ ok: m[1] === 'ok', title: m[2] }));
const ran = tests.filter((t) => t.status !== 'skipped');
const passed = ran.filter((t) => t.status === 'passed');

// ---- screenshots
const shotsSrc = R('test-results/shots');
fs.mkdirSync(path.join(out, 'lookbook-shots'), { recursive: true });
const groups = [];
for (const [dir, label] of [['lookbook-desktop', 'Desktop, 1440 px'], ['lookbook-phone-390', 'Phone, 390 px']]) {
  const src = path.join(shotsSrc, dir);
  const files = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => f.endsWith('.png')).sort() : [];
  fs.mkdirSync(path.join(out, 'lookbook-shots', dir), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(out, 'lookbook-shots', dir, f));
  groups.push({ label, files: files.map((f) => `lookbook-shots/${dir}/${f}`) });
}
const integ = fs.existsSync(shotsSrc) ? fs.readdirSync(shotsSrc).filter((f) => f.startsWith('lookbook-3d-')).sort() : [];
for (const f of integ) fs.copyFileSync(path.join(shotsSrc, f), path.join(out, 'lookbook-shots', f));

// ---- links and data
const links = readJson(R('test-results/lookbook-links.json'), { results: [] });
const manual = links.results.filter((r) => r.verdict === 'needs manual check');
const gaps = readJson(R('test-results/lookbook-data-gaps.json'), []);
const n = (v) => links.results.filter((r) => r.verdict === v).length;

const row = (t) => `<tr class="${t.status}"><td>${esc(t.file)}</td><td>${esc(t.project)}</td><td>${esc(t.title)}${t.retried ? ' <small>(passed on retry)</small>' : ''}</td><td>${esc(t.status)}${t.error ? `<br><small>${esc(t.error)}</small>` : ''}</td></tr>`;
const fig = (src) => `<figure><a href="${src}"><img src="${src}" alt="" loading="lazy"></a><figcaption>${esc(path.basename(src, '.png'))}</figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><title>Lookbook test report</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#222;max-width:1400px}h1{margin:0 0 4px}h2{margin-top:36px;border-bottom:1px solid #ddd}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.grid.phone{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
figure{margin:0}figure img{width:100%;border:1px solid #ddd;border-radius:6px}figcaption{font-size:11px;color:#666}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top}
tr.failed td,tr.timedOut td{background:#fde8e4}.ok{color:#2f6b2f}.bad{color:#a33a24}small{color:#666}
</style>
<h1>Lookbook test report</h1>
<p>${new Date().toLocaleString('en-US')} · local only, never uploaded</p>
<ul>
<li class="${passed.length === ran.length ? 'ok' : 'bad'}"><b>Browser tests:</b> ${passed.length} of ${ran.length} passed (desktop 1440, phone 412, lookbook also at 390).</li>
<li class="${unit.every((u) => u.ok) ? 'ok' : 'bad'}"><b>Unit tests:</b> ${unit.filter((u) => u.ok).length} of ${unit.length} passed (incl. products.json validation, $908.30 / $988.16 / $1,186.77, two custom mixes, 3D budget).</li>
<li><b>Buy links:</b> ${links.results.length} checked in a real browser: ${n('right product page')} open the right product page, ${n('search page opens')} backup searches open, <b class="bad">${manual.length} need a manual check</b> (blocked by the store's bot check; never counted as a pass).</li>
<li><b>Data gaps</b> (left empty, nothing invented): ${gaps.length}.</li>
</ul>
<h2>Every page, desktop and phone</h2>
${groups.map((g) => `<h3>${esc(g.label)} · ${g.files.length} pages</h3><div class="grid${/Phone/.test(g.label) ? ' phone' : ''}">${g.files.map(fig).join('')}</div>`).join('')}
<h2>Lookbook in the 3D rooms</h2><div class="grid">${integ.map((f) => fig(`lookbook-shots/${f}`)).join('')}</div>
<h2>Needs manual check (links)</h2>
<table><tr><th>Product</th><th>Store</th><th>Link</th><th>Why</th></tr>${manual.map((r) => `<tr><td>${esc(r.id)}${r.color ? ` (${esc(r.color)})` : ''}</td><td>${esc(r.store)}</td><td><a href="${esc(r.url)}">${esc(r.url)}</a></td><td>${esc(r.reason)}${r.status ? ` · HTTP ${r.status}` : ''}</td></tr>`).join('')}</table>
<h2>Data gaps in products.json</h2><ul>${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
<h2>Browser tests</h2><table><tr><th>File</th><th>Screen</th><th>Test</th><th>Result</th></tr>${tests.map(row).join('')}</table>
<h2>Unit tests</h2><ul>${unit.map((u) => `<li class="${u.ok ? 'ok' : 'bad'}">${u.ok ? '✔' : '✖'} ${esc(u.title)}</li>`).join('')}</ul>
`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'lookbook.html'), html);
console.log(`test-report/lookbook.html: ${passed.length}/${ran.length} browser, ${unit.filter((u) => u.ok).length}/${unit.length} unit, ${groups.reduce((a, g) => a + g.files.length, 0)} page shots, ${manual.length} links need a manual check`);
