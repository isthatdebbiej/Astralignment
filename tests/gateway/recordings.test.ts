import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McapIndexedReader } from '@mcap/core';
import { createExperimentStore } from '../../gateway/recordings';

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'astra-archive-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createExperimentStore({ root, provenanceFiles: [] }) };
}
const frame = (tick: number) => ({ episode_id: 'physical-episode', tick, sim_time: tick / 500, bodies: [{ name: 'g1_a/pelvis', position: [1, 2, .7], quaternion: [1, 0, 0, 0] }], metrics: { robot_contacts: 0, min_separation: null } });

test('records survive reopening with complete frames/checkpoint and immutable lineage', async t => {
  const { root, store } = await fixture(t);
  const payload = { scene: { seed: 7 }, checkpoint: { qpos: [1, 2, 3], qvel: [0, 0, 0], policy_state: [[.2, .4]] }, evaluation: { frames: [frame(0), frame(25), frame(50)] } };
  const first = await store.recordExperiment('baseline', payload);
  payload.checkpoint.qpos[0] = 999;
  const reopened = createExperimentStore({ root, provenanceFiles: [] });
  const saved = await reopened.readExperiment(first.id);
  assert.equal(saved.schema_version, 1); assert.equal(saved.camera_pixels, 'excluded');
  assert.equal(saved.trajectory_frame_count, 3); assert.match(saved.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual((saved.payload as any).checkpoint.qpos, [1, 2, 3]);
  assert.deepEqual((saved.payload as any).evaluation.frames, [frame(0), frame(25), frame(50)]);
  const childRead = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {createExperimentStore} from './gateway/recordings.ts'; const record=await createExperimentStore({root:process.argv[1],provenanceFiles:[]}).readExperiment(process.argv[2]); process.stdout.write(JSON.stringify(record));", root, saved.id], { cwd: process.cwd() });
  assert.deepEqual(JSON.parse(childRead.stdout), saved, 'A fresh Node process reads the complete durable record');
  const child = await reopened.recordExperiment('replay', { frames: [frame(0)] }, saved.id);
  assert.equal(child.parent_experiment_id, saved.id);
  const listed = await reopened.listExperiments(); assert.equal(listed.length, 2); assert.equal('payload' in listed[0], false);
  assert.equal((await readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('checksum corruption and invalid IDs fail closed on read, list and export', async t => {
  const { root, store } = await fixture(t);
  const saved = await store.recordExperiment('baseline', { frames: [frame(0)] });
  for (const invalid of ['../state', '/etc/passwd', `${saved.id}/../state`, saved.id.toUpperCase(), 'not-a-uuid']) {
    await assert.rejects(store.readExperiment(invalid), /UUID/);
    await assert.rejects(store.exportExperimentMcap(invalid), /UUID/);
  }
  const filename = path.join(root, `${saved.id}.json`), changed = JSON.parse(await readFile(filename, 'utf8')); changed.payload.frames[0].tick = 999;
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(store.readExperiment(saved.id), /checksum/);
  await assert.rejects(store.listExperiments(), /checksum/);
  await assert.rejects(store.exportExperimentMcap(saved.id), /checksum/);
});

test('strict JSON and pixel exclusion reject invalid payloads without partial records', async t => {
  const { root, store } = await fixture(t);
  const cycle: any = {}; cycle.self = cycle;
  for (const invalid of [{ frame: 'data:image/jpeg;base64,private-camera' }, { image: 'raw-pixels' }, { camera: { depth_preview: 'private' } }, { binary: Buffer.from([1, 2]) }, { value: NaN }, { value: [undefined] }, { value: 1n }, { value: new Map() }, cycle, [1, , 3]]) await assert.rejects(store.recordExperiment('fixture', invalid));
  assert.deepEqual(await readdir(root), []);
  const saved = await store.recordExperiment('checkpoint', { qpos: [0, 1, 2], recurrent: [[1, 0], [0, 1]], encoded_state: 'application/octet-stream base64 state' });
  assert.ok(saved.id);
  const optional = await store.recordExperiment('repair_error', { evaluation: undefined, checkpoint_id: undefined, nested: { optional: undefined, retained: true } });
  assert.deepEqual(optional.payload, { nested: { retained: true } });
});

test('atomic publication, bounded quotas, and failed writes do not poison later attempts', async t => {
  const { root } = await fixture(t);
  const store = createExperimentStore({ root, provenanceFiles: [], maxRecords: 3, maxRecordBytes: 4096, maxArchiveBytes: 12_288 });
  await assert.rejects(store.recordExperiment('fixture', { source: 'x'.repeat(5000) }), { status: 413 });
  const records = await Promise.all(Array.from({ length: 3 }, (_, index) => store.recordExperiment('fixture', { index, frames: [frame(index)] })));
  assert.equal(new Set(records.map(item => item.id)).size, 3);
  await assert.rejects(store.recordExperiment('fixture', {}), { status: 507 });
  assert.equal((await store.listExperiments()).length, 3);
  assert.ok((await readdir(root)).every(name => name.endsWith('.json')));
  const blocked = path.join(root, 'not-a-directory'); await writeFile(blocked, 'fixture');
  const recovery = createExperimentStore({ root: blocked, provenanceFiles: [] });
  await assert.rejects(recovery.recordExperiment('fixture', {}));
  await rm(blocked); await mkdir(blocked);
  assert.ok((await recovery.recordExperiment('fixture', { recovered: true })).id);
  const byteLimited = createExperimentStore({ root: path.join(root, 'byte-limited'), provenanceFiles: [], maxRecordBytes: 4096, maxArchiveBytes: 10 });
  await assert.rejects(byteLimited.recordExperiment('fixture', {}), { status: 507 });
  assert.deepEqual(await readdir(path.join(root, 'byte-limited')), []);
});

test('source files and model provenance are hashed with explicit missing-source metadata', async t => {
  const { root } = await fixture(t), project = path.join(root, 'project');
  await mkdir(path.join(project, 'models'), { recursive: true });
  await writeFile(path.join(project, 'source.ts'), 'const canonical = true;');
  await writeFile(path.join(project, 'models', 'provenance.json'), JSON.stringify({ license: 'fixture-only', mesh_sha256: 'fixture' }));
  const store = createExperimentStore({ root: path.join(root, 'archive'), projectRoot: project, provenanceFiles: ['source.ts', 'models/provenance.json', 'missing.ts'] });
  const record = await store.recordExperiment('fixture', {});
  assert.equal((record.provenance.source_files['source.ts'] as any).sha256, createHash('sha256').update('const canonical = true;').digest('hex'));
  assert.deepEqual(record.provenance.model_provenance, { license: 'fixture-only', mesh_sha256: 'fixture' });
  assert.deepEqual(record.provenance.source_files['missing.ts'], { unavailable: 'ENOENT' });
});

test('official MCAP indexed reader round-trips nested trajectories, metadata and checkpoint', async t => {
  const { store } = await fixture(t);
  const payload = { checkpoint: { qpos: [1, 2, 3], qvel: [0, 0, 0] }, trials: [{ seed: 7, frames: [frame(0), frame(50)] }, { seed: 8, frames: [frame(25)] }], 'escaped/key~': { frames: [] } };
  const saved = await store.recordExperiment('heldout', payload), buffer = await store.exportExperimentMcap(saved.id);
  const reader = await McapIndexedReader.Initialize({ readable: { size: async () => BigInt(buffer.length), read: async (offset, size) => buffer.subarray(Number(offset), Number(offset) + Number(size)) } });
  assert.equal(reader.header.profile, ''); assert.equal(reader.statistics?.messageCount, 4n);
  assert.equal(reader.schemasById.size, 2); assert.ok([...reader.schemasById.values()].every(schema => schema.encoding === 'jsonschema'));
  let metadata: any; const frames: any[] = [];
  for await (const message of reader.readMessages({ validateCrcs: true })) {
    const value = JSON.parse(Buffer.from(message.data).toString('utf8'));
    const channel = reader.channelsById.get(message.channelId)!;
    assert.equal(channel.messageEncoding, 'json');
    if (channel.topic === '/astralignment/experiment') metadata = value; else frames.push(value);
  }
  assert.equal(metadata.record.sha256, saved.sha256); assert.equal(frames.length, 3);
  assert.equal(metadata.frame_arrays.length, 3); assert.ok(metadata.frame_arrays.some((item: any) => item.path === '/escaped~1key~0/frames' && item.count === 0));
  for (const item of frames) {
    const segments = item.path.slice(1).split('/').map((key: string) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    let target = metadata.record.payload;
    for (const segment of segments) target = target[segment];
    target[item.index] = item.frame;
  }
  assert.deepEqual(metadata.record.payload, payload);
});
