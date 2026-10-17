// Walk-mode screen: center dot, what you aim at, the carry preview label, doorway labels, notes,
// the key hints panel (desktop), and the joystick + big action buttons (phone).
import { roomToWorld } from '../units.js';
import { shortName } from '../core/carry.js';

const $h = (tag, attrs = {}, ...kids) => {
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

const ICON = {
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5a1.5 1.5 0 0 1 3 0v8M17 10.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.5 16a1.6 1.6 0 0 1 2.4-2.1L8 16"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M4 20h16"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9"/></svg>',
  rot: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const ico = (n) => $h('span', { class: 'ico', html: ICON[n] });

export class WalkHud {
  constructor(app) {
    this.app = app;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.root = $h('div', { class: `walk-hud ${this.touch ? 'touch' : 'desk'}`, hidden: true });
    this.dot = $h('div', { class: 'crosshair', 'data-testid': 'crosshair' });
    this.aimLabel = $h('div', { class: 'aim-label', hidden: true, 'data-testid': 'aim-label' });
    this.carryLabel = $h('div', { class: 'carry-label', hidden: true, 'data-testid': 'carry-label' });
    this.doorLabel = $h('div', { class: 'door-label', hidden: true, 'data-testid': 'door-label' });
    this.noteEl = $h('div', { class: 'walk-note', hidden: true, 'data-testid': 'walk-note' });
    this.fadeEl = $h('div', { class: 'walk-fade' });
    this.lockHint = $h('div', { class: 'lock-hint', hidden: true }, 'Click the view to look around with the mouse · Esc releases it');
    this.root.append(this.fadeEl, this.dot, this.aimLabel, this.carryLabel, this.doorLabel, this.noteEl, this.lockHint);
    if (this.touch) this.buildTouch(); else this.buildKeys();
    this.last = {};
  }

  buildKeys() {
    const rows = [
      ['W A S D / arrows', 'walk'], ['Shift', 'run'], ['Mouse', 'look (click to lock, Esc releases)'],
      ['E', 'pick up / drop'], ['F', 'store'], ['R / Shift+R', 'rotate 15° (hold: 90°)'], ['Q', 'item card'],
      ['I / Tab', 'inventory'], ['Esc', 'cancel / put back'], ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ];
    this.keys = $h('div', { class: 'keys-panel', 'data-testid': 'keys-panel' },
      $h('div', { class: 'keys-head' }, $h('b', {}, 'Keys'), $h('button', { class: 'icon-btn small', 'aria-label': 'Hide key hints', onclick: () => this.setHints(false) }, ico('x'))),
      $h('dl', {}, ...rows.flatMap(([k, v]) => [$h('dt', {}, k), $h('dd', {}, v)])));
    this.keysBtn = $h('button', { class: 'keys-show btn small', onclick: () => this.setHints(true), 'aria-label': 'Show key hints' }, 'Keys');
    this.root.append(this.keys, this.keysBtn);
    this.setHints(this.app.settings.hints, false);
  }

  setHints(on, save = true) {
    if (!this.keys) return;
    this.keys.hidden = !on;
    this.keysBtn.hidden = on;
    if (save) { this.app.settings.hints = on; this.app.saveSettings(); }
  }

  buildTouch() {
    const app = this.app;
    this.joyBase = $h('div', { class: 'joy', 'data-testid': 'joystick' }, $h('div', { class: 'joy-knob' }));
    const btn = (name, label, icon, fn, cls = '') => $h('button', { class: `wbtn ${cls}`, 'data-act': name, 'aria-label': label, onclick: (e) => { e.stopPropagation(); app.sounds.unlock(); fn(); } }, ico(icon), $h('span', {}, label));
    this.primary = btn('primary', 'Pick up', 'hand', () => (app.walk.carry ? app.walk.drop() : app.walk.pickUp()), 'big');
    this.btns = {
      store: btn('store', 'Store', 'box', () => app.walk.store()),
      rotate: btn('rotate', 'Rotate', 'rot', () => app.walk.rotate(15)),
      info: btn('info', 'Info', 'info', () => app.walk.info()),
      bag: btn('bag', 'Bag', 'bag', () => app.ui.toggleInventory()),
      undo: btn('undo', 'Undo', 'undo', () => app.undo()),
      redo: btn('redo', 'Redo', 'redo', () => app.redo()),
      cancel: btn('cancel', 'Cancel', 'x', () => app.walk.cancel()),
    };
    // holding Rotate turns in 90° steps
    let hold = null;
    this.btns.rotate.addEventListener('pointerdown', () => { hold = setTimeout(function rep() { app.walk.rotateQuarter(1); hold = setTimeout(rep, 380); }, 450); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.btns.rotate.addEventListener(ev, () => clearTimeout(hold));
    this.pad = $h('div', { class: 'walk-btns' },
      $h('div', { class: 'wrow small' }, this.btns.undo, this.btns.redo, this.btns.bag),
      $h('div', { class: 'wrow' }, this.btns.info, this.btns.store),
      $h('div', { class: 'wrow' }, this.btns.rotate, this.btns.cancel, this.primary));
    this.root.append(this.joyBase, this.pad);
  }

  show(on) {
    this.root.hidden = !on;
    document.body.classList.toggle('walking', on);
    if (on) this.setLocked(!!document.pointerLockElement);
  }

  setLocked(locked) {
    this.locked = locked;
    this.lockHint.hidden = this.touch || locked || !!this.app.walk?.carry || this.root.hidden;
    this.dot.classList.toggle('locked', locked);
  }

  /** Called every frame with the walk state; touches the DOM only when something changed. */
  update({ door, aim, carry }) {
    const app = this.app;
    // doorway label, placed over the doorway when it is on screen
    const doorKey = door ? door.label : '';
    if (door) {
      const s = app.screenOfPoint({ x: door.center.x, y: door.center.y, z: 64 });
      const on = s.visible;
      this.doorLabel.hidden = !on;
      if (on) { this.doorLabel.style.left = `${s.x}px`; this.doorLabel.style.top = `${s.y}px`; }
      if (this.last.door !== doorKey) this.doorLabel.textContent = door.label;
    } else this.doorLabel.hidden = true;
    this.last.door = doorKey;

    const aimKey = aim && !carry ? aim.key : '';
    if (this.last.aim !== aimKey) {
      this.last.aim = aimKey;
      this.aimLabel.hidden = !aimKey;
      this.dot.classList.toggle('on', !!aimKey);
      if (aimKey && aim.item) {
        this.aimLabel.replaceChildren($h('b', {}, shortName(aim.item)), $h('span', { class: 'hint-keys' }, this.touch ? 'Pick up · Store · Info' : 'E pick up · F store · Q info'));
      }
    }
    if (this.touch) {
      const label = carry ? 'Drop' : 'Pick up';
      if (this.primary.dataset.label !== label) {
        this.primary.dataset.label = label;
        this.primary.replaceChildren(ico(carry ? 'drop' : 'hand'), $h('span', {}, label));
        this.primary.setAttribute('aria-label', label);
      }
      this.primary.disabled = !carry && !aimKey;
      this.btns.store.disabled = !carry && !aimKey;
      this.btns.info.disabled = !aimKey && !(carry && carry.source === 'room');
      this.btns.rotate.hidden = !carry;
      this.btns.cancel.hidden = !carry;
      this.btns.undo.disabled = !app.history.canUndo && !carry;
      this.btns.redo.disabled = !app.history.canRedo;
    }

    const p = carry?.preview;
    const ck = p ? `${p.status}|${p.reason}|${(p.titles || []).join(',')}|${carry.key}` : '';
    if (this.last.carry !== ck) {
      this.last.carry = ck;
      this.carryLabel.hidden = !p;
      this.dot.classList.toggle('carrying', !!p);
      if (p) {
        const text = p.status === 'ok' ? 'Fits here' : p.status === 'warn' ? p.titles[0] || 'Fits, with a warning' : p.reason;
        this.carryLabel.className = `carry-label ${p.status}`;
        this.carryLabel.dataset.status = p.status;
        this.carryLabel.replaceChildren(...[
          $h('div', { class: 'cl-name' }, shortName(carry.it)),
          $h('div', { class: 'cl-status' }, $h('i', { class: 'swatch-dot' }), text),
          this.touch ? null : $h('div', { class: 'hint-keys' }, 'E or click: drop · R: rotate · F: store · Esc: cancel')].filter(Boolean));
      }
      this.setLocked(this.locked);
    }
  }

  note(text) {
    this.noteEl.textContent = text;
    this.noteEl.hidden = false;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => { this.noteEl.hidden = true; }, 1600);
  }

  refuse(reason) {
    this.note(reason || 'It can’t go there.');
    this.carryLabel.classList.remove('shake');
    void this.carryLabel.offsetWidth;
    this.carryLabel.classList.add('shake');
  }

  fade(on) { this.fadeEl.classList.toggle('on', on); }

  // ---- joystick (phone)
  joystickZone() {
    if (!this.joyBase) return null;
    const h = window.innerHeight, w = window.innerWidth;
    return { right: Math.min(w * 0.5, 260), top: h * 0.5 };
  }
  joystickStart() { this.joyBase.classList.add('active'); }
  joystickMove(x, y) {
    const r = this.joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    this.joyBase.firstChild.style.transform = `translate(${dx}px, ${dy}px)`;
    const v = { x: dx / R, y: -dy / R };
    const m = Math.hypot(v.x, v.y);
    return m < 0.12 ? { x: 0, y: 0 } : v; // small dead zone
  }
  joystickEnd() {
    this.joyBase.classList.remove('active');
    this.joyBase.firstChild.style.transform = '';
  }
}

export { roomToWorld };
