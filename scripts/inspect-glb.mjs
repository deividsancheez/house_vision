import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
for (const f of fs.readdirSync(process.argv[2]).filter(f => f.endsWith('.glb'))) {
  const doc = await io.read(process.argv[2] + '/' + f);
  const r = doc.getRoot();
  const scene = r.getDefaultScene() || r.listScenes()[0];
  const b = getBounds(scene);
  const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  let tris = 0;
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  console.log(f, 'size(m)', size, 'min', b.min.map(v=>+v.toFixed(3)), 'tris', tris, 'meshes', r.listMeshes().length,
    'mats', r.listMaterials().map(m => m.getName()).join('|'),
    'tex', r.listTextures().map(t => `${t.getMimeType()} ${t.getSize()} ${(t.getImage().length/1024|0)}KB`).join(', '),
    'ext', r.listExtensionsUsed().map(e => e.extensionName).join(','));
}
