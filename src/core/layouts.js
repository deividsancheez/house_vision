// Saved layouts: kept in this browser (localStorage) and exportable/importable as a .json file.
import { normalizeLayout } from './items.js';

const KEY_CURRENT = 'roomviewer.current.v1';
const KEY_SAVED = 'roomviewer.saved.v1';
export const FILE_APP_ID = 'room-viewer-layouts';

function store() {
  try { return window.localStorage; } catch { return null; }
}
function readJson(key, fallback) {
  try { const v = store()?.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { store()?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function loadCurrent(cat) {
  const raw = readJson(KEY_CURRENT, null);
  if (!raw?.layout) return null;
  return { name: raw.name || null, layout: normalizeLayout(cat, raw.layout).layout };
}
export function saveCurrent(name, layout) {
  return writeJson(KEY_CURRENT, { name, layout });
}

export function listSaved() {
  const list = readJson(KEY_SAVED, []);
  return Array.isArray(list) ? list : [];
}
function writeSaved(list) { return writeJson(KEY_SAVED, list); }

export function saveAs(name, layout) {
  const clean = String(name || '').trim().slice(0, 60) || 'Untitled layout';
  const list = listSaved();
  const now = new Date().toISOString();
  const existing = list.find((l) => l.name === clean);
  if (existing) { existing.layout = structuredClone(layout); existing.updated = now; }
  else list.push({ id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, created: now, updated: now, layout: structuredClone(layout) });
  writeSaved(list);
  return clean;
}

export function getSaved(id) { return listSaved().find((l) => l.id === id) || null; }
export function deleteSaved(id) { writeSaved(listSaved().filter((l) => l.id !== id)); }
export function renameSaved(id, name) {
  const list = listSaved();
  const l = list.find((x) => x.id === id);
  if (l) { l.name = String(name).trim().slice(0, 60) || l.name; l.updated = new Date().toISOString(); writeSaved(list); }
}

export function exportFile(layouts) {
  return { app: FILE_APP_ID, version: 2, exported: new Date().toISOString(), layouts: layouts.map(({ name, created, updated, layout }) => ({ name, created, updated, layout })) };
}

/** Parse an exported file; returns {layouts, warnings}. Unknown product/slot ids are dropped, not guessed. */
export function parseImport(cat, text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  let entries;
  if (data?.app === FILE_APP_ID && Array.isArray(data.layouts)) entries = data.layouts;
  else if (data?.slots && data?.existing) entries = [{ name: 'Imported layout', layout: data }];
  else throw new Error('That file is not a layout export from this app.');
  const warnings = [];
  const layouts = entries.map((e, i) => {
    const { layout, dropped } = normalizeLayout(cat, e.layout);
    if (dropped.length) warnings.push(`"${e.name || `Layout ${i + 1}`}": ignored unknown ids ${[...new Set(dropped)].join(', ')}`);
    return { name: String(e.name || `Imported ${i + 1}`), layout };
  });
  return { layouts, warnings };
}

export function importLayouts(parsed) {
  const names = [];
  for (const l of parsed.layouts) {
    let name = l.name;
    const taken = new Set(listSaved().map((x) => x.name));
    if (taken.has(name)) { let n = 2; while (taken.has(`${name} (${n})`)) n++; name = `${name} (${n})`; }
    names.push(saveAs(name, l.layout));
  }
  return names;
}

/** Differences between two layouts, slot by slot, for the compare view (stored pieces and
 *  Catalog additions included). */
export function diffLayouts(cat, a, b) {
  const rows = [];
  const storedN = (poses) => poses.filter((p) => p.stored).length;
  const placedOnly = (poses) => JSON.stringify(poses.map(({ stored, ...p }) => p));
  for (const s of cat.slots.values()) {
    const A = a.slots[s.slot_id], B = b.slots[s.slot_id];
    const moved = placedOnly(A.poses) !== placedOnly(B.poses);
    const sa = A.option ? storedN(A.poses) : 0, sb = B.option ? storedN(B.poses) : 0;
    if (A.option !== B.option || moved || sa !== sb) rows.push({ slotId: s.slot_id, label: s.label, room: s.room, a: A.option, b: B.option, sameOption: A.option === B.option, moved, storedA: sa, storedB: sb });
  }
  for (const [id, A] of Object.entries(a.existing)) {
    const B = b.existing[id];
    if (!B) continue;
    const moved = placedOnly(A.poses) !== placedOnly(B.poses);
    const sa = storedN(A.poses), sb = storedN(B.poses);
    if (A.hidden !== B.hidden || moved || sa !== sb) rows.push({ existingId: id, label: cat.existing.get(id).name, room: cat.existing.get(id).room, a: A.hidden ? null : 'kept', b: B.hidden ? null : 'kept', sameOption: A.hidden === B.hidden, moved, storedA: sa, storedB: sb });
  }
  // Catalog additions, matched by product
  const xa = (a.extras || []).map((x) => x.product), xb = (b.extras || []).map((x) => x.product);
  for (const pid of [...new Set([...xa, ...xb])]) {
    const na = xa.filter((x) => x === pid).length, nb = xb.filter((x) => x === pid).length;
    if (na === nb) continue;
    const p = cat.products.get(pid);
    rows.push({ extraProduct: pid, label: `${cat.slots.get(p.slot).label} (added from the Catalog)`, room: cat.slots.get(p.slot).room, a: na ? pid : null, b: nb ? pid : null, sameOption: false, moved: false, storedA: 0, storedB: 0 });
  }
  // Lookbook pieces placed freely, matched by product
  const la = a.lookbook || [], lb = b.lookbook || [];
  for (const pid of [...new Set([...la, ...lb].map((x) => x.product))]) {
    const ea = la.find((x) => x.product === pid), eb = lb.find((x) => x.product === pid);
    const moved = !!(ea && eb) && JSON.stringify(ea.poses) !== JSON.stringify(eb.poses);
    if (ea && eb && !moved) continue;
    const p = cat.products.get(pid);
    rows.push({ extraProduct: pid, label: `${p?.lookbook?.categoryLabel || 'Lookbook piece'} (from the lookbook)`, room: (ea || eb).room, a: ea ? pid : null, b: eb ? pid : null, sameOption: !!(ea && eb), moved, storedA: 0, storedB: 0 });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Walk-mode settings and best scores (this browser only)

const KEY_SETTINGS = 'roomviewer.settings.v1';
const KEY_BEST = 'roomviewer.best.v1';

export const DEFAULT_SETTINGS = { eyeHeight: 68, sway: true, hints: true, muted: null, tutorialDone: false, mode: null };

export function loadSettings() {
  const s = readJson(KEY_SETTINGS, {});
  const out = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
  if (!Number.isFinite(out.eyeHeight)) out.eyeHeight = DEFAULT_SETTINGS.eyeHeight;
  return out;
}
export function saveSettings(s) { return writeJson(KEY_SETTINGS, s); }

/** Best room scores reached: {living: n, bedroom: n}. */
export function loadBest() {
  const b = readJson(KEY_BEST, {});
  return b && typeof b === 'object' ? b : {};
}
export function saveBest(b) { return writeJson(KEY_BEST, b); }

/** A stored layout brought up to date with the current products.json (missing slots get defaults). */
export function normalizeFor(cat, layout) {
  return normalizeLayout(cat, layout).layout;
}
