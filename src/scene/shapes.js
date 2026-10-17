// Small geometry helpers for building models in the room frame: inches, z up, front = +y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function finish(mesh, { cast = true, receive = true } = {}) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Box w (x) by d (y) by h (z); (x, y) is its center, z its bottom. */
export function box(w, d, h, material, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material);
  m.position.set(x, y, z + h / 2);
  return finish(m, opts);
}

export function rbox(w, d, h, r, material, x = 0, y = 0, z = 0, opts) {
  const rr = Math.min(r, w / 2 - 0.01, d / 2 - 0.01, h / 2 - 0.01);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, d, h, 3, Math.max(0.01, rr)), material);
  m.position.set(x, y, z + h / 2);
  return finish(m, opts);
}

/** Vertical cylinder/cone with bottom at z. */
export function cyl(rTop, rBot, h, material, x = 0, y = 0, z = 0, seg = 24, opts = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!opts.open);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z + h / 2);
  return finish(m, opts);
}

/** Cylinder between two points (legs, rods, arms). */
export function strut(a, b, r, material, seg = 10, opts) {
  const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const m = new THREE.Mesh(g, material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return finish(m, opts);
}

/** Tapered leg from top point down to the floor, splayed outward by `splay` inches. */
export function taperedLeg(x, y, top, rTop, rBot, material, splayX = 0, splayY = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, 1, 10);
  g.translate(0, -0.5, 0);
  const m = new THREE.Mesh(g, material);
  const a = new THREE.Vector3(x, y, top), b = new THREE.Vector3(x + splayX, y + splayY, 0);
  const len = a.distanceTo(b);
  m.scale.set(1, len, 1);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b.clone().sub(a).normalize());
  return finish(m);
}

export function sphere(r, material, x = 0, y = 0, z = 0, seg = 16, opts) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), material);
  m.position.set(x, y, z);
  return finish(m, opts);
}

/** Flat rectangle facing +y (a picture face, a screen) centered at (x, y, z). */
export function plane(w, h, material, x = 0, y = 0, z = 0, opts) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(Math.PI / 2); // now faces -y, upright
  g.rotateZ(Math.PI); // faces +y, still upright and not mirrored
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return finish(m, { cast: false, ...opts });
}

/** A rounded disc / ring lying flat. */
export function disc(r, material, z = 0, seg = 48) {
  const g = new THREE.CircleGeometry(r, seg);
  const m = new THREE.Mesh(g, material);
  m.position.z = z;
  return finish(m, { cast: false });
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children.flat()) if (c) g.add(c);
  return g;
}

/** Lathe around z: profile = [[radius, z], ...]. */
export function lathe(profile, material, seg = 32, opts) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  return finish(m, opts);
}

/** Pleated / scalloped lamp shade or fluted drum: radius varies with angle. */
export function fluted(rTop, rBot, h, flutes, depth, material, z = 0, opts = {}) {
  const seg = flutes * 6;
  const g = new THREE.CylinderGeometry(1, 1, h, seg, 1, !!opts.open);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i);
    const a = Math.atan2(zz, x);
    const t = (y + h / 2) / h;
    const r = (rBot + (rTop - rBot) * t) * (1 - depth * (0.5 - 0.5 * Math.cos(a * flutes)));
    const l = Math.hypot(x, zz) || 1;
    pos.setX(i, (x / l) * r); pos.setZ(i, (zz / l) * r);
  }
  g.computeVertexNormals();
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, material);
  m.position.z = z + h / 2;
  return finish(m, opts);
}

/** Puffy cushion: a rounded box whose faces bulge outward. */
export function cushion(w, d, h, material, puff = 0.3, x = 0, y = 0, z = 0) {
  const g = new RoundedBoxGeometry(w, d, h, 4, Math.min(w, d, h) * 0.25);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / (w / 2), pz = pos.getZ(i) / (h / 2);
    const bulge = (1 - Math.min(1, px * px)) * (1 - Math.min(1, pz * pz));
    pos.setY(i, pos.getY(i) * (1 + puff * bulge));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z + h / 2);
  return finish(m);
}

/** Bounding box of an object in its parent's frame. */
export function localBounds(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes.position;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i += 1) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  });
  return box;
}
