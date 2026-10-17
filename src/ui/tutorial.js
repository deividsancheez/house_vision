// First-visit tutorial (about 30 s, skippable, replayable from Settings). It runs on a copy of the
// layout, so nothing you do in it changes your real layout.
// Steps: walk to the coffee table -> pick it up -> drop it -> store a pillow -> open the inventory
// and place the pillow back.
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

const TABLE = 'LR-COFFEE#0';
const isPillow = (k) => /^LR-PILLOW-(NEUTRAL|ACCENT)#/.test(k);

export function tutorialSteps(touch) {
  return [
    { id: 'walk', text: touch ? 'Use the joystick (bottom left) to walk to the coffee table. Drag on the right to look around.' : 'Walk to the coffee table with W A S D or the arrow keys. Click the view and move the mouse to look around.',
      done: (app) => { const it = app.item(TABLE); const w = app.walk; return it && Math.hypot(w.pos.x - it.pose.x, w.pos.y - it.pose.y) < 54; } },
    { id: 'pick', text: touch ? 'Look at the coffee table and tap Pick up.' : 'Look at the coffee table (the dot turns white) and press E to pick it up.',
      done: (app) => app.walk.carry?.key === TABLE },
    { id: 'drop', text: touch ? 'Look at a spot on the floor and tap Drop (green means it fits).' : 'Look at a spot on the floor and press E (or click) to drop it. Green means it fits.',
      done: (app, t) => !app.walk.carry && t.dropped },
    { id: 'store', text: touch ? 'Look at a pillow on the sofa and tap Store.' : 'Look at a pillow on the sofa and press F to store it.',
      done: (app) => app.layout.inventory.some((g) => g.keys.some(isPillow)) },
    { id: 'place', text: touch ? 'Tap the bag, then Place the pillow and drop it back on the sofa.' : 'Press I to open the inventory, click Place on the pillow, and drop it back on the sofa.',
      done: (app, t) => t.placedPillow && !app.layout.inventory.some((g) => g.keys.some(isPillow)) },
  ];
}

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.root = h('div', { class: 'tutorial', hidden: true, role: 'dialog', 'aria-label': 'Tutorial', 'data-testid': 'tutorial' });
    this.active = false;
  }

  start() {
    const app = this.app;
    this.active = true;
    this.steps = tutorialSteps(matchMedia('(pointer: coarse)').matches);
    this.i = 0;
    this.flags = { dropped: false, placedPillow: false };
    app.beginTutorial();
    this.off = app.on((what) => {
      if (!this.active) return;
      if (what === 'dropped') {
        this.flags.dropped = true;
        if (this.steps[this.i]?.id === 'place') this.flags.placedPillow = true;
      }
    });
    this.root.hidden = false;
    this.render();
  }

  /** Called every frame while active. */
  tick() {
    if (!this.active) return;
    const s = this.steps[this.i];
    if (s && s.done(this.app, this.flags)) {
      this.i++;
      this.flags.dropped = false;
      this.app.sounds.play('goal');
      if (this.i >= this.steps.length) { this.finish(true); return; }
      this.render();
    }
  }

  render() {
    const s = this.steps[this.i];
    this.root.replaceChildren(
      h('div', { class: 'tut-top' }, h('b', {}, `Tutorial · step ${this.i + 1} of ${this.steps.length}`),
        h('button', { class: 'btn small', 'data-testid': 'tutorial-skip', onclick: () => this.finish(false) }, 'Skip')),
      h('p', { class: 'tut-text', 'data-step': s.id }, s.text),
      h('div', { class: 'tut-dots' }, ...this.steps.map((x, i) => h('i', { class: i < this.i ? 'done' : i === this.i ? 'now' : '' }))),
      h('p', { class: 'note small' }, 'Practice only: this runs on a copy of your layout.'));
  }

  finish(completed) {
    if (!this.active) return;
    this.active = false;
    this.off?.();
    this.root.hidden = true;
    this.app.endTutorial(completed);
  }
}
