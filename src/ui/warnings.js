// Warning cards: a small stack on screen in Walk mode (never over the center dot), and the full
// list with the "Dismissed (n)" section in the warnings panel. Each card: title, what's wrong, why
// it matters, how to fix it, "Show me", and X to dismiss it for this piece.
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const WARN = '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18h.01"/></svg>';

export function warningCard(app, ex, { compact = false, dismissed = false } = {}) {
  const body = h('div', { class: 'w-body' },
    h('p', { class: 'w-what' }, ex.what),
    h('p', { class: 'w-why' }, h('b', {}, 'Why it matters: '), ex.why),
    h('p', { class: 'w-fix' }, h('b', {}, 'How to fix it: '), ex.fix));
  const card = h('div', { class: `warn-card ${compact ? 'compact' : ''} ${dismissed ? 'dismissed' : ''}`, 'data-testid': 'warning-card', 'data-sig': ex.sig, 'data-kind': ex.kind },
    h('div', { class: 'w-head' },
      h('span', { class: 'ico', html: WARN }),
      h('b', { class: 'w-title' }, ex.title),
      dismissed
        ? h('button', { class: 'btn small', 'data-testid': 'restore-warning', onclick: () => app.restoreWarning(ex.sig) }, 'Restore')
        : h('button', { class: 'icon-btn small', 'aria-label': 'Dismiss this warning', 'data-testid': 'dismiss-warning', onclick: () => app.dismissWarning(ex.sig) }, h('span', { class: 'ico', html: X }))),
    body,
    h('div', { class: 'w-acts' }, h('button', { class: 'btn small', 'data-testid': 'show-me', onclick: () => app.showWarning(ex) }, 'Show me')));
  if (compact) {
    card.classList.add('collapsed');
    card.querySelector('.w-head').addEventListener('click', (e) => { if (!e.target.closest('button')) card.classList.toggle('collapsed'); });
  }
  return card;
}

/** The on-screen stack (Walk mode): up to two cards for the current room, then "+n more". */
export class WarnStack {
  constructor(app) {
    this.app = app;
    this.root = h('div', { class: 'warn-stack', hidden: true, 'data-testid': 'warn-stack', 'aria-live': 'polite' });
    this.key = '';
  }

  render(force = false) {
    const app = this.app;
    const show = app.viewMode === 'walk' && !app.tutorial;
    const { active } = app.explained();
    const key = `${show}|${active.map((e) => `${e.sig}:${Math.round(e.amount)}`).join(',')}`;
    if (!force && key === this.key) return;
    this.key = key;
    this.root.hidden = !show || !active.length;
    if (this.root.hidden) return;
    const max = matchMedia('(max-width: 720px)').matches ? 1 : 2;
    this.root.replaceChildren(...active.slice(0, max).map((ex) => warningCard(app, ex, { compact: true })));
    if (active.length > max) this.root.append(h('button', { class: 'btn small more', onclick: () => app.ui.openWarnings() }, `+${active.length - max} more`));
  }
}

/** The full list in a side panel. */
export function warningsPanel(app) {
  const { active, dismissed } = app.explained();
  const roomName = app.roomId === 'bedroom' ? 'Bedroom' : 'Living room';
  const det = h('details', { class: 'dismissed-list', 'data-testid': 'dismissed-list', open: dismissed.length ? true : null },
    h('summary', {}, `Dismissed (${dismissed.length})`),
    dismissed.length ? h('div', { class: 'w-list' }, ...dismissed.map((ex) => warningCard(app, ex, { dismissed: true }))) : h('p', { class: 'note' }, 'Nothing dismissed.'));
  return h('div', { class: 'warnings-panel' },
    h('p', { class: 'note' }, active.length ? `${roomName}: ${active.length} warning${active.length > 1 ? 's' : ''}. A warning never blocks a move; it tells you what the move breaks.` : `${roomName}: no fit warnings.`),
    h('div', { class: 'w-list' }, ...active.map((ex) => warningCard(app, ex))),
    det);
}
