// Day / night lighting from room-spec.json "lighting" and each room's "daylight".
//  Day: sun through the window (east living room in the morning, west bedroom in the afternoon),
//       sky light from the window, lamps off.
//  Night: lamps, sconces and fan lights at their color temperature and lumens (PointLight.power is
//       in lumens because the scene is in meters with physical falloff), window light off.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { roomToWorld, roomDirToWorld, toWorld } from '../units.js';

RectAreaLightUniformsLib.init();

/** Approximate sRGB color of a black body at `kelvin` (Tanner Helland's fit). */
export function kelvinToColor(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; } else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

/** Lamp color as a phone camera would record it: auto white balance under warm light settles near
 *  3400K, so 2700K bulbs read warm but not orange, and a 1900K candle stays clearly orange. */
export const WHITE_BALANCE_K = 3400;
export function lampColor(kelvin) {
  const c = kelvinToColor(kelvin), wb = kelvinToColor(WHITE_BALANCE_K);
  c.setRGB(c.r / wb.r, c.g / wb.g, c.b / wb.b);
  const m = Math.max(c.r, c.g, c.b);
  return c.multiplyScalar(1 / m);
}

export const LOOK = {
  day: { exposure: 1.0, env: 0.42, hemi: 0.7, sun: 5.5, window: 9 },
  // night exposure adapts like an eye or phone camera: `exposure` is used at `refLumensPerM2` of lit
  // lamps per square meter of floor and scales inversely with that density
  night: { exposure: 0.24, refLumensPerM2: 80, env: 0.12, hemi: 0.35, lampScale: 1.0 },
};

export class RoomLighting {
  /** lights: the room-spec lighting entries to make lamps for (default: this room's). */
  constructor(scene, rb, quality, lights = null) {
    this.scene = scene;
    this.rb = rb;
    this.room = rb.room;
    this.group = new THREE.Group();
    this.group.name = `lights-${this.room.id}`;
    scene.add(this.group);
    const b = this.room.bounds;
    this.center = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: 0 };
    this.floorM2 = this.room.regions.reduce((a, poly) => a + Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2, 0) * 0.0254 ** 2;

    // ground color: light bounced off the floor and white walls (keeps the ceiling paint-white)
    this.hemi = new THREE.HemisphereLight('#e7eef6', '#d2c9be', LOOK.day.hemi);
    this.group.add(this.hemi);

    // Sun
    const dl = this.room.daylight;
    const v = dl.sun_vector_morning || dl.sun_vector_afternoon;
    this.sun = new THREE.DirectionalLight('#fff0d9', LOOK.day.sun);
    const dirW = roomDirToWorld(v);
    const target = roomToWorld({ ...this.center, z: 0 });
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(dirW, -12);
    this.sun.castShadow = true;
    const ext = toWorld(Math.max(b.x1 - b.x0, b.y1 - b.y0)) * 0.8;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 30 });
    this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.group.add(this.sun, this.sun.target);

    // Sky light through each window
    this.windowLights = [];
    for (const w of rb.windows) {
      const o = w.opening;
      const width = o.along_to - o.along_from, height = o.head_z - o.sill_z;
      const l = new THREE.RectAreaLight('#eaf2ff', LOOK.day.window, toWorld(width), toWorld(height));
      const midAlong = (o.along_from + o.along_to) / 2;
      const p = { x: w.wall.from.x + w.wall.dir.x * midAlong + w.wall.normal.x * 0.5, y: w.wall.from.y + w.wall.dir.y * midAlong + w.wall.normal.y * 0.5, z: o.sill_z + height / 2 };
      l.position.copy(roomToWorld(p));
      l.lookAt(roomToWorld({ x: p.x + w.wall.normal.x * 10, y: p.y + w.wall.normal.y * 10, z: p.z }));
      this.windowLights.push(l);
      this.group.add(l);
    }

    // Lamps (room-spec lighting entries, positioned by the room scene each layout change)
    this.lamps = [];
    this.specs = lights || this.room.lights || [];
    for (const spec of this.specs) {
      if (!spec.position) continue;
      const pl = new THREE.PointLight(lampColor(spec.color_temp_k ?? 2700), 0, 0, 2);
      pl.power = spec.lumens ?? 0;
      pl.castShadow = false;
      pl.userData.spec = spec;
      pl.userData.lumens = spec.lumens ?? 0;
      this.lamps.push(pl);
      this.group.add(pl);
    }
  }

  /** anchors: Map(lightId -> {pos:{x,y,z} | null}) computed from the items in the layout. */
  apply(mode, anchors, renderer, scene) {
    const day = mode === 'day';
    renderer.toneMappingExposure = day ? LOOK.day.exposure : LOOK.night.exposure;
    scene.environmentIntensity = day ? LOOK.day.env : LOOK.night.env;
    this.hemi.intensity = day ? LOOK.day.hemi : LOOK.night.hemi;
    this.hemi.color.set(day ? '#e7eef6' : '#ffe2c2');
    this.sun.visible = day;
    for (const l of this.windowLights) l.visible = day;
    for (const pl of this.lamps) {
      const spec = pl.userData.spec;
      const a = anchors.get(spec.id);
      const want = day ? /^on/i.test(spec.day_mode || '') : !/^off/i.test(spec.night_mode || 'on');
      pl.visible = !!(a && a.pos && want);
      if (pl.visible) {
        pl.position.copy(roomToWorld(a.pos));
        pl.power = pl.userData.lumens * (day ? 1 : LOOK.night.lampScale);
      }
    }
    const on = this.lamps.filter((l) => l.visible);
    if (!day) {
      const density = on.reduce((a, l) => a + l.power, 0) / this.floorM2;
      const n = LOOK.night;
      renderer.toneMappingExposure = Math.min(0.5, Math.max(0.08, n.exposure * (n.refLumensPerM2 / Math.max(1, density))));
    }
    return on.map((l) => l.userData.spec.id);
  }

  dispose() {
    this.scene.remove(this.group);
    this.sun.shadow.map?.dispose();
  }
}
