import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, lstat, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { McapWriter } from '@mcap/core';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ExperimentRecord {
  schema_version: 1;
  id: string;
  kind: string;
  created_at: string;
  parent_experiment_id?: string;
  sha256: string;
  payload_bytes: number;
  trajectory_frame_count: number;
  camera_pixels: 'excluded';
  provenance: { source_files: Record<string, { sha256: string; bytes: number } | { unavailable: 'ENOENT' }>; model_provenance?: Json };
  payload: Json;
}
export type ExperimentSummary = Omit<ExperimentRecord, 'payload'>;
export interface ExperimentStoreOptions { root?: string; projectRoot?: string; maxRecordBytes?: number; maxArchiveBytes?: number; maxRecords?: number; provenanceFiles?: string[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KIND = /^[a-z][a-z0-9_.-]{0,63}$/;
const DEFAULT_PROVENANCE = ['sim/world.py', 'gateway/policy.ts', 'gateway/recordings.ts', 'package.json', 'package-lock.json', 'sim/models/unitree_g1/provenance.json', 'sim/models/unitree_g1/policy-config.yaml'];
const PIXEL_KEYS = new Set(['image', 'image_data', 'imageDataUrl', 'image_url', 'depth_preview', 'pixels', 'jpeg', 'camera_pixels']);
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function validateId(id: string): void { if (typeof id !== 'string' || !UUID.test(id)) fail('Experiment ID must be a lowercase UUIDv4.'); }
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Canonical bounded JSON. Optional undefined object properties are omitted, as in JSON.stringify.
 * Undefined array values, non-finite numbers, cycles, binary data and pixels are rejected; frames are never truncated.
 */
function serialize(value: unknown, maxBytes: number, forbidPixels = false): string {
  const stack = new Set<object>(); let nodes = 0, bytes = 0;
  const account = (text: string) => { bytes += Buffer.byteLength(text); if (bytes > maxBytes) fail('Experiment exceeds the configured record byte limit.', 413); return text; };
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 4_000_000 || depth > 64) fail('Experiment JSON exceeds structural limits.', 413);
    if (item === null) return account('null');
    if (typeof item === 'boolean') return account(String(item));
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('Experiment JSON contains a non-finite number.'); return account(JSON.stringify(item)); }
    if (typeof item === 'string') { if (forbidPixels && /data:image\//i.test(item)) fail('Camera pixels are excluded from experiment records.'); return account(JSON.stringify(item)); }
    if (typeof item !== 'object' || item === undefined) fail('Experiment payload must contain only JSON values; undefined, functions and bigint are not supported.');
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) fail('Binary data and camera pixels are excluded; encode non-image checkpoint state as JSON arrays.');
    if (stack.has(item)) fail('Experiment JSON contains a cycle.');
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) fail('Experiment payload must contain plain JSON objects.');
    if (Object.getOwnPropertySymbols(item).length) fail('Experiment JSON cannot contain symbol keys.');
    stack.add(item);
    let text: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) fail('Experiment arrays must be dense and cannot have extra properties.');
      text = account('[') + item.map((value, index) => (index ? account(',') : '') + visit(value, depth + 1)).join('') + account(']');
    } else {
      const keys = Object.keys(item).filter(key => { const descriptor = Object.getOwnPropertyDescriptor(item, key)!; return !('value' in descriptor) || descriptor.value !== undefined; }).sort();
      text = account('{') + keys.map(key => {
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in property)) fail('Experiment JSON cannot contain getters or setters.');
        if (forbidPixels && PIXEL_KEYS.has(key) && property.value != null && property.value !== '') fail(`Camera pixel field '${key}' is excluded from experiment records.`);
        return account(JSON.stringify(key)) + account(':') + visit(property.value, depth + 1);
      }).join(',') + account('}');
      bytes += Math.max(0, keys.length - 1);
    }
    stack.delete(item); if (bytes > maxBytes) fail('Experiment exceeds the configured record byte limit.', 413); return text;
  };
  return visit(value, 0);
}

interface FrameArray { path: string; frames: Json[] }
function extractFrames(payload: Json): { metadataPayload: Json; arrays: FrameArray[] } {
  const arrays: FrameArray[] = [];
  const walk = (value: Json, current: string): Json => {
    if (Array.isArray(value)) return value.map((child, i) => walk(child, `${current}/${i}`));
    if (value && typeof value === 'object') {
      const result: Record<string, Json> = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${current}/${pointer(key)}`;
        if (key === 'frames' && Array.isArray(child)) { arrays.push({ path: childPath, frames: child }); result[key] = []; }
        else result[key] = walk(child, childPath);
      }
      return result;
    }
    return value;
  };
  return { metadataPayload: walk(payload, ''), arrays };
}

export function createExperimentStore(options: ExperimentStoreOptions = {}) {
  const root = path.resolve(options.root ?? 'runtime/experiments');
  const projectRoot = path.resolve(options.projectRoot ?? '.');
  const maxRecordBytes = options.maxRecordBytes ?? 128 * 1024 * 1024;
  const maxArchiveBytes = options.maxArchiveBytes ?? 2 * 1024 * 1024 * 1024;
  const maxRecords = options.maxRecords ?? 2000;
  for (const limit of [maxRecordBytes, maxArchiveBytes, maxRecords]) if (!Number.isSafeInteger(limit) || limit < 1) fail('Archive limits must be positive safe integers.');
  let writes: Promise<void> = Promise.resolve();
  const recordPath = (id: string) => { validateId(id); return path.join(root, `${id}.json`); };
  async function entries() {
    await mkdir(root, { recursive: true });
    const files = (await readdir(root)).filter(name => name.endsWith('.json'));
    if (files.length > maxRecords) fail('Archive exceeds its record-count limit; no records were silently omitted.', 507);
    const result: { id: string; bytes: number }[] = [];
    for (const file of files) {
      const id = file.slice(0, -5); validateId(id);
      const info = await lstat(recordPath(id));
      if (!info.isFile() || info.isSymbolicLink()) fail('Experiment archive contains a non-regular record file.', 500);
      if (info.size > maxRecordBytes) fail('Experiment file exceeds record byte limit.', 413);
      result.push({ id, bytes: info.size });
    }
    return result;
  }
  async function provenance(): Promise<ExperimentRecord['provenance']> {
    const result: ExperimentRecord['provenance'] = { source_files: {} };
    for (const name of options.provenanceFiles ?? DEFAULT_PROVENANCE) {
      const resolved = path.resolve(projectRoot, name);
      if (path.relative(projectRoot, resolved).startsWith('..') || path.isAbsolute(path.relative(projectRoot, resolved))) fail('Provenance file must remain inside project root.');
      try {
        const info = await lstat(resolved); if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) fail('Source provenance file is not a bounded regular file.', 500);
        const data = await readFile(resolved); result.source_files[name] = { sha256: digest(data), bytes: data.length };
        if (name.endsWith('/provenance.json')) result.model_provenance = JSON.parse(serialize(JSON.parse(data.toString('utf8')), 2 * 1024 * 1024));
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') result.source_files[name] = { unavailable: 'ENOENT' }; else throw error; }
    }
    return result;
  }
  async function readExperiment(id: string): Promise<ExperimentRecord> {
    const filename = recordPath(id), info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) fail('Experiment record is not a regular file.', 500);
    if (info.size > maxRecordBytes) fail('Experiment file exceeds record byte limit.', 413);
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let text: string;
    try { if ((await handle.stat()).size > maxRecordBytes) fail('Experiment file exceeds record byte limit.', 413); text = await handle.readFile('utf8'); } finally { await handle.close(); }
    const record = JSON.parse(text) as ExperimentRecord;
    if (!record || record.schema_version !== 1 || record.id !== id || !KIND.test(record.kind) || record.camera_pixels !== 'excluded' || !/^[0-9a-f]{64}$/.test(record.sha256) || !Number.isFinite(Date.parse(record.created_at))) fail('Experiment record has an invalid schema.', 500);
    if (record.parent_experiment_id !== undefined) validateId(record.parent_experiment_id);
    const { sha256, ...content } = record;
    if (digest(serialize(content, maxRecordBytes)) !== sha256) fail('Experiment checksum verification failed; record was not returned.', 500);
    const payloadText = serialize(record.payload, maxRecordBytes, true);
    if (Buffer.byteLength(payloadText) !== record.payload_bytes || extractFrames(record.payload).arrays.reduce((sum, item) => sum + item.frames.length, 0) !== record.trajectory_frame_count) fail('Experiment payload metadata verification failed.', 500);
    return record;
  }
  function recordExperiment(kind: string, payload: unknown, parentId?: string): Promise<ExperimentRecord> {
    // Clone before queuing: later caller mutation cannot change what was submitted.
    let frozen: Json, payloadBytes: number;
    try {
      if (typeof kind !== 'string' || !KIND.test(kind)) fail('Experiment kind must be a lowercase identifier of at most 64 characters.');
      if (parentId !== undefined) validateId(parentId);
      const text = serialize(payload, maxRecordBytes, true); frozen = JSON.parse(text); payloadBytes = Buffer.byteLength(text);
    } catch (error) { return Promise.reject(error); }
    const operation = writes.then(async () => {
      const files = await entries();
      if (parentId) await readExperiment(parentId);
      if (files.length >= maxRecords) fail('Experiment archive record quota reached; record was not saved.', 507);
      const content = { schema_version: 1 as const, id: randomUUID(), kind, created_at: new Date().toISOString(), ...(parentId ? { parent_experiment_id: parentId } : {}), payload_bytes: payloadBytes, trajectory_frame_count: extractFrames(frozen).arrays.reduce((sum, item) => sum + item.frames.length, 0), camera_pixels: 'excluded' as const, provenance: await provenance(), payload: frozen };
      const record: ExperimentRecord = { ...content, sha256: digest(serialize(content, maxRecordBytes)) };
      const data = serialize(record, maxRecordBytes);
      if (files.reduce((sum, item) => sum + item.bytes, 0) + Buffer.byteLength(data) > maxArchiveBytes) fail('Experiment archive byte quota reached; record was not saved.', 507);
      const destination = recordPath(record.id), temporary = path.join(root, `.${record.id}.${randomUUID()}.tmp`);
      let published = false;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, destination); published = true;
        // POSIX requires directory fsync for rename durability. Node cannot open directory handles on Windows.
        if (process.platform !== 'win32') { const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
        return record;
      } catch (error) {
        if (!published) { try { await unlink(temporary); } catch (cleanup) { if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') throw new AggregateError([error, cleanup], 'Archive write and temporary-file cleanup failed.'); } }
        throw error;
      }
    });
    // A failed disk write must not permanently poison subsequent attempts.
    writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async function listExperiments(): Promise<ExperimentSummary[]> {
    const summaries: ExperimentSummary[] = [];
    for (const file of await entries()) { const { payload: _payload, ...summary } = await readExperiment(file.id); summaries.push(summary); }
    return summaries.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }
  async function exportExperimentMcap(id: string): Promise<Buffer> {
    const record = await readExperiment(id), { metadataPayload, arrays } = extractFrames(record.payload);
    const chunks: Buffer[] = []; let bytes = 0;
    const writer = new McapWriter({ writable: { position: () => BigInt(bytes), write: async data => { if (bytes + data.byteLength > maxRecordBytes * 3) fail('MCAP export exceeds its bounded output limit.', 413); chunks.push(Buffer.from(data)); bytes += data.byteLength; } }, useChunks: true, chunkSize: 1024 * 1024, useStatistics: true, useChunkIndex: true });
    const encode = (value: unknown) => Buffer.from(serialize(value, maxRecordBytes));
    // Empty profile: custom JSON-schema channels, not ROS serialization or ROS topic compatibility.
    await writer.start({ profile: '', library: 'astralignment-experiments/1' });
    const metadataSchema = await writer.registerSchema({ name: 'astralignment.ExperimentMetadata', encoding: 'jsonschema', data: encode({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['record', 'frame_arrays', 'time_basis'], properties: { record: { type: 'object' }, frame_arrays: { type: 'array' }, time_basis: { type: 'string' } } }) });
    const frameSchema = await writer.registerSchema({ name: 'astralignment.TrajectoryFrame', encoding: 'jsonschema', data: encode({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['experiment_id', 'path', 'index', 'frame'], properties: { experiment_id: { type: 'string' }, path: { type: 'string' }, index: { type: 'integer', minimum: 0 }, frame: {} } }) });
    const metadataChannel = await writer.registerChannel({ schemaId: metadataSchema, topic: '/astralignment/experiment', messageEncoding: 'json', metadata: new Map([['schema_version', '1']]) });
    const frameChannel = await writer.registerChannel({ schemaId: frameSchema, topic: '/astralignment/trajectory', messageEncoding: 'json', metadata: new Map([['basis', 'right-handed Z-up; meters'], ['timestamps', 'relative simulation time when present; sequence otherwise']]) });
    await writer.addMessage({ channelId: metadataChannel, sequence: 0, logTime: 0n, publishTime: 0n, data: encode({ record: { ...record, payload: metadataPayload }, frame_arrays: arrays.map(item => ({ path: item.path, count: item.frames.length })), time_basis: 'Relative sim_time seconds when present; sequence nanoseconds otherwise. Not wall-clock capture times. Original frame fields are preserved.' }) });
    let sequence = 0;
    for (const array of arrays) for (let index = 0; index < array.frames.length; index++) {
      const frame = array.frames[index];
      const seconds = frame && typeof frame === 'object' && !Array.isArray(frame) ? frame.sim_time : undefined;
      const nanos = typeof seconds === 'number' && seconds >= 0 && seconds <= 1e9 ? BigInt(Math.round(seconds * 1e9)) : BigInt(sequence);
      await writer.addMessage({ channelId: frameChannel, sequence: sequence++, logTime: nanos, publishTime: nanos, data: encode({ experiment_id: id, path: array.path, index, frame }) });
    }
    await writer.end();
    return Buffer.concat(chunks, bytes);
  }
  return { recordExperiment, listExperiments, readExperiment, exportExperimentMcap };
}

const store = createExperimentStore();
export const { recordExperiment, listExperiments, readExperiment, exportExperimentMcap } = store;
