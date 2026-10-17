// Loads the IKEA .glb files stored with the app (public/models/, never IKEA's servers) and fits
// them to the product's dimensions from products.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const base = import.meta.env?.BASE_URL ?? './';
const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
const loader = new GLTFLoader().setDRACOLoader(draco);
let manifestP = null;
const templates = new Map();

export function modelManifest() {
  manifestP ||= fetch(`${base}models/manifest.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifestP;
}

export async function hasModel(productId) {
  return !!(await modelManifest())[productId];
}

export async function loadTemplate(productId) {
  const file = (await modelManifest())[productId];
  if (!file) return null;
  if (!templates.has(file)) templates.set(file, loader.loadAsync(`${base}models/${file}`).then((g) => g.scene));
  return templates.get(file);
}

// glTF is y-up with the front toward +z. Our item frame is z-up with the front toward +y:
// x' = -X, y' = Z, z' = Y (a proper rotation).
const GLTF_TO_LOCAL = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

// Model-specific corrections, checked against renders of each file:
//  BR-ART-A: IKEA ships the frame lying face-up; stand it up.
const ORIENT = { 'BR-ART-A': new THREE.Matrix4().makeRotationX(-Math.PI / 2) };

/**
 * Clone the template, keep only meshes accepted by `filter(meshCenterInGltfCoords)`, orient it,
 * then scale each axis so its bounding box equals dims {w, d, h}, origin at the bottom center.
 */
export function fitTemplate(template, productId, dims, filter = null) {
  const src = template.clone(true);
  src.updateMatrixWorld(true);
  const parts = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.name === 'LIGHT_SOURCE') return;
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    if (filter && !filter(c)) return;
    parts.push(o);
  });
  const inner = new THREE.Group();
  for (const o of parts) {
    const m = new THREE.Mesh(o.geometry, o.material);
    m.matrixAutoUpdate = false;
    m.matrix.copy(o.matrixWorld);
    m.castShadow = true;
    m.receiveShadow = true;
    inner.add(m);
  }
  const orient = new THREE.Matrix4().copy(ORIENT[productId] || new THREE.Matrix4()).multiply(GLTF_TO_LOCAL);
  for (const m of inner.children) m.matrix.premultiply(orient);
  const box = new THREE.Box3();
  for (const m of inner.children) {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
  }
  const size = box.getSize(new THREE.Vector3());
  const s = new THREE.Vector3(dims.w / size.x, dims.d / size.y, dims.h / size.z);
  const fit = new THREE.Matrix4().makeScale(s.x, s.y, s.z).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z));
  for (const m of inner.children) {
    m.matrix.premultiply(fit);
    m.matrixWorldNeedsUpdate = true;
    // non-uniform scale on a mirrored matrix would flip faces; materials stay single-sided-safe
    if (m.matrix.determinant() < 0) m.material = Object.assign(m.material.clone(), { side: THREE.DoubleSide });
  }
  const g = new THREE.Group();
  g.add(inner);
  g.userData.glb = true;
  g.userData.scale = s;
  return g;
}
