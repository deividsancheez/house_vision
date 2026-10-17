// Dev helper: node tools/crop.mjs <photo id> <x0> <y0> <x1> <y1> <out.png>  (coords in 1024x768 space)
import sharp from 'sharp';
const [id, x0, y0, x1, y1, out] = process.argv.slice(2);
const k = 2576 / 1024;
const [a, b, c, d] = [x0, y0, x1, y1].map(Number);
const scale = 800 / (c - a);
const w = Math.round((c - a) * scale), h = Math.round((d - b) * scale);
let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
for (let x = Math.ceil(a / 8) * 8; x <= c; x += 8) svg += `<line x1="${(x - a) * scale}" y1="0" x2="${(x - a) * scale}" y2="${h}" stroke="${x % 32 ? 'rgba(255,0,255,0.25)' : 'rgba(255,0,0,0.75)'}"/>` + (x % 32 ? '' : `<text x="${(x - a) * scale + 2}" y="12" font-size="12" fill="red" font-family="Arial">${x}</text>`);
for (let y = Math.ceil(b / 8) * 8; y <= d; y += 8) svg += `<line x1="0" y1="${(y - b) * scale}" x2="${w}" y2="${(y - b) * scale}" stroke="${y % 32 ? 'rgba(255,0,255,0.25)' : 'rgba(255,0,0,0.75)'}"/>` + (y % 32 ? '' : `<text x="2" y="${(y - b) * scale - 2}" font-size="12" fill="red" font-family="Arial">${y}</text>`);
svg += '</svg>';
await sharp(`../photos/${id}.jpg`).extract({ left: Math.round(a * k), top: Math.round(b * k), width: Math.round((c - a) * k), height: Math.round((d - b) * k) }).resize(w, h).composite([{ input: Buffer.from(svg) }]).png().toFile(out);
