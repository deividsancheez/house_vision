// Walk-mode input. Desktop: WASD / arrows to walk, Shift to run, mouse to look (click the view to
// lock the pointer, Esc to release; dragging also looks if the pointer isn't locked), E pick up /
// drop, F store, R rotate (Shift+R the other way, hold for 90° steps), Q item card, I or Tab
// inventory, Esc cancel, Ctrl+Z / Ctrl+Y undo / redo.
// Phone: a joystick at the bottom left walks, dragging anywhere else looks, a tap drops what you
// carry; the action buttons are in the HUD (ui/walkHud.js).

const MOVE_KEYS = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};
const HOLD_R_MS = 380;

export function setupWalkInput(app) {
  const walk = app.walk;
  const el = app.canvas;
  let rHold = null;
  const typing = (e) => e.target.closest?.('input, textarea, select');
  const walking = () => app.viewMode === 'walk' && !app.ui.modalOpen() && !app.tutorialBlocks?.();

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) app.redo(); else app.undo();
      return;
    }
    if (app.viewMode !== 'walk') return;
    app.sounds.unlock();
    if ((e.code === 'KeyI' || e.code === 'Tab') && !ctrl) {
      e.preventDefault();
      app.ui.toggleInventory();
      return;
    }
    if (e.code === 'Escape') {
      if (app.ui.closeTop()) return;
      if (walk.carry) { walk.cancel(); return; }
      if (app.selected) app.select(null);
      return;
    }
    if (!walking()) return;
    const mv = MOVE_KEYS[e.code];
    if (mv) { e.preventDefault(); walk.keyDown(mv); return; }
    if (e.repeat) return;
    if (e.code === 'KeyE') { if (walk.carry) walk.drop(); else walk.pickUp(); }
    else if (e.code === 'KeyF') walk.store();
    else if (e.code === 'KeyQ') walk.info();
    else if (e.code === 'KeyR') {
      const dir = e.shiftKey ? -1 : 1;
      walk.rotate(15 * dir);
      clearInterval(rHold?.timer);
      rHold = { timer: setInterval(() => walk.rotateQuarter(dir), HOLD_R_MS) };
    }
  });
  window.addEventListener('keyup', (e) => {
    const mv = MOVE_KEYS[e.code];
    if (mv) walk.keyUp(mv);
    if (e.code === 'KeyR' && rHold) { clearInterval(rHold.timer); rHold = null; }
  });
  window.addEventListener('blur', () => { walk.keys.clear(); if (rHold) { clearInterval(rHold.timer); rHold = null; } });

  // ---- mouse
  let mouse = null;
  const locked = () => document.pointerLockElement === el;
  const lock = () => {
    try {
      const r = el.requestPointerLock?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* not allowed here: dragging still looks around */ }
  };
  document.addEventListener('pointerlockchange', () => app.ui.walkHud?.setLocked(locked()));
  document.addEventListener('pointerlockerror', () => app.ui.walkHud?.setLocked(false));

  el.addEventListener('pointerdown', (e) => {
    if (app.viewMode !== 'walk') return;
    app.sounds.unlock();
    if (e.pointerType === 'touch') return touchDown(e);
    if (locked()) { if (e.button === 0 && walk.carry) walk.drop(); return; }
    mouse = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (app.viewMode !== 'walk') return;
    if (e.pointerType === 'touch') return touchMove(e);
    if (locked()) { walk.look(e.movementX || 0, e.movementY || 0); return; }
    if (mouse && e.pointerId === mouse.id && e.buttons) {
      const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
      mouse.moved += Math.abs(dx) + Math.abs(dy);
      mouse.x = e.clientX; mouse.y = e.clientY;
      walk.look(dx, dy);
    }
  });
  el.addEventListener('pointerup', (e) => {
    if (app.viewMode !== 'walk') return;
    if (e.pointerType === 'touch') return touchUp(e);
    if (!mouse || e.pointerId !== mouse.id) return;
    const click = mouse.moved < 6;
    mouse = null;
    if (!click) return;
    if (walk.carry) walk.drop();
    else if (!app.tutorial) lock();
  });

  // ---- touch: joystick (bottom-left) + look (anywhere else) + tap to drop
  const touches = new Map();
  const hud = () => app.ui.walkHud;
  function touchDown(e) {
    const r = el.getBoundingClientRect();
    const joyZone = hud()?.joystickZone();
    const inJoy = joyZone && e.clientX - r.left < joyZone.right && e.clientY - r.top > joyZone.top;
    if (inJoy && ![...touches.values()].some((t) => t.joy)) {
      touches.set(e.pointerId, { joy: true });
      hud()?.joystickStart(e.clientX, e.clientY);
      joyMove(e);
    } else touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function joyMove(e) {
    const v = hud()?.joystickMove(e.clientX, e.clientY) || { x: 0, y: 0 };
    walk.joy = v;
    app.invalidate();
  }
  function touchMove(e) {
    const t = touches.get(e.pointerId);
    if (!t) return;
    if (t.joy) return joyMove(e);
    walk.look(e.clientX - t.x, e.clientY - t.y, true);
    t.x = e.clientX; t.y = e.clientY;
  }
  function touchUp(e) {
    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (!t) return;
    if (t.joy) { walk.joy = { x: 0, y: 0 }; hud()?.joystickEnd(); return; }
    const tap = Math.hypot(e.clientX - t.x0, e.clientY - t.y0) < 10 && performance.now() - t.t < 350;
    if (tap && walk.carry) walk.drop();
  }
  el.addEventListener('pointercancel', (e) => {
    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (t?.joy) { walk.joy = { x: 0, y: 0 }; hud()?.joystickEnd(); }
    mouse = null;
  });

  return { lock, locked };
}
