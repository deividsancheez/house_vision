// The ONE place where real-world inches become Three.js units.
// Every measurement in room-spec.json / products.json is in inches; the scene is built in
// room coordinates (inches, z up) inside a "room root" group that applies this conversion.
import * as THREE from 'three';

export const WORLD_UNITS_PER_INCH = 0.0254; // 1 Three.js unit = 1 meter, so light falloff is physical
export const toWorld = (inches) => inches * WORLD_UNITS_PER_INCH;
export const toInches = (world) => world / WORLD_UNITS_PER_INCH;

// Room frame (room-spec.json): x and y on the floor, z up, right-handed.
// Three.js frame: y up. Mapping (x, y, z)room -> (x, z, -y)world is a proper rotation (-90 deg about X),
// so counter-clockwise rotation about room +z stays counter-clockwise about world +y.
export function makeRoomRoot() {
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(WORLD_UNITS_PER_INCH);
  root.updateMatrixWorld(true);
  return root;
}

export function roomToWorld(p, out = new THREE.Vector3()) {
  return out.set(toWorld(p.x), toWorld(p.z), -toWorld(p.y));
}

export function worldToRoom(v) {
  return { x: toInches(v.x), y: -toInches(v.z), z: toInches(v.y) };
}

export function roomDirToWorld(d, out = new THREE.Vector3()) {
  return out.set(d.x, d.z, -d.y).normalize();
}
