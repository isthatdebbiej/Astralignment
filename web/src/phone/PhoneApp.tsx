import { useEffect, useRef, useState } from 'react';
import { connectCamera, type CameraConnection } from '../camera/peer';
export function PhoneApp() {
  const video = useRef<HTMLVideoElement>(null), connection = useRef<CameraConnection | null>(null);
  const [status, setStatus] = useState('Camera off'), [active, setActive] = useState(false);
  useEffect(() => () => connection.current?.stop(), []);
  async function start() {
    setActive(true);
    try {
      if (!window.isSecureContext) throw new Error('Open this page over HTTPS to use your iPhone camera.');
      const token = new URLSearchParams(location.search).get('session');
      if (!token) throw new Error('Open the pairing link from your desktop.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
      if (video.current) video.current.srcObject = stream;
      try { connection.current = await connectCamera(token, 'phone', stream, () => {}, value=>{setStatus(value);if(/stopped|expired|replaced|session ended/i.test(value))setActive(false);}); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
    } catch (e) { setStatus(String(e)); setActive(false); }
  }
  return <main className="camera-phone" style={{ maxWidth: 620, margin: '40px auto', padding: 24 }}><h1>Astralignment camera</h1><p>Place your phone in a fixed position overlooking the measured stage. Keep this page open and your screen awake.</p><video ref={video} autoPlay muted playsInline style={{ width: '100%', background: '#111', borderRadius: 16 }} /><p role="status">{status}</p><button disabled={active} onClick={start}>Start camera</button> <button disabled={!active} onClick={() => { connection.current?.stop(); connection.current = null; setActive(false); }}>Stop camera</button><p>Video streams to your paired desktop over WebRTC. No audio is captured. The configured TURN relay may carry encrypted traffic. Starting this camera does not automatically send frames to an AI provider.</p></main>;
}
