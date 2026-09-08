import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { ArrowRight, Check, Eye, EyeOff, Focus, Layers3, Maximize2, Radio, ScanLine, SlidersHorizontal, Smartphone, TriangleAlert, Video } from 'lucide-react';
import type { CameraCalibration, ModelDescription, PerceptionResult, WorldSnapshot } from '../../../contracts/index';
import { containVideoRect, estimateCameraProjection, fitCameraProjection } from '../camera/projection';
import { createFloorMapping } from '../camera/homography';
import { createRobotLayer } from './robotLayer';
import { inspectPerceptionProjection, MAX_TRACKED_POSE_AGE_MS, type PerceptionCursor } from './perceptionProjection';

interface Props {
  stream: MediaStream | null;
  calibration: CameraCalibration | null;
  model: ModelDescription | null;
  state: WorldSnapshot | null;
  connected: boolean;
  mode: string;
  onConnect: () => void;
  onWorld: () => void;
  perception?: PerceptionResult | null;
  perceptionEnabled?: boolean;
  perceptionStatus?: string;
  perceptionError?: string;
  onStartTracking?: () => void;
  onStopTracking?: () => void;
}

export function CameraOverlay({ stream, calibration, model, state, connected, mode, onConnect, onWorld, perception = null, perceptionEnabled = false, perceptionStatus = '', perceptionError = '', onStartTracking, onStopTracking }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [container, setContainer] = useState({ width: 1, height: 1 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [fresh, setFresh] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [rendererError, setRendererError] = useState('');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [fov, setFov] = useState(60);
  const [lensOpen, setLensOpen] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [guides, setGuides] = useState(true);
  const [manualMode, setManualMode] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now);
  const perceptionCursor = useRef<PerceptionCursor | null>(null);
  useEffect(() => {
    if (!perceptionEnabled) { perceptionCursor.current = null; return; }
    setManualMode(false);
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [perceptionEnabled]);
  const tracked = useMemo(() => {
    const check = inspectPerceptionProjection(perception, videoSize.width, videoSize.height, clockNow, perceptionCursor.current);
    if (perception && Number.isSafeInteger(perception.frame_id) && Number.isFinite(perception.captured_at)) {
      const previous = perceptionCursor.current;
      if (!previous || previous.sessionId !== perception.session_id || perception.frame_id > previous.frameId && perception.captured_at >= previous.capturedAt) perceptionCursor.current = { sessionId: perception.session_id, frameId: perception.frame_id, capturedAt: perception.captured_at };
    }
    return check;
  }, [perception, videoSize, clockNow]);
  const startTracking = () => { setManualMode(false); setLensOpen(false); onStartTracking?.(); };
  const useManualProjection = () => { onStopTracking?.(); setManualMode(true); if (!calibration) onConnect(); };
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadReady = useRef(false);
  const lensEstimate = useMemo(() => { if (!calibration) return null; try { return fitCameraProjection(calibration); } catch { return null; } }, [calibration]);
  useEffect(() => { setFov(lensEstimate?.estimatedFovDegrees ?? 60); }, [lensEstimate]);

  const manualProjection = useMemo(() => {
    if (!calibration) return { value: null, error: '' };
    try { return { value: estimateCameraProjection(calibration, fov, { near: 0.03, far: 150 }), error: '' }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [calibration, fov]);
  const frameRatio = videoSize.width / videoSize.height;
  const calibrationRatio = calibration ? calibration.frame_width / calibration.frame_height : 0;
  const aspectMatches = !calibration || !videoSize.width || Math.abs(frameRatio / calibrationRatio - 1) < 0.025;
  const floorMatches = !calibration || !model || Math.abs(calibration.width - model.scene.width) < 0.001 && Math.abs(calibration.depth - model.scene.depth) < 0.001;
  const fitLimit = calibration ? Math.max(8, Math.hypot(calibration.frame_width, calibration.frame_height) * 0.025) : 8;
  const fitGood = Boolean(manualProjection.value && manualProjection.value.reprojectionRmsPixels <= fitLimit);
  const projectionError = !aspectMatches ? 'The camera framing changed. Capture a new floor calibration.' : !floorMatches ? 'The measured floor no longer matches this scene. Recalibrate before overlaying robots.' : manualProjection.error || (manualProjection.value && !fitGood ? 'Lens estimate does not fit the floor closely enough. Adjust the lens or recalibrate.' : '');
  const projection: { worldToClip: number[] } | null = manualMode ? manualProjection.value : perceptionEnabled && !perceptionError ? tracked.value : null;
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const overlayActive = Boolean(stream && fresh && model && state && connected && overlayEnabled && !rendererError && (manualMode ? calibration && fitGood && !projectionError : perceptionEnabled && tracked.value && !perceptionError));
  const autoExpiryRef = useRef(Infinity);
  autoExpiryRef.current = manualMode ? Infinity : (perception?.captured_at ?? 0) + MAX_TRACKED_POSE_AGE_MS;
  const activeRef = useRef(overlayActive);
  activeRef.current = overlayActive;
  const rectangle = useMemo(() => containVideoRect(container.width, container.height, videoSize.width || calibration?.frame_width || 16, videoSize.height || calibration?.frame_height || 9), [container, videoSize, calibration]);
  const mapping = useMemo(() => {
    if (!calibration) return null;
    try { return createFloorMapping(calibration.corners, calibration.width, calibration.depth); } catch { return null; }
  }, [calibration]);
  const floorGuides = useMemo(() => {
    if (!mapping || !model || !floorMatches) return null;
    try {
      return {
        boundary: calibration!.corners.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' '),
        keepouts: model.scene.keepouts.map(zone => ({ id: zone.id, points: zone.polygon.map(point => mapping.toImage(point)).map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ') })),
        goals: model.scene.robots.map((robot, i) => ({ name: i ? 'B' : 'A', point: mapping.toImage(robot.goal) })),
      };
    } catch { return null; }
  }, [mapping, model, calibration, floorMatches]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const resize = () => { const bounds = element.getBoundingClientRect(); if (bounds.width && bounds.height) setContainer({ width: bounds.width, height: bounds.height }); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setFresh(false); setMediaError(''); setVideoSize({ width: 0, height: 0 });
    video.srcObject = stream;
    let active = true;
    let lastFrame = 0;
    let videoCallback = 0;
    const metadata = () => { if (video.videoWidth && video.videoHeight) setVideoSize(previous => previous.width === video.videoWidth && previous.height === video.videoHeight ? previous : { width: video.videoWidth, height: video.videoHeight }); };
    const decoded = () => { if (!active) return; lastFrame = performance.now(); setFresh(true); metadata(); videoCallback = video.requestVideoFrameCallback(decoded); };
    const ended = () => { setFresh(false); setMediaError('The camera stream stopped. Reconnect the phone to continue.'); };
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('resize', metadata);
    video.addEventListener('error', ended);
    const tracks = stream?.getVideoTracks() ?? [];
    tracks.forEach(track => track.addEventListener('ended', ended));
    if (stream) {
      void video.play().catch(() => { if (active) setMediaError('Camera playback is paused. Reopen the camera connection to start video.'); });
      if ('requestVideoFrameCallback' in video) videoCallback = video.requestVideoFrameCallback(decoded);
      else setMediaError('This browser cannot verify live video frames. Use a current Chrome, Edge, or Safari browser.');
    }
    const watchdog = window.setInterval(() => { if (lastFrame && performance.now() - lastFrame > 2500) setFresh(false); }, 600);
    return () => {
      active = false; clearInterval(watchdog);
      if (videoCallback) video.cancelVideoFrameCallback(videoCallback);
      video.removeEventListener('loadedmetadata', metadata); video.removeEventListener('resize', metadata); video.removeEventListener('error', ended);
      tracks.forEach(track => track.removeEventListener('ended', ended));
      video.srcObject = null;
      // CameraPanel owns the peer and tracks. Closing this view must not stop them.
    };
  }, [stream]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !model) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' }); }
    catch { setRendererError('WebGL is unavailable. The live video remains available.'); return; }
    setRendererError(''); loadReady.current = false;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.setAttribute('aria-label', 'Simulated Unitree G1 robots projected over the untouched live camera');
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xdce9f2, 1.65));
    const key = new THREE.DirectionalLight(0xfff3e1, 2.0); key.position.set(-2, -3, 7); scene.add(key);
    const fill = new THREE.DirectionalLight(0xa9d5f1, 1.0); fill.position.set(4, 3, 4); scene.add(fill);
    const camera = new THREE.Camera();
    camera.up.set(0, 0, 1);
    camera.matrixAutoUpdate = false; camera.matrixWorldAutoUpdate = false;
    camera.matrixWorld.identity(); camera.matrixWorldInverse.identity();
    const layer = createRobotLayer(model, (loaded, total) => { loadReady.current = total > 0 && loaded === total; setProgress({ loaded, total }); }, setRendererError);
    scene.add(layer.root);
    const resize = () => { const box = mount.getBoundingClientRect(); if (box.width && box.height) renderer.setSize(box.width, box.height, false); };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    let active = true;
    let frame = 0;
    let appliedProjection: { worldToClip: number[] } | null = null;
    const render = () => {
      if (!active) return;
      const value = projectionRef.current;
      if (value && value !== appliedProjection) { camera.projectionMatrix.fromArray(value.worldToClip); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); appliedProjection = value; }
      layer.update(activeRef.current && loadReady.current && Date.now() <= autoExpiryRef.current ? stateRef.current : null);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); layer.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [model]);

  const trackingLost = perception?.status === 'lost' || perception?.status === 'error' || Boolean(perceptionError) || tracked.ageMs != null && tracked.ageMs > MAX_TRACKED_POSE_AGE_MS;
  const trackingLabel = manualMode ? 'FIXED CAMERA · MANUAL' : !perceptionEnabled ? 'TRACKING OFF' : tracked.value && !perceptionError ? 'TRACKING · ESTIMATED SCALE' : trackingLost ? 'TRACKING LOST' : 'SEARCHING FOR GEOMETRY';
  const trackingReason = perceptionError || (tracked.value ? '' : tracked.reason) || perceptionStatus;
  const recorded = mode.startsWith('Recorded');
  const robotStatus = recorded ? 'RECORDED ROBOTS' : mode === 'Reference controller' ? 'REFERENCE G1' : 'SIMULATED G1';
  const cameraStatus = fresh ? 'LIVE CAMERA' : !stream ? 'CAMERA INPUT' : videoSize.width ? 'CAMERA INTERRUPTED' : 'CAMERA CONNECTING';
  const poseStatus = !fresh ? 'Camera interrupted · robot overlay hidden' : !connected ? 'Physics disconnected · robot overlay hidden' : !overlayActive ? 'Robot overlay hidden · camera live' : recorded ? 'Recorded robot poses over current live video' : mode === 'Reference controller' ? 'Authored reference controller · camera live' : state?.paused ? 'Physics paused · camera live' : 'Authoritative physics · camera live';
  return <div ref={stageRef} className="camera-overlay-stage" data-overlay-ready={overlayActive && loadReady.current} data-overlay-meshes={`${progress.loaded}/${progress.total}`} data-projection-mode={manualMode ? "manual" : "automatic"} data-tracking-state={manualMode ? "manual" : !perceptionEnabled ? "off" : tracked.value && !perceptionError ? "tracking" : trackingLost ? "lost" : "searching"}>
    <div className="camera-media-rect" style={{ left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height }}>
      <video ref={videoRef} className="camera-original-video" autoPlay muted playsInline aria-label="Untouched live phone camera"/>
      {manualMode && guides && fresh && aspectMatches && floorGuides && <svg className="camera-floor-guides" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Measured floor and authored goal guides"><polygon points={floorGuides.boundary} className="floor-boundary"/>{floorGuides.keepouts.map(zone => <polygon key={zone.id} points={zone.points} className="floor-keepout"/>)}{floorGuides.goals.map(goal => <g key={goal.name} transform={`translate(${goal.point[0] * 1000} ${goal.point[1] * 1000})`}><path d="M -9 0 H 9 M 0 -9 V 9" className={`floor-goal goal-${goal.name}`}/></g>)}</svg>}
      <div ref={mountRef} className="camera-overlay-canvas"/>
    </div>
    <div className="camera-overlay-top"><div className="camera-source-badge"><span className={`status-dot ${fresh ? 'is-live' : ''}`}/>{cameraStatus}<span className="camera-badge-separator"/>{robotStatus}</div>{stream && manualMode ? <button className="camera-float-button" onClick={onConnect}><Focus size={13}/>Manual calibration</button> : stream && perceptionEnabled ? <button className="camera-float-button" onClick={onStopTracking}>Stop spatial tracking</button> : null}</div>
    {!stream && <div className="camera-onboarding"><div className="camera-onboarding-icon"><Video size={34} strokeWidth={1.2}/><span><Layers3 size={15}/></span></div><span className="section-eyebrow">REAL INPUT. VISIBLE CONSEQUENCES.</span><h2>Put the robots in your world.</h2><p>Connect a phone camera, start spatial tracking,<br/>and inspect both G1 policies over the live view.</p><button className="button camera-start" onClick={onConnect}><Smartphone size={15}/>Connect a phone camera<ArrowRight size={15}/></button><button className="camera-world-link" onClick={onWorld}>Inspect the simulation first<ArrowRight size={12}/></button><div className="camera-setup-steps"><span><i>1</i>Pair camera</span><span><i>2</i>Track the scene</span><span><i>3</i>Run & inspect</span></div></div>}
    {stream && !manualMode && (!perceptionEnabled || !tracked.value || perceptionError) && <div className="camera-calibration-prompt" role="status"><Focus size={20}/><div><strong>{!perceptionEnabled ? 'Track the camera in your space.' : trackingLost ? 'Tracking lost — robots hidden.' : 'Finding the floor and camera pose…'}</strong><span>{!perceptionEnabled ? 'Selected camera frames are sent to Modal for spatial inference. Scale is estimated, not measured.' : `${perceptionStatus ? perceptionStatus + ' · ' : ''}${trackingReason}`}</span></div>{!perceptionEnabled && <button className="button" disabled={!fresh || !onStartTracking} onClick={startTracking}>Start spatial tracking<ArrowRight size={13}/></button>}</div>}
    {stream && manualMode && !calibration && <div className="camera-calibration-prompt"><Focus size={20}/><div><strong>Fixed-camera calibration</strong><span>Mark measured floor corners and keep this camera fixed.</span></div><button className="button" onClick={onConnect}>Calibrate<ArrowRight size={13}/></button></div>}
    {stream && (mediaError || manualMode && projectionError || rendererError) && <div className="camera-overlay-warning" role="status"><TriangleAlert size={15}/><span>{mediaError || rendererError || projectionError}</span>{manualMode && projectionError && <button onClick={onConnect}>Calibrate this camera</button>}</div>}
    {stream && !fresh && !mediaError && <div className="camera-stream-wait"><Radio size={18}/>{videoSize.width ? 'Waiting for fresh camera frames…' : 'Receiving camera video…'}</div>}
    {stream && fresh && !connected && <div className="camera-overlay-warning"><Radio size={15}/><span>Video is live. Physics is disconnected; robot overlay is paused.</span></div>}
    {stream && (manualMode || perceptionEnabled) && progress.total > 0 && progress.loaded < progress.total && <div className="camera-mesh-progress"><span className="mini-spinner"/>Loading G1 meshes <code>{progress.loaded}/{progress.total}</code></div>}
    {stream && <div className="camera-overlay-bottom"><div className="overlay-disclosure"><span>{poseStatus}</span><small>{trackingLabel}{!manualMode && perceptionEnabled && tracked.ageMs != null ? ` · pose ${(tracked.ageMs / 1000).toFixed(1)}s old` : ""} · no real-world occlusion</small></div><div className="camera-overlay-tools"><button title={overlayEnabled ? 'Hide simulated robots' : 'Show simulated robots'} aria-label="Toggle robot overlay" aria-pressed={overlayEnabled} onClick={() => setOverlayEnabled(value => !value)}>{overlayEnabled ? <Eye size={15}/> : <EyeOff size={15}/>}</button><button title="Manual floor guides" aria-label="Toggle floor guides" disabled={!manualMode} aria-pressed={manualMode && guides} onClick={() => setGuides(value => !value)}><ScanLine size={15}/></button><button title="Advanced projection settings" aria-label="Advanced projection settings" aria-expanded={lensOpen} className={lensOpen ? 'selected' : ''} onClick={() => setLensOpen(value => !value)}><SlidersHorizontal size={15}/></button><button title="Fullscreen camera" aria-label="Fullscreen camera" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen(); }}><Maximize2 size={15}/></button></div></div>}
    {lensOpen && stream && <div className="camera-lens-panel"><div><SlidersHorizontal size={13}/><strong>Advanced projection</strong><button aria-label="Close projection settings" onClick={() => setLensOpen(false)}><Check size={14}/></button></div>
      {!manualMode ? <><p>Automatic tracking follows inferred camera poses. It does not reconstruct occlusion or provide measured scale.</p><button className="button" onClick={useManualProjection}>Use fixed-camera calibration</button></> : <>
        <p>Manual mode requires a fixed camera and measured floor. Heights assume a centered pinhole lens.{lensEstimate?.fitWeak && ' This lens fit is ambiguous; verify vertical alignment.'}</p>
        <button className="button" disabled={!onStartTracking || !fresh} onClick={startTracking}>Use spatial tracking</button>
        {calibration && <><label htmlFor="camera-fov">Vertical field of view<code>{fov.toFixed(0)}°</code></label><input id="camera-fov" type="range" min="15" max="120" step="0.5" value={fov} onChange={event => setFov(Number(event.target.value))}/><div className="lens-fit"><span>Floor reprojection error</span><code>{manualProjection.value ? `${manualProjection.value.reprojectionRmsPixels.toFixed(1)} px` : 'Unavailable'}</code></div><span className={fitGood ? 'lens-good' : 'lens-poor'}>{fitGood ? 'Floor fit within overlay tolerance' : 'Improve the lens estimate or recalibrate'}</span></>}
      </>}
    </div>}
  </div>;
}
