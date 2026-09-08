import { test, expect } from '@playwright/test';
import { requireLocalTestOrigin } from './test-origin-safety';

// Isolated synthetic desktop transport; never accesses physical media or remote services.
test.use({ channel: 'chrome', headless: true, trace: 'off', screenshot: 'off', video: 'off' });

test('desktop reload resumes the existing pairing without stopping the phone track', async ({ browser }) => {
  test.setTimeout(90_000);
  const base = requireLocalTestOrigin(process.env.CAMERA_RELOAD_TEST_ORIGIN || 'http://127.0.0.1:5173');
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' });
  const errors: string[] = [], forbiddenWrites: string[] = [];
  let sessionPosts = 0;
  // Safety fence: this test may create a pairing, but cannot change calibration or physics.
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !(url.origin === base && url.pathname === '/api/camera/session' && request.method() === 'POST')) {
      forbiddenWrites.push(`${request.method()} ${url.pathname}`); await route.abort(); return;
    }
    if (url.pathname === '/api/camera/session' && request.method() === 'POST') sessionPosts++;
    await route.continue();
  });
  await context.addInitScript(() => {
    const fixture = { color: '#ff0000', streams: [] as MediaStream[], originalTracks: [] as MediaStreamTrack[], mediaRequests: 0 };
    (window as any).__reloadCameraFixture = fixture;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      fixture.mediaRequests++;
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = fixture.color; ctx.fillRect(0, 0, 320, 240); ctx.fillStyle = 'white'; ctx.font = '14px sans-serif'; ctx.fillText('SYNTHETIC RELOAD TEST', 12, 218); };
      paint(); const timer = setInterval(paint, 40), stream = canvas.captureStream(25);
      fixture.streams.push(stream); fixture.originalTracks = stream.getTracks();
      for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; }
      return stream;
    } });
  });
  const viewer = await context.newPage(), sender = await context.newPage();
  for (const page of [viewer, sender]) page.on('pageerror', error => errors.push(error.message.replace(/([?&](?:token|session)=)[^\s&"']+/g, '$1[redacted]')));
  try {
    await viewer.goto(base);
    await viewer.getByRole('button', { name: 'Connect a phone camera', exact: true }).click();
    await viewer.getByRole('button', { name: 'Pair iPhone', exact: true }).click();
    const pairingLink = viewer.getByRole('textbox', { name: 'Pairing link' });
    await expect(pairingLink).toBeVisible();
    const originalPairing = await pairingLink.inputValue();
    // Avoid printing or attaching the bearer pairing URL to test output.
    await sender.goto(originalPairing);
    await sender.getByRole('button', { name: 'Start camera', exact: true }).click();
    await viewer.getByRole('button', { name: 'View camera overlay', exact: true }).click();
    const pixel = () => viewer.locator('.camera-original-video').evaluate((video: HTMLVideoElement) => {
      if (!video.videoWidth || video.readyState < 2) return [0, 0, 0];
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(video, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    await expect.poll(async () => { const [r, g] = await pixel(); return r > 150 && g < 100; }, { timeout: 20_000 }).toBe(true);
    expect(sessionPosts).toBe(1);
    await viewer.reload();
    await sender.evaluate(() => { (window as any).__reloadCameraFixture.color = '#00ff00'; });
    await expect.poll(async () => { const [r, g] = await pixel(); return g > 150 && r < 100; }, { timeout: 30_000 }).toBe(true);
    await expect.poll(() => sender.evaluate(() => {
      const fixture = (window as any).__reloadCameraFixture;
      return fixture.mediaRequests === 1 && fixture.originalTracks.length > 0 && fixture.originalTracks.every((track: MediaStreamTrack) => track.readyState === 'live' && fixture.streams[0].getTracks().includes(track));
    })).toBe(true);
    // Pairing UI may remain in a hidden drawer; its value must be the same, not a new session.
    expect((await viewer.locator('input[aria-label="Pairing link"]').inputValue()) === originalPairing, 'The existing pairing is reused after reload').toBe(true);
    expect(sessionPosts, 'Reload must not create another pairing session').toBe(1);
    expect(forbiddenWrites, 'Reload test never changes calibration or simulation').toEqual([]);
    expect(errors).toEqual([]);
    await sender.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await expect.poll(() => sender.evaluate(() => (window as any).__reloadCameraFixture.originalTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  } finally { await context.close(); }
});
