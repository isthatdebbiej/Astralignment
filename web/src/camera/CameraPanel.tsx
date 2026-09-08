import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { connectCamera, type CameraConnection } from './peer';
import { ObstacleAnnotation } from './ObstacleAnnotation';
export type StageCalibration = { widthMeters: number; depthMeters: number; corners: [number, number][]; capturedAt: string; imageWidth: number; imageHeight: number; basis: 'meters-XY-Z-up'; imageDataUrl: string };
export type StageCameraProps = { onVideoReady?: (video: HTMLVideoElement | null) => void; onCalibration?: (value: StageCalibration) => void };
export function StageCamera({ onVideoReady, onCalibration }: StageCameraProps) {
  const video = useRef<HTMLVideoElement>(null), connection = useRef<CameraConnection | null>(null);
  const [url, setUrl] = useState(''), [qr, setQr] = useState(''), [status, setStatus] = useState('Camera not paired');
  const [still, setStill] = useState(''), [corners, setCorners] = useState<[number, number][]>([]), [width, setWidth] = useState(4), [depth, setDepth] = useState(3);
  const [size, setSize] = useState([0, 0]), [busy, setBusy] = useState(false);
  useEffect(() => () => { connection.current?.stop(); onVideoReady?.(null); }, []);
  useEffect(()=>{let cancelled=false;void fetch('/api/camera/calibration').then(r=>r.ok?r.json():null).then(data=>{const c=data?.calibration;if(c&&!cancelled)onCalibration?.({widthMeters:c.width,depthMeters:c.depth,corners:c.corners,capturedAt:c.captured_at,imageWidth:c.frame_width,imageHeight:c.frame_height,basis:'meters-XY-Z-up',imageDataUrl:''});}).catch(()=>{});return()=>{cancelled=true;};},[]);
  async function pair() {
    setBusy(true); connection.current?.stop();
    try {
      const response = await fetch('/api/camera/session', { method: 'POST' });
      if (!response.ok) throw new Error(`Pairing unavailable (${response.status})`);
      const session = await response.json();
      const link = `${location.origin}/phone?session=${encodeURIComponent(session.token)}`;
      setUrl(link); setQr(await QRCode.toDataURL(link, { width: 192, margin: 1 }));
      connection.current = await connectCamera(session.token, 'viewer', null, stream => { if (video.current) { video.current.srcObject = stream; onVideoReady?.(video.current);stream.getTracks().forEach(track=>track.addEventListener('ended',()=>onVideoReady?.(null),{once:true})); } }, value=>{setStatus(value);if(/disconnect|stopped|expired|unavailable|closed|failed/i.test(value))onVideoReady?.(null);});
    } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }
  function capture() {
    const v = video.current;
    if (!v?.videoWidth) { setStatus('Wait for live video before calibration'); return; }
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0); setStill(canvas.toDataURL('image/jpeg', 0.85)); setSize([v.videoWidth, v.videoHeight]); setCorners([]);
  }
  async function saveCalibration() {
    if(width<3||width>30||depth<3||depth>30){setStatus('Supported measured stage dimensions are 3–30 meters. Do not substitute dimensions.');return;}
    if (!window.confirm('Confirm measured dimensions, floor corners, and the proposed far-side presenter reserved strip (Y=0.36D to 0.47D). The strip is an authored layout, not detected from video. Applying this layout updates the stage and invalidates prior results.')) return;
    try {
      const response = await fetch('/api/camera/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, calibration: { width, depth, corners, captured_at: new Date().toISOString(), frame_width: size[0], frame_height: size[1] } }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Calibration rejected');
      onCalibration?.({ widthMeters: width, depthMeters: depth, corners, capturedAt: new Date().toISOString(), imageWidth: size[0], imageHeight: size[1], basis: 'meters-XY-Z-up', imageDataUrl: still });
      setStatus('Confirmed measured floor calibration saved');
    } catch (error) { setStatus(String(error)); }
  }
  return <section className="camera-panel"><h2>Live stage camera</h2><p>Pair a fixed iPhone camera, then measure the stage floor.</p><p role="status">{status}</p><video ref={video} autoPlay muted playsInline style={{ width: '100%', maxHeight: 340, background: '#101316', borderRadius: 12 }} />
    <div><button onClick={pair} disabled={busy}>{url ? 'Create new pairing' : 'Pair iPhone'}</button> <button onClick={() => { connection.current?.stop(); connection.current = null; if (video.current) video.current.srcObject = null; onVideoReady?.(null); setUrl(''); setQr(''); }}>Disconnect</button> <button onClick={capture}>Capture calibration still</button></div>
    {url && <div className="camera-pairing"><img src={qr} alt="Scan to pair your phone camera" width="192" height="192" /><p>Scan on iPhone, then tap Start camera. Link expires after 30 minutes. Treat it as private.</p><input aria-label="Pairing link" readOnly value={url} style={{ width: '100%' }} /><button onClick={() => navigator.clipboard.writeText(url).then(() => setStatus('Pairing link copied')).catch(() => setStatus('Select and copy the pairing link'))}>Copy link</button>{location.protocol !== 'https:' && <p>iPhone camera requires a reachable HTTPS address. Localhost on desktop is not reachable from the phone.</p>}</div>}
    {still && <div className="camera-calibration"><h3>Measured floor calibration</h3><p>Click four floor corners in order: near-left (-W/2,-D/2), near-right (W/2,-D/2), far-right (W/2,D/2), far-left (-W/2,D/2). Measurements must come from the physical stage (supported range: 3–30 m). Confirmation also reserves a proposed presenter strip along the far side, Y=0.36D to 0.47D; this layout is authored, not detected from video.</p><div style={{ position: 'relative' }}><img src={still} alt="Stage calibration still; select four measured floor corners" style={{ width: '100%', cursor: 'crosshair' }} onClick={e => { if (corners.length >= 4) return; const rect = e.currentTarget.getBoundingClientRect(); setCorners([...corners, [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]]); }} />{corners.map(([x,y], i) => <span key={i} style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, background: '#ffdb79', color: '#111', borderRadius: 20, padding: '2px 6px', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>{i + 1}</span>)}</div><label>Width (m) <input type="number" min="3" max="30" step="0.1" value={width} onChange={e => setWidth(Number(e.target.value))} /></label> <label>Depth (m) <input type="number" min="3" max="30" step="0.1" value={depth} onChange={e => setDepth(Number(e.target.value))} /></label><p>{corners.length}/4 corners selected</p><button onClick={() => setCorners([])}>Reset corners</button> <button disabled={corners.length !== 4 || !(width >= 3 && width <= 30 && depth >= 3 && depth <= 30)} onClick={saveCalibration}>Confirm and apply calibration</button><p>This records a planar floor reference, not reconstructed 3D geometry. Keep the camera fixed; recalibrate after moving it.</p></div>}
    <ObstacleAnnotation video={video.current}/>
    <p>Continuous peer video is independent of AI frame selection. Remote connectivity may require a configured TURN relay; STUN alone does not work on every network.</p>
  </section>;
}
export const CameraPanel = StageCamera;
