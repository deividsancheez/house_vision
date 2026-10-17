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
  return { app: FILE_APP_ID, version: 1, exported: new Date().toISOString(), layouts: layouts.map(({ name, created, updated, layout }) => ({ name, created, updated, layout })) };
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

/** Differences between two layouts, slot by slot, for the compare view. */
export function diffLayouts(cat, a, b) {
  const rows = [];
  for (const s of cat.slots.values()) {
    const A = a.slots[s.slot_id], B = b.slots[s.slot_id];
    const moved = JSON.stringify(A.poses) !== JSON.stringify(B.poses);
    if (A.option !== B.option || moved) rows.push({ slotId: s.slot_id, label: s.label, room: s.room, a: A.option, b: B.option, sameOption: A.option === B.option, moved });
  }
  for (const [id, A] of Object.entries(a.existing)) {
    const B = b.existing[id];
    if (!B) continue;
    const moved = JSON.stringify(A.poses) !== JSON.stringify(B.poses);
    if (A.hidden !== B.hidden || moved) rows.push({ existingId: id, label: cat.existing.get(id).name, room: cat.existing.get(id).room, a: A.hidden ? null : 'kept', b: B.hidden ? null : 'kept', sameOption: A.hidden === B.hidden, moved });
  }
  return rows;
}

/** A stored layout brought up to date with the current products.json (missing slots get defaults). */
export function normalizeFor(cat, layout) {
  return normalizeLayout(cat, layout).layout;
}
