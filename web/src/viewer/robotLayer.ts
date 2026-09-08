import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { ModelDescription, WorldSnapshot } from '../../../contracts/index';

/** Robot geometry and poses share MuJoCo's canonical world basis. No local animation. */
export function createRobotLayer(model: ModelDescription, onProgress: (loaded: number, total: number) => void, onError: (message: string) => void) {
  const root = new THREE.Group();
  const bodies = new Map<string, THREE.Group>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.MeshLambertMaterial>();
  const cache = new Map<string, Promise<THREE.BufferGeometry>>();
  const loader = new STLLoader();
  const definitions = model.geoms.filter(geometry => /^(g1_a|g1_b)\//.test(geometry.body) && geometry.kind === 'mesh' && geometry.mesh);
  let alive = true;
  let loaded = 0;
  onProgress(0, definitions.length);
  for (const definition of definitions) {
    let pending = cache.get(definition.mesh!);
    if (!pending) { pending = loader.loadAsync(definition.mesh!); cache.set(definition.mesh!, pending); }
    void pending.then(geometry => {
      if (!alive) { geometry.dispose(); return; }
      geometries.add(geometry);
      let body = bodies.get(definition.body);
      if (!body) { body = new THREE.Group(); body.visible = false; bodies.set(definition.body, body); root.add(body); }
      const rgba = definition.rgba;
      const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(rgba[0], rgba[1], rgba[2]), opacity: rgba[3], transparent: rgba[3] < 1 });
      materials.add(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.fromArray(definition.local_position);
      const [w, x, y, z] = definition.local_quaternion;
      mesh.quaternion.set(x, y, z, w);
      body.add(mesh);
      onProgress(++loaded, definitions.length);
    }).catch(error => { if (alive) onError(`G1 mesh could not load: ${error instanceof Error ? error.message : definition.mesh}`); });
  }
  return {
    root,
    update(snapshot: WorldSnapshot | null) {
      if (!snapshot) { root.visible = false; return; }
      root.visible = true;
      for (const pose of snapshot.bodies) {
        const body = bodies.get(pose.name);
        if (!body) continue;
        body.visible = true;
        body.position.fromArray(pose.position);
        const [w, x, y, z] = pose.quaternion;
        body.quaternion.set(x, y, z, w);
      }
    },
    dispose() {
      alive = false;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.clear();
    },
  };
}
