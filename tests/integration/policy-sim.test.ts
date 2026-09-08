/**
 * Real integration proof with a HUMAN-AUTHORED fixture, never an Astra API call.
 * Run: node --import tsx --test tests/integration/policy-sim.test.ts
 * Owns only its spawned service on 127.0.0.1:8002; never touches live 8001.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_SCENE, type EvaluationResult, type WorldSnapshot } from '../../contracts/index';

const project = fileURLToPath(new URL('../../', import.meta.url));
const python = fileURLToPath(new URL(process.platform === 'win32' ? '../../.venv/Scripts/python.exe' : '../../.venv/bin/python', import.meta.url));
const base = 'http://127.0.0.1:8002';
const priorSimUrl = process.env.SIM_URL;
let child: ChildProcess | undefined;
let serviceLogs = '';
let client: typeof import('../../gateway/sim-client');
let fixture: string;
let checkpointId: string;
let checkpointStateHash: string;
let frozenState: WorldSnapshot;

function portAlreadyOpen(): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 8002 });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function stopOwnedService() {
  const owned = child;
  if (!owned || owned.pid === undefined || owned.exitCode !== null || owned.signalCode !== null) return;
  const exited = once(owned, 'exit');
  if (process.platform === 'win32') {
    // Windows venv python owns a CPython child. /T targets only descendants
    // of the exact process created here; it never enumerates existing PIDs.
    const terminator = spawn('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await Promise.race([once(terminator, 'exit'), delay(5000)]);
  } else {
    owned.kill('SIGTERM');
  }
  await Promise.race([exited, delay(5000)]);
  if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL');
}

before(async () => {
  assert.equal(await portAlreadyOpen(), false, 'Port 8002 occupied; refusing to use or stop an existing service');
  fixture = await readFile(new URL('./fixtures/human-authored-serial-reservation.js', import.meta.url), 'utf8');
  assert.match(fixture, /HUMAN-AUTHORED TEST FIXTURE/);
  child = spawn(python, ['-m', 'uvicorn', 'sim.server:app', '--host', '127.0.0.1', '--port', '8002', '--log-level', 'info'], {
    cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error; });
  const capture = (chunk: Buffer) => { serviceLogs = (serviceLogs + chunk.toString()).slice(-16000); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const deadline = Date.now() + 60000;
  let started = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, `Owned simulation exited during startup:\n${serviceLogs}`);
    // Mutate only after our child confirms it successfully bound port 8002.
    if (serviceLogs.includes('Uvicorn running on http://127.0.0.1:8002')) {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const health = await response.json() as { shared_world: boolean; robots: number; physics_hz: number; policy_hz: number };
        assert.equal(health.shared_world, true);
        assert.equal(health.robots, 2);
        assert.equal(health.physics_hz, 500);
        assert.equal(health.policy_hz, 50);
        started = true;
        break;
      }
    }
    await delay(100);
  }
  assert.ok(started, `Owned simulation failed to become ready:\n${serviceLogs}`);
  process.env.SIM_URL = base;
  // SIM_URL is read at module evaluation: dynamic import follows setup.
  client = await import('../../gateway/sim-client');
  assert.deepEqual(await client.sim('/scene'), DEFAULT_SCENE, 'Python and gateway defaults must match');
  await client.sim('/reset', { scene: DEFAULT_SCENE });
  // Populate genuine recurrent/controller buffers before freezing.
  await client.sim('/step', { commands: { g1_a: [0, 0], g1_b: [0, 0] }, steps: 10 });
  const checkpoint = await client.sim<{ checkpoint_id: string; state_hash: string; state: WorldSnapshot }>('/checkpoint', {});
  checkpointId = checkpoint.checkpoint_id;
  checkpointStateHash = checkpoint.state_hash;
  frozenState = checkpoint.state;
  assert.match(checkpoint.state_hash, /^[a-f0-9]{64}$/);
  assert.equal(frozenState.tick, 100);
}, { timeout: 70000 });

after(async () => {
  await stopOwnedService();
  if (priorSimUrl === undefined) delete process.env.SIM_URL;
  else process.env.SIM_URL = priorSimUrl;
});

function replayEvidence(result: EvaluationResult) {
  return { passed: result.passed, reason: result.reason, metrics: result.metrics,
    frames: result.frames.map(frame => ({ tick: frame.tick, sim_time: frame.sim_time,
      robots: frame.robots, bodies: frame.bodies, metrics: frame.metrics })) };
}

test('human-authored fixture runs through QuickJS, physical branches, and evaluator with exact frozen replay', { timeout: 180000 }, async t => {
  const first = await client.evaluateSource(fixture, DEFAULT_SCENE, { checkpoint_id: checkpointId, duration: 30 });
  assert.equal(first.mode, 'external');
  assert.equal(first.passed, true, JSON.stringify({ reason: first.reason, metrics: first.metrics }));
  assert.equal(first.metrics.goals_reached, 2);
  assert.equal(first.metrics.robot_contacts, 0);
  assert.equal(first.metrics.obstacle_contacts, 0);
  assert.equal(first.metrics.keepout_violations, 0);
  assert.equal(first.metrics.falls, 0);
  assert.ok(first.frames.length > 20, 'Proof must include freshly integrated trajectory frames');
  assert.ok(first.frames.some(frame => frame.robots.find(robot => robot.id === 'g1_b')?.action === 'wait'));
  assert.ok(first.frames.some(frame => frame.robots.find(robot => robot.id === 'g1_b')?.action === 'go'));
  for (const robot of first.frames.at(-1)!.robots) {
    const start = frozenState.robots.find(initial => initial.id === robot.id)!;
    assert.ok(Math.hypot(robot.position[0]-start.position[0], robot.position[1]-start.position[1]) > 3.4);
  }
  const second = await client.evaluateSource(fixture, DEFAULT_SCENE, { checkpoint_id: checkpointId, duration: 30 });
  assert.deepEqual(replayEvidence(second), replayEvidence(first), 'Frozen physics, LSTM, source memory, and worker execution must replay exactly');
  assert.equal(second.policy_hash, first.policy_hash);
  assert.deepEqual(await client.sim<WorldSnapshot>('/state'), frozenState, 'Branches must leave the live test world untouched');
  t.diagnostic(JSON.stringify({ evidence: 'HUMAN-AUTHORED TEST FIXTURE, NOT ASTRA', passed: first.passed,
    metrics: first.metrics, frames: first.frames.length, source_hash: first.policy_hash,
    checkpoint_state_hash: checkpointStateHash, exact_replay: true }));
});

test('gateway evaluation rejects a checkpoint invalidated by a scene epoch change', { timeout: 15000 }, async () => {
  const invalidated = await client.sim<WorldSnapshot>('/invalidate', {});
  assert.ok(invalidated.scene_epoch > frozenState.scene_epoch);
  await assert.rejects(client.evaluateSource(fixture, DEFAULT_SCENE, { checkpoint_id: checkpointId, duration: 1 }), /409.*Checkpoint invalidated by scene change/);
  assert.deepEqual(await client.sim<WorldSnapshot>('/state'), invalidated, 'Rejected replay must not advance the invalidated world');
});
