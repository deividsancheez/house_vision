// Undo / redo of layout changes (pick up + drop, store, place, swap, remove, moves in Overview).
// Each entry keeps the layout before and after, as JSON. Dismissed warnings are not part of it:
// undoing a move doesn't bring back a warning you dismissed.

export const HISTORY_LIMIT = 50;

const snap = (layout) => {
  const { dismissed, ...rest } = layout;
  return JSON.stringify(rest);
};

export class History {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.base = null;
  }

  /** Start from this layout (after loading or resetting). */
  reset(layout) {
    this.past = [];
    this.future = [];
    this.base = snap(layout);
  }

  /** Call after every change; records one step if the layout differs from the last one. */
  record(layout, label) {
    const now = snap(layout);
    if (this.base === null) { this.base = now; return false; }
    if (now === this.base) return false;
    this.past.push({ label, before: this.base, after: now });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.base = now;
    return true;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** Returns the layout to go back to (keeping the current dismissed list), or null. */
  undo(current) {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push(e);
    this.base = e.before;
    return { layout: { ...JSON.parse(e.before), dismissed: current.dismissed || [] }, label: e.label };
  }

  redo(current) {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push(e);
    this.base = e.after;
    return { layout: { ...JSON.parse(e.after), dismissed: current.dismissed || [] }, label: e.label };
  }
}
