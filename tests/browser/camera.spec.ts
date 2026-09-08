import { test, expect } from '@playwright/test';

// Synthetic desktop transport test only. Does not access a physical camera or prove iPhone compatibility.
test.use({ channel: 'chrome', headless: true, trace: 'off', screenshot: 'off', video: 'off' });
test('synthetic canvas traverses real two-tab WebRTC and stops explicitly', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext();
  const errors: string[] = [];
  const sanitize = (text: string) => text.replace(/([?&](?:session|token)=)[^&\s"']+/g, '$1[redacted]');
  await context.addInitScript(() => {
    const state = window as any;
    state.__cameraTest = { peers: [], streams: [], color: '#ff0000' };
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) { super(config); state.__cameraTest.peers.push(this); }
    };
    // Explicit test-only replacement; never calls native getUserMedia.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = state.__cameraTest.color; ctx.fillRect(0,0,320,240); ctx.fillStyle = 'white'; ctx.font = '18px sans-serif'; ctx.fillText('SYNTHETIC TRANSPORT TEST', 12, 210); };
      paint(); const timer = setInterval(paint, 40);
      const stream = canvas.captureStream(25); state.__cameraTest.streams.push(stream);
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; });
      return stream;
    } });
  });
  const viewer = await context.newPage();
  const sender = await context.newPage();
  for (const page of [viewer,sender]) {
    page.on('pageerror', e => errors.push(sanitize(e.message)));
    page.on('console', m => { if (m.type() === 'error' && /camera|webrtc|rtcpeer/i.test(m.text())) errors.push(sanitize(m.text())); });
  }
  try {
    const base = process.env.CAMERA_TEST_ORIGIN || 'http://127.0.0.1:5173';
    await viewer.goto(base);
    await viewer.getByRole('button', { name: 'Connect phone', exact: true }).click();
    await viewer.getByRole('button', { name: 'Pair iPhone', exact: true }).click();
    const link = viewer.getByRole('textbox', { name: 'Pairing link' });
    await expect(link).toBeVisible();
    const cameraSenderPage = await link.inputValue();
    // Never log pairing URL or preserve traces/screenshots containing bearer credentials.
    await sender.goto(cameraSenderPage);
    await sender.getByRole('button', { name: 'Start camera', exact: true }).click();
    for (const page of [viewer,sender]) await expect.poll(() => page.evaluate(() => (window as any).__cameraTest.peers.some((p: RTCPeerConnection) => p.connectionState === 'connected')), { timeout: 20_000 }).toBe(true);
    const pixel = () => viewer.locator('.camera-panel video').evaluate((node: HTMLVideoElement) => {
      if (!node.videoWidth || !node.videoHeight) return [0,0,0];
      const c = document.createElement('canvas'); c.width=1; c.height=1;
      const ctx=c.getContext('2d')!; ctx.drawImage(node,0,0,1,1); return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);
    });
    await expect.poll(async () => { const [r,g] = await pixel(); return r>150 && g<100; }).toBe(true);
    await sender.evaluate(() => { (window as any).__cameraTest.color='#00ff00'; });
    await expect.poll(async () => { const [r,g] = await pixel(); return g>150 && r<100; }).toBe(true);
    await sender.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await expect.poll(() => sender.evaluate(() => (window as any).__cameraTest.streams.every((s: MediaStream) => s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
    await expect.poll(() => sender.evaluate(() => (window as any).__cameraTest.peers.every((p: RTCPeerConnection) => p.connectionState==='closed'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
