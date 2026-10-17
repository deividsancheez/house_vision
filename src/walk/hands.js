// Simple low-poly first-person hands: neutral, mannequin-like (no skin tone, no likeness). They sit at
// the bottom of the view, hold small pieces, and reach toward big ones floating ahead. They are
// drawn in their own small scene after the room, so they never poke into a wall.
import * as THREE from 'three';

const SKIN = '#b8b0a7'; // neutral mannequin gray-beige

function hand(mat, side) {
  const g = new THREE.Group();
  const s = side; // +1 right, -1 left
  const box = (w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
    return m;
  };
  // forearm (tapered, 6 sides) toward the viewer
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.3, 6), mat);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, -0.005, 0.2);
  g.add(arm);
  box(0.085, 0.028, 0.095, 0, 0, 0); // palm (fingers point -z)
  // four fingers, two segments each, slightly curled
  for (let i = 0; i < 4; i++) {
    const x = (-0.03 + i * 0.02) * s;
    const len = [0.05, 0.058, 0.055, 0.044][i];
    box(0.017, 0.017, len, x, 0.002, -0.0475 - len / 2, 0.12);
    box(0.016, 0.016, len * 0.7, x, -0.006, -0.0475 - len - len * 0.33, 0.45);
  }
  // thumb, out to the side
  const th = box(0.02, 0.02, 0.055, 0.05 * s, -0.004, -0.01, 0.2);
  th.rotation.y = 0.75 * s;
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  return g;
}

/** Hand poses in camera space (meters): position, rotation (x, y, z). */
const POSES = {
  idle: { r: [0.21, -0.27, -0.44, -0.35, -0.25, 0.25], l: [-0.21, -0.27, -0.44, -0.35, 0.25, -0.25] },
  guide: { r: [0.17, -0.19, -0.5, 0.25, -0.1, 0.4], l: [-0.17, -0.19, -0.5, 0.25, 0.1, -0.4] },
};

export class Hands {
  constructor() {
    this.scene = new THREE.Scene();
    this.rig = new THREE.Group(); // follows the camera
    this.scene.add(this.rig);
    const mat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85, flatShading: true });
    this.right = hand(mat, 1);
    this.left = hand(mat, -1);
    this.rig.add(this.right, this.left);
    this.heldSlot = new THREE.Group(); // a small piece carried in the hands
    this.rig.add(this.heldSlot);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#8a8178', 1.6);
    this.key = new THREE.DirectionalLight('#ffffff', 1.4);
    this.key.position.set(0.4, 1, 0.6);
    this.scene.add(this.hemi, this.key);
    this.target = POSES.idle;
    this.current = { r: [...POSES.idle.r], l: [...POSES.idle.l] };
    this.t = 0;
    this.visible = true;
    this.apply(0);
  }

  /** idle, guide (big piece floating ahead), or hold (a small piece; dims {w, d, h} in meters).
   *  A held piece sits low in the view, its top a little under the eye line, so the dot stays clear. */
  setPose(kind, dims = { w: 0.3, d: 0.3, h: 0.3 }) {
    if (kind === 'hold') {
      const z = -(0.62 + dims.d / 2), y = -(0.14 + dims.h / 2);
      const hx = Math.min(0.45, dims.w / 2 + 0.035), hy = y - Math.min(0.08, dims.h * 0.25);
      this.target = { r: [hx, hy, z + 0.06, 0.1, -0.2, 1.35], l: [-hx, hy, z + 0.06, 0.1, 0.2, -1.35] };
      this.heldY = y;
      this.heldSlot.position.set(0, y, z);
    } else { this.target = POSES[kind] || POSES.idle; this.heldY = null; }
  }

  /** Lights: roughly the room's (dim and warm at night), corrected for the tone-mapping exposure. */
  setLook(night, exposure) {
    const k = 1 / Math.max(0.05, exposure);
    this.hemi.color.set(night ? '#ffd9b0' : '#ffffff');
    this.hemi.intensity = (night ? 0.55 : 1.6) * k * (night ? 0.24 : 1);
    this.key.intensity = (night ? 0.5 : 1.4) * k * (night ? 0.24 : 1);
  }

  /** Ease toward the target pose, with an optional small idle sway. Returns true while moving. */
  update(dt, sway) {
    this.t += dt;
    let moving = false;
    const k = Math.min(1, dt * 10);
    for (const side of ['r', 'l']) {
      for (let i = 0; i < 6; i++) {
        const d = this.target[side][i] - this.current[side][i];
        if (Math.abs(d) > 1e-4) moving = true;
        this.current[side][i] += d * k;
      }
    }
    this.apply(sway ? 1 : 0);
    return moving || sway;
  }

  apply(swayAmt) {
    const s = swayAmt * 0.004;
    const t = this.t;
    for (const [side, obj, ph] of [['r', this.right, 0], ['l', this.left, 1.7]]) {
      const c = this.current[side];
      obj.position.set(c[0] + Math.sin(t * 1.1 + ph) * s, c[1] + Math.sin(t * 1.6 + ph) * s, c[2]);
      obj.rotation.set(c[3], c[4], c[5]);
    }
    if (this.heldY !== null && this.heldY !== undefined) this.heldSlot.position.y = this.heldY + Math.sin(t * 1.4) * s;
  }

  /** Put a piece's model (room inches, z up) in the hands, centered, at true size. */
  hold(model, dims) {
    this.clearHeld();
    if (!model) return;
    const g = new THREE.Group();
    g.scale.setScalar(0.0254);
    g.rotation.x = -Math.PI / 2; // room z-up -> y-up
    model.position.set(0, 0, -dims.h / 2);
    g.add(model);
    this.heldSlot.add(g);
  }

  clearHeld() { this.heldSlot.clear(); }

  /** Follow the camera (call before rendering). */
  follow(camera) {
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
  }
}
