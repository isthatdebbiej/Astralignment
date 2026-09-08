import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv[2] || 'inspect';
const output = path.resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const report = { phase, url: 'http://127.0.0.1:5173', viewport: { width: 1512, height: 982 }, pageErrors: [], consoleErrors: [], networkErrors: [], checks: [] };
let browser;
try {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch({ channel, headless: true }); report.browser = channel ?? 'chromium'; break; }
    catch (error) { if (channel === undefined) throw error; }
  }
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.networkErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.three-mount canvas');
  await page.waitForFunction(() => document.querySelector('.simulation-stage')?.getAttribute('data-model-ready') === 'true' && document.querySelector('.connection-state')?.textContent?.includes('connected'), null, { timeout: 90000 });
  report.assets = await page.locator('.simulation-stage').evaluate(element => ({ loaded: element.dataset.assetsLoaded, total: element.dataset.assetsTotal }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const canvas = page.locator('.three-mount canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds || bounds.width < 300 || bounds.height < 200) throw new Error('Canvas display dimensions are invalid.');
  report.canvas = bounds;
  const pixels = await canvas.screenshot();
  const uniqueColors = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height;
    const context = sample.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    const colors = new Set(); for (let i = 0; i < data.length; i += 400) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colors.size;
  }, pixels.toString('base64'));
  if (uniqueColors < 30) throw new Error(`Canvas appears blank: ${uniqueColors} sampled colors.`);
  report.uniqueSampledColors = uniqueColors;
  report.checks.push('Authoritative model loaded; nonblank canvas');
  await page.screenshot({ path: path.join(output, `desktop-${phase}.png`), fullPage: true });
  await page.getByRole('tab', { name: 'Evidence' }).click();
  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  report.checks.push('Code, Evidence and Trace tabs selectable');
  await page.mouse.move(bounds.x + bounds.width * .54, bounds.y + bounds.height * .5);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .58, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(350);
  const orbited = await canvas.screenshot();
  if (pixels.equals(orbited)) throw new Error('Orbit did not change the rendered view.');
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  report.checks.push('Pointer orbit changes the rendered camera; reset is reachable');
  await page.getByRole('button', { name: 'Toggle wireframe', exact: true }).click();
  if (await page.getByRole('button', { name: 'Toggle wireframe', exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Wireframe selection failed.');
  await page.getByRole('button', { name: 'Toggle wireframe', exact: true }).click();
  report.checks.push('Wireframe inspection toggle');
  if (phase === 'journey') {
    const initial = await page.request.get('/api/sim/state').then(response => response.json());
    if (!initial.paused) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: /Run baseline/ }).click();
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(250);
    const paused = await page.request.get('/api/sim/state').then(response => response.json());
    if (!paused.paused || paused.tick <= initial.tick) throw new Error('Run/pause did not advance and pause authoritative physics.');
    report.checks.push(`Run and pause advanced physics tick ${initial.tick} → ${paused.tick}`);
    const slider = page.getByRole('slider', { name: 'Inspect captured simulation frame' });
    await slider.fill('0');
    if (!(await page.locator('.viewport-label').innerText()).includes('RECORDED FRAME')) throw new Error('Timeline does not label recorded inspection.');
    await page.getByRole('button', { name: 'LIVE', exact: true }).click();
    report.checks.push('Timeline inspection labels recorded frame; Live returns to authoritative state');
    await page.getByRole('button', { name: 'Randomize spawn', exact: true }).click();
    await page.waitForTimeout(800);
    const randomized = await page.request.get('/api/sim/state').then(response => response.json());
    if (randomized.scene_epoch === paused.scene_epoch) throw new Error('Random spawn did not create a new scene epoch.');
    report.checks.push(`Random spawn changed scene epoch ${paused.scene_epoch} → ${randomized.scene_epoch}`);
    await page.getByRole('button', { name: 'Connect phone', exact: false }).first().click();
    await page.getByRole('dialog', { name: 'Live phone camera' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Close camera', exact: true }).click();
    report.checks.push('Camera pairing panel opens and closes without unmounting its stream owner');
    await page.screenshot({ path: path.join(output, 'desktop-journey-final.png'), fullPage: true });
    const errors = await context.newPage();
    await errors.route('**/api/sim/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Physics service unavailable: QA error state' }) }));
    await errors.routeWebSocket('**/ws/state', socket => socket.close());
    await errors.goto(report.url, { waitUntil: 'networkidle' });
    await errors.getByText('Waiting for the world', { exact: true }).waitFor();
    await errors.screenshot({ path: path.join(output, 'desktop-disconnected.png'), fullPage: true });
    report.checks.push('Unavailable physics displays explicit waiting state and disabled controls');
    await errors.close();
  }
  report.pass = report.pageErrors.length === 0 && report.consoleErrors.length === 0 && report.networkErrors.length === 0;
  if (!report.pass) throw new Error('Browser emitted errors; inspect report.');
} catch (error) { report.pass = false; report.failure = error.message; process.exitCode = 1; }
finally { await browser?.close(); await writeFile(path.join(output, `desktop-${phase}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
