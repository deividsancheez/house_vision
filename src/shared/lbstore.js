// What the lookbook and the 3D rooms share. Both pages are served from the same site, so they share
// this browser's localStorage:
//   lookbook.picks.v1   My Picks: one product per pick slot, with its quantity and color
//                       {v: 1, picks: {[pickKey]: {id, qty, color}}, try3d: [{id, color}], updated}
//                       try3d holds products sent to the 3D rooms with "See in 3D" that aren't picks.
//   roomviewer.current.v1  the 3D app's current layout (read by the lookbook to know what's placed)
// No DOM and no three.js here, so the unit tests can run it in Node.

export const PICKS_KEY = 'lookbook.picks.v1';
export const LAYOUT_KEY = 'roomviewer.current.v1';

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** A lookbook product's color variants, each with a key naming it alone: its color, or "White (2)" for
 *  a color listed again (the same color in another size or scent, with its own link and price). */
export function variantList(p) {
  const seen = new Map();
  return (p.color_variants || []).map((v) => {
    const n = (seen.get(v.color) || 0) + 1;
    seen.set(v.color, n);
    return { ...v, key: n > 1 ? `${v.color} (${n})` : v.color };
  });
}

/** The variant saved under this key (see variantList), or null. */
export function findVariant(p, key) {
  return key ? variantList(p).find((v) => v.key === key) || null : null;
}

export function emptyPicks() {
  return { v: 1, picks: {}, try3d: [], updated: null };
}

/** The saved picks, cleaned up: unknown shapes are dropped, never guessed. */
export function readPicks() {
  let raw = null;
  try { raw = JSON.parse(storage()?.getItem(PICKS_KEY) || 'null'); } catch { raw = null; }
  return cleanPicks(raw);
}

export function cleanPicks(raw) {
  const out = emptyPicks();
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, p] of Object.entries(raw.picks || {})) {
    if (!p || typeof p.id !== 'string') continue;
    const qty = Number.isInteger(p.qty) && p.qty > 0 ? p.qty : 1;
    out.picks[key] = { id: p.id, qty, color: typeof p.color === 'string' && p.color ? p.color : null };
  }
  const seen = new Set();
  for (const t of Array.isArray(raw.try3d) ? raw.try3d : []) {
    if (!t || typeof t.id !== 'string') continue;
    const color = typeof t.color === 'string' && t.color ? t.color : null;
    const k = `${t.id}~${color || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.try3d.push({ id: t.id, color });
  }
  out.updated = typeof raw.updated === 'string' ? raw.updated : null;
  return out;
}

export function writePicks(state) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PICKS_KEY, JSON.stringify({ ...state, v: 1, updated: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

/** The 3D app's current layout as saved in this browser (or null). */
export function readLayout() {
  try { return JSON.parse(storage()?.getItem(LAYOUT_KEY) || 'null')?.layout || null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// References: how a pick shows up in the 3D rooms. Each pick (and each "See in 3D" product) is its
// own 3D product, so the same rod picked for both rooms gives two rods:
//   lb:<pickKey>:<productId>:<color>     a pick ("ROD@BR-ROD", "TRAY"...)
//   lb:try:<productId>:<color>           sent with "See in 3D", not a pick

export function pickRef(pickKey, id, color) {
  return `lb:${pickKey}:${id}:${color || ''}`;
}
export function tryRef(id, color) {
  return `lb:try:${id}:${color || ''}`;
}

export function parseRef(ref) {
  const m = /^lb:(.+):([^:]+):([^:]*)$/.exec(String(ref || ''));
  if (!m) return null;
  return { pickKey: m[1] === 'try' ? null : m[1], tried: m[1] === 'try', id: m[2], color: m[3] || null };
}

/** Every 3D reference of the current picks and "See in 3D" products, with its quantity. */
export function refsOf(state) {
  const out = [];
  for (const [key, p] of Object.entries(state.picks)) out.push({ ref: pickRef(key, p.id, p.color), pickKey: key, id: p.id, color: p.color, qty: p.qty, tried: false });
  for (const t of state.try3d) {
    const already = Object.values(state.picks).some((p) => p.id === t.id && (p.color || null) === t.color);
    if (!already) out.push({ ref: tryRef(t.id, t.color), pickKey: null, id: t.id, color: t.color, qty: null, tried: true });
  }
  return out;
}

/** Lookbook references used in a 3D layout (in a slot, or placed freely). */
export function refsInLayout(layout) {
  const refs = new Set();
  if (!layout) return refs;
  for (const s of Object.values(layout.slots || {})) if (typeof s?.option === 'string' && s.option.startsWith('lb:')) refs.add(s.option);
  for (const e of Array.isArray(layout.lookbook) ? layout.lookbook : []) if (typeof e?.product === 'string') refs.add(e.product);
  return refs;
}
