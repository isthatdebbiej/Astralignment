import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Crosshair, Maximize2, RotateCcw, ScanLine } from 'lucide-react';
import type { ModelDescription, WorldSnapshot, VisualGeom, QuatWXYZ } from '../../../contracts/index';

interface Props { model: ModelDescription | null; state: WorldSnapshot | null; connected: boolean; mode: string; }
const applyQuat = (target: THREE.Quaternion, source?: QuatWXYZ) => { if (source) target.set(source[1], source[2], source[3], source[0]); };

export function SimulationStage({ model, state, connected, mode }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const latestState = useRef(state);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [assetState, setAssetState] = useState({ loaded: 0, total: 0, error: '' });
  const [webglError, setWebglError] = useState('');
  const [wireframe, setWireframe] = useState(false);
  const wireframeRef = useRef(false);
  latestState.current = state;
  wireframeRef.current = wireframe;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { setWebglError('WebGL is unavailable. Enable hardware acceleration to inspect the simulation.'); return; }
    setWebglError('');
    let alive = true;
    let frame = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10171c');
    scene.fog = new THREE.Fog('#10171c', 13, 28);
    // MuJoCo is authoritative: meters, right-handed, Z up, XY floor.
    const camera = new THREE.PerspectiveCamera(37, 1, 0.03, 80);
    camera.up.set(0, 0, 1);
    camera.position.set(5.0, -7.0, 5.5);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Live MuJoCo simulation. Drag to orbit, scroll to zoom, right drag to pan.');
    renderer.domElement.tabIndex = 0;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.set(0, 0, 0.55);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.update();
    controls.saveState();
    scene.add(new THREE.HemisphereLight(0xdcecf7, 0x3c474e, 2.2));
    const key = new THREE.DirectionalLight(0xfff0d6, 3.4);
    key.position.set(-3, -4, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 25 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8eccec, 1.8);
    fill.position.set(4, 4, 5);
    scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#172129', roughness: 0.95, metalness: 0.1 }));
    floor.position.z = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(24, 48, 0x52616a, 0x2c3a43);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.009;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    scene.add(grid);

    const groups = new Map<string, THREE.Group>();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const loader = new STLLoader();
    const meshCache = new Map<string, Promise<THREE.BufferGeometry>>();
    const meshMaterials: THREE.MeshStandardMaterial[] = [];
    const textures = new Set<THREE.Texture>();
    const markers = new Map<string, THREE.Sprite>();
    const addLabel = (text: string, color: string, position: THREE.Vector3, scale = 0.8) => {
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 80;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#14212ae8'; context.beginPath(); context.roundRect(0, 0, 384, 80, 12); context.fill();
      context.strokeStyle = color; context.lineWidth = 2; context.stroke();
      context.font = '500 26px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = color; context.fillText(text, 192, 42);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }); materials.add(material);
      const sprite = new THREE.Sprite(material); sprite.scale.set(scale, scale * 80 / 384, 1); sprite.position.copy(position); scene.add(sprite); return sprite;
    };
    if (model?.scene) {
      const { width, depth, keepouts, robots } = model.scene;
      const borderGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-width / 2, -depth / 2, 0.009), new THREE.Vector3(width / 2, -depth / 2, 0.009), new THREE.Vector3(width / 2, depth / 2, 0.009), new THREE.Vector3(-width / 2, depth / 2, 0.009)]);
      const borderMaterial = new THREE.LineBasicMaterial({ color: '#80918b', transparent: true, opacity: 0.48 });
      geometries.add(borderGeometry); materials.add(borderMaterial); scene.add(new THREE.LineLoop(borderGeometry, borderMaterial));
      for (const zone of keepouts ?? []) {
        if (zone.polygon.length < 3) continue;
        const shape = new THREE.Shape(zone.polygon.map(point => new THREE.Vector2(point[0], point[1])));
        const geometry = new THREE.ShapeGeometry(shape); geometries.add(geometry);
        const material = new THREE.MeshBasicMaterial({ color: '#b79668', transparent: true, opacity: 0.105, side: THREE.DoubleSide, depthWrite: false }); materials.add(material);
        const area = new THREE.Mesh(geometry, material); area.position.z = 0.005; scene.add(area);
        const outline = new THREE.BufferGeometry().setFromPoints(zone.polygon.map(point => new THREE.Vector3(point[0], point[1], 0.009))); geometries.add(outline);
        const lineMaterial = new THREE.LineDashedMaterial({ color: '#a78965', dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.55 }); materials.add(lineMaterial);
        const line = new THREE.LineLoop(outline, lineMaterial); line.computeLineDistances(); scene.add(line);
        const center = zone.polygon.reduce((sum, point) => sum.add(new THREE.Vector3(point[0], point[1], 0)), new THREE.Vector3()).divideScalar(zone.polygon.length);
        center.z = 0.14; addLabel(`${zone.id.toUpperCase()} · KEEPOUT`, '#b5a58b', center, 1.2);
      }
      robots.forEach((robot, index) => {
        const color = index === 0 ? '#a6c9ba' : '#b4b9e1';
        const ringGeometry = new THREE.RingGeometry(0.22, 0.245, 48); geometries.add(ringGeometry);
        const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }); materials.add(ringMaterial);
        const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.position.set(robot.goal[0], robot.goal[1], 0.015); scene.add(ring);
        const innerGeometry = new THREE.RingGeometry(0.055, 0.066, 24); geometries.add(innerGeometry);
        const inner = new THREE.Mesh(innerGeometry, ringMaterial); inner.position.copy(ring.position); scene.add(inner);
        addLabel(`${index === 0 ? 'A' : 'B'} / GOAL`, color, new THREE.Vector3(robot.goal[0], robot.goal[1], 0.11), 0.64);
        const marker = addLabel(`G1—${index === 0 ? 'A' : 'B'}`, color, new THREE.Vector3(), 0.7); marker.visible = false; markers.set(robot.id, marker);
      });
    }
    const definitions = model?.geoms ?? [];
    setAssetState({ loaded: 0, total: definitions.filter(geometry => geometry.kind === 'mesh').length, error: '' });
    const getGroup = (id: string) => {
      let group = groups.get(id);
      if (!group) { group = new THREE.Group(); group.name = id; group.visible = id === 'world' || id === '0'; groups.set(id, group); scene.add(group); }
      return group;
    };
    const addGeometry = (definition: VisualGeom, geometry: THREE.BufferGeometry) => {
      if (!alive) { geometry.dispose(); return; }
      geometries.add(geometry);
      const rgba = definition.rgba ?? [0.72, 0.76, 0.78, 1];
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(rgba[0], rgba[1], rgba[2]), roughness: 0.55, metalness: 0.32, transparent: (rgba[3] ?? 1) < 1, opacity: rgba[3] ?? 1 });
      materials.add(material);
      meshMaterials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      if (definition.local_position) mesh.position.fromArray(definition.local_position);
      applyQuat(mesh.quaternion, definition.local_quaternion);
      mesh.castShadow = definition.kind !== 'plane';
      mesh.receiveShadow = true;
      getGroup(definition.body).add(mesh);
    };
    for (const definition of definitions) {
      const size = definition.size ?? [0.1, 0.1, 0.1];
      if (definition.kind === 'mesh' && definition.mesh) {
        let promise = meshCache.get(definition.mesh);
        if (!promise) { promise = loader.loadAsync(definition.mesh); meshCache.set(definition.mesh, promise); }
        void promise.then(geometry => {
          addGeometry(definition, geometry);
          if (alive) setAssetState(previous => ({ ...previous, loaded: previous.loaded + 1 }));
        }).catch(error => { if (alive) setAssetState(previous => ({ ...previous, error: `Robot mesh unavailable: ${error instanceof Error ? error.message : definition.mesh}` })); });
      } else if (definition.kind === 'box') addGeometry(definition, new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2));
      else if (definition.kind === 'sphere') addGeometry(definition, new THREE.SphereGeometry(size[0], 20, 12));
      else if (definition.kind === 'cylinder' || definition.kind === 'capsule') {
        const geometry = definition.kind === 'capsule' ? new THREE.CapsuleGeometry(size[0], size[1] * 2, 6, 12) : new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24);
        geometry.rotateX(Math.PI / 2);
        addGeometry(definition, geometry);
      }
    }
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const render = () => {
      if (!alive) return;
      const current = latestState.current;
      for (const body of current?.bodies ?? []) {
        const group = groups.get(body.name);
        if (group) { group.visible = true; group.position.fromArray(body.position); applyQuat(group.quaternion, body.quaternion); }
      }
      for (const robot of current?.robots ?? []) {
        const marker = markers.get(robot.id);
        if (marker) { marker.visible = true; marker.position.set(robot.position[0], robot.position[1], robot.position[2] + 0.93); }
      }
      for (const material of meshMaterials) material.wireframe = wireframeRef.current;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      controlsRef.current = null;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
      key.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [model]);

  const loading = assetState.total > 0 && assetState.loaded < assetState.total;
  return <div className="simulation-stage" data-model-ready={Boolean(model && assetState.total > 0 && assetState.loaded === assetState.total && !assetState.error)} data-assets-loaded={assetState.loaded} data-assets-total={assetState.total}>
    <div ref={mountRef} className="three-mount" />
    <div className="viewport-top"><div className="viewport-label"><span className={`status-dot ${connected ? 'is-live' : ''}`} />{connected ? 'PHYSICS CONNECTED' : 'AWAITING PHYSICS'}<span className="viewport-divider" />{mode.toUpperCase()}</div><span className="axis-note">Z ↑ &nbsp; METERS</span></div>
    {(webglError || assetState.error) && <div className="stage-message error"><ScanLine size={22}/><strong>Scene unavailable</strong><span>{webglError || assetState.error}</span></div>}
    {!webglError && !assetState.error && !model && <div className="stage-message"><div className="stage-reticle"><Crosshair size={36} strokeWidth={1}/></div><strong>Waiting for the world</strong><span>Connect to MuJoCo to load the two G1 robots<br/>and their authoritative body poses.</span></div>}
    {loading && !assetState.error && <div className="mesh-loading"><span className="mini-spinner"/>Loading G1 geometry <code>{assetState.loaded}/{assetState.total}</code></div>}
    <div className="viewport-bottom"><span className="camera-help">ORBIT <span>drag</span> <i/> ZOOM <span>scroll</span></span><div className="view-tools"><button aria-label="Reset camera" title="Reset camera" onClick={() => controlsRef.current?.reset()}><RotateCcw size={15}/></button><button aria-label="Toggle wireframe" title="Toggle wireframe" aria-pressed={wireframe} className={wireframe ? 'selected' : ''} onClick={() => setWireframe(value => !value)}><ScanLine size={15}/></button><button aria-label="Fullscreen simulation" title="Fullscreen simulation" onClick={() => { const target = mountRef.current?.parentElement; if (document.fullscreenElement) void document.exitFullscreen(); else void target?.requestFullscreen(); }}><Maximize2 size={15}/></button></div></div>
  </div>;
}
