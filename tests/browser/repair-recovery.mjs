// Read-only remote regression. No camera access, repair, replay, or physics writes.
// Run after deployment: node tests/browser/repair-recovery.mjs
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.REPAIR_TEST_ORIGIN || 'https://astralignment.64.177.14.149.sslip.io';
assert.equal(new URL(base).origin, base, 'Use a plain origin');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL: base, viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' });
const report = { test: 'fault-injected testing artifact recovers through polling', passed: false, artifactGets: 0, forbiddenWrites: [], pageErrors: [], checks: [] };
try {
  const token = (await readFile('D:/Projects/astra-operator-token.txt', 'utf8')).trim();
  const auth = await context.request.post('/api/auth', { headers: { Origin: base }, data: { token } });
  assert.equal(auth.status(), 200, 'Operator authentication failed');
  const health = await (await context.request.get('/api/health')).json();
  assert.equal(health.job, null, 'Wait for the real job to finish before this read-only test');
  const { artifacts } = await (await context.request.get('/api/artifacts')).json();
  const actual = artifacts[0];
  assert.equal(actual?.status, 'passed', 'Latest real artifact must be passed');
  assert.ok(actual.evaluation?.frames.length > 2, 'Real recorded trajectory required');
  const state = await (await context.request.get('/api/sim/state')).json();
  const stale = actual.origin_episode_id !== state.episode_id || actual.scene_epoch !== state.scene_epoch;
  if (stale) assert.ok(actual.evaluation.scene, 'Older recording requires its original scene');
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      report.forbiddenWrites.push(`${req.method()} ${url.pathname}`);
      await route.abort(); return;
    }
    if (url.pathname === '/api/artifacts') {
      report.artifactGets++;
      if (report.artifactGets === 1) {
        const testing = { ...actual, status: 'testing', evaluation: { ...actual.evaluation, frames: [] } };
        await route.fulfill({ json: { artifacts: [testing, ...artifacts.slice(1)] } }); return;
      }
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', () => report.pageErrors.push('Browser page error (details withheld)'));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const result = page.getByRole('region', { name: 'Repair result', exact: true });
  await expect.poll(() => report.artifactGets, { timeout: 20_000 }).toBeGreaterThan(0);
  report.checks.push('Injected initial testing artifact without trajectory frames');
  await expect.poll(() => report.artifactGets, { timeout: 60_000 }).toBeGreaterThan(1);
  await expect(result).toContainText(stale ? 'STALE' : 'PASSED', { timeout: 20_000 });
  assert.ok(report.artifactGets >= 2, 'Recovery must refetch artifacts');
  report.checks.push('Polling recovered the saved artifact with correct current/older-world scope');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.locator('.simulation-stage')).toHaveAttribute('data-model-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('.three-mount canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Watch repaired run', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Inspect captured simulation frame' });
  await expect(slider).toBeVisible();
  assert.equal(Number(await slider.getAttribute('max')), actual.evaluation.frames.length - 1);
  const first = Number(await slider.inputValue());
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 12_000 }).toBeGreaterThan(first);
  await expect(page.getByRole('button', { name: 'Pause replay', exact: true })).toBeVisible();
  await expect(page.locator('.simulation-stage')).toHaveAttribute('data-model-ready', 'true', { timeout: 60_000 });
  report.checks.push('Actual returned trajectory frame count loaded and playback advanced without POST');
  if (stale) {
    await expect(page.getByText('Archived repair playback in its saved world. This verdict does not apply to the current live scene.', {exact:true})).toBeVisible();
    report.checks.push('Older experiment is explicitly labeled and played in its recorded world');
  }
  assert.deepEqual(report.forbiddenWrites, []);
  assert.deepEqual(report.pageErrors, []);
  await mkdir('artifacts/qa', { recursive: true });
  await page.screenshot({ path: 'artifacts/qa/repair-recovery.png', fullPage: true });
  report.passed = true;
} catch (error) {
  report.failure = String(error?.message || error).replace(/([?&](?:token|session)=)[^\s&]+/g, '$1[redacted]');
  process.exitCode = 1;
} finally {
  await mkdir('artifacts/qa', { recursive: true });
  await writeFile('artifacts/qa/repair-recovery.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
