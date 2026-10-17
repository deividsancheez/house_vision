// Goals checklist and room score (collapsible), plus "How the score works".
import { GOALS } from '../core/goals.js';

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
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';

export class GoalsPanel {
  constructor(app) {
    this.app = app;
    this.collapsed = matchMedia('(max-width: 720px)').matches;
    this.root = h('section', { class: 'goals-panel', hidden: true, 'data-testid': 'goals-panel', 'aria-label': 'Goals and score' });
    this.key = '';
  }

  toggle() { this.collapsed = !this.collapsed; this.render(true); }

  render(force = false) {
    const app = this.app;
    const show = app.viewMode === 'walk' && !app.tutorial;
    const g = app.goals();
    const best = app.bestScore(app.roomId);
    const key = `${show}|${this.collapsed}|${app.roomId}|${g.score}|${best}|${g.goals.map((x) => `${x.done}${x.detail}`).join()}`;
    if (!force && key === this.key) return;
    this.key = key;
    this.root.hidden = !show;
    this.root.classList.toggle('slim', this.collapsed);
    if (!show) return;
    const room = app.roomId === 'bedroom' ? 'Bedroom' : 'Living room';
    const head = h('button', { class: 'goals-head', 'aria-expanded': String(!this.collapsed), onclick: () => this.toggle() },
      h('span', { class: 'gh-title' }, h('b', {}, 'Goals'), h('small', {}, room)),
      h('span', { class: 'score' }, h('b', { 'data-testid': 'score' }, String(g.score)), h('small', {}, '/100')),
      h('span', { class: 'best' }, 'Best ', h('b', { 'data-testid': 'best-score' }, String(best))),
      h('span', { class: `ico chev ${this.collapsed ? '' : 'up'}`, html: CHEV }));
    const list = this.collapsed ? null : h('ul', { class: 'goal-list' }, ...g.goals.map((x) => h('li', { class: x.done ? 'done' : '', 'data-goal': x.id },
      h('span', { class: 'gcheck', html: x.done ? CHECK : '' }),
      h('span', { class: 'gtext' }, h('b', {}, x.label), h('small', {}, x.detail)),
      h('span', { class: 'gpts' }, `${round1(x.earned)}/${x.points}`))));
    const how = this.collapsed ? null : h('button', { class: 'btn small ghost how', 'data-testid': 'how-score', onclick: () => this.openHow() }, 'How the score works');
    this.root.replaceChildren(...[head, list, how].filter(Boolean));
  }

  openHow() {
    const app = this.app;
    app.ui.openModal('how', 'How the score works',
      h('p', { class: 'note' }, 'Each room scores 0 to 100, only from these goals. Goals with several parts (walkways, door swings, windows, lamps) earn their share: 4 of 5 walkways clear earns 4/5 of the points. Everything is computed from room-spec.json, products.json and your layout.'),
      h('table', { class: 'how-table' },
        h('tr', {}, h('th', {}, 'Goal'), h('th', {}, 'What counts'), h('th', { class: 'num' }, 'Points')),
        ...GOALS.map((g) => h('tr', {}, h('td', {}, g.label), h('td', {}, g.help), h('td', { class: 'num' }, String(g.points)))),
        h('tr', { class: 'sum' }, h('td', {}, 'Total'), h('td', {}, ''), h('td', { class: 'num' }, String(GOALS.reduce((a, g) => a + g.points, 0))))),
      h('p', { class: 'note' }, `Best: the highest score each room has reached in this browser. It starts at the designer's layout score (${app.designerScore('living')} living room, ${app.designerScore('bedroom')} bedroom).`));
  }
}

const round1 = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
