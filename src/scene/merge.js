// Fewer draw calls: the room shell and each piece are built from many small meshes; meshes that never
// move or toggle on their own and look the same are merged into one. This matters most on phones,
// where each draw call costs CPU time.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Flags (userData) that keep a mesh, and everything under it, separate. */
const KEEP = ['keep', 'setPiece', 'glowShell'];

/** Plain colored surfaces (no texture, no glow, opaque) can share one material: their color moves
 *  into the vertices. */
const recolorable = (m) => m.isMeshStandardMaterial && !m.map && !m.vertexColors && !m.transparent && (!m.emissive || m.emissive.getHex() === 0);

function materialKey(m, withColor = true) {
  const hex = (c) => (c ? c.getHexString() : '-');
  return [m.type, withColor ? hex(m.color) : 'vc', hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.alphaMap?.uuid, m.normalMap?.uuid,
    m.side, m.transparent, m.opacity, m.depthWrite, m.colorWrite, m.vertexColors, m.flatShading, m.envMapIntensity].join('|');
}

function kept(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible || KEEP.some((k) => p.userData[k])) return true;
  return false;
}

/** Copy of `g` in `root`'s frame, non-indexed, with exactly position/normal/uv. */
function prepared(g, matrix) {
  const x = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(name)) x.deleteAttribute(name);
  if (!x.attributes.normal) x.computeVertexNormals();
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  x.morphAttributes = {};
  x.clearGroups();
  x.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    // a mirrored transform turns triangles inside out: swap two corners of each one back
    for (const a of Object.values(x.attributes)) {
      const n = a.itemSize, arr = a.array;
      for (let t = 0; t < a.count; t += 3) for (let k = 0; k < n; k++) { const i = (t + 1) * n + k, j = (t + 2) * n + k; [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
  }
  return x;
}

const shared = new Map();
function vertexColorMaterial(m) {
  const k = materialKey(m, false);
  if (!shared.has(k)) {
    const v = m.clone();
    v.color.set('#ffffff');
    v.vertexColors = true;
    shared.set(k, v);
  }
  return shared.get(k);
}

/** Merge the static meshes under `root` (in place). Returns how many meshes were removed. */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || Array.isArray(m.material) || kept(m, root)) return;
    const k = `${materialKey(m.material, !recolorable(m.material))}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.name === 'glass' ? 'glass' : ''}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(m);
  });
  let removed = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const recolor = recolorable(first.material) && list.some((m) => !m.material.color.equals(first.material.color));
    const geos = list.map((m) => {
      const g = prepared(m.geometry, new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (recolor) {
        const c = m.material.color, n = g.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
      }
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, recolor ? vertexColorMaterial(first.material) : first.material);
    mesh.name = first.name;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData = { ...first.userData, merged: list.length };
    if (first.raycast !== THREE.Mesh.prototype.raycast) mesh.raycast = first.raycast;
    root.add(mesh);
    for (const m of list) m.parent.remove(m);
    removed += list.length - 1;
  }
  return removed;
}
