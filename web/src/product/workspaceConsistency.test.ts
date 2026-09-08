import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayEvent, RepairArtifact } from '../../../contracts/index';
import { evidenceMatches, hydratedRepair, mergeGatewayEvents } from './workspaceConsistency';

const artifact = (id: string, created_at: string, status: RepairArtifact['status'] = 'passed'): RepairArtifact => ({ id, created_at, status, model: 'gpt-6-astra', scene_epoch: 7, source: 'function coordinate(){}', source_hash: id, explanation: '', test_output: '' });

test('scene edits and a replacement source invalidate evidence, while search evidence needs no source hash', () => {
  assert.equal(evidenceMatches(7, 'hash-a', 7, 'hash-a', 'episode-a', 'episode-a'), true);
  assert.equal(evidenceMatches(7, 'hash-a', 8, 'hash-a', 'episode-a', 'episode-a'), false);
  assert.equal(evidenceMatches(7, 'hash-a', 7, 'hash-b', 'episode-a', 'episode-a'), false);
  assert.equal(evidenceMatches(7, null, 7, 'hash-b', 'episode-a', 'episode-a'), true);
  assert.equal(evidenceMatches(null, null, 7, undefined, 'episode-a', 'episode-a'), false);
});

test('a restarted world with a reused epoch cannot accept old or legacy evidence', () => {
  assert.equal(evidenceMatches(1, 'hash-a', 1, 'hash-a', 'old-world-uuid', 'new-world-uuid'), false);
  assert.equal(evidenceMatches(1, 'hash-a', 1, 'hash-a', undefined, 'new-world-uuid'), false);
});

test('late artifact hydration cannot overwrite a streaming update or a newer repair', () => {
  const captured = artifact('a', '2026-09-08T12:00:00Z', 'testing');
  const completed = { ...captured, status: 'passed' as const };
  assert.equal(hydratedRepair(completed, captured, false), completed);
  const newest = artifact('b', '2026-09-08T12:01:00Z');
  assert.equal(hydratedRepair(newest, captured, true), newest);
  assert.equal(hydratedRepair(null, completed, true), completed);
  assert.equal(hydratedRepair(completed, undefined, true), completed);
});

test('history hydration retains events received during the fetch and deduplicates overlap', () => {
  const old: GatewayEvent = { type: 'status', at: '2026-09-08T12:00:00Z', message: 'Search started' };
  const fresh: GatewayEvent = { type: 'repair', at: '2026-09-08T12:00:01Z', message: 'Candidate passed' };
  assert.deepEqual(mergeGatewayEvents([old, fresh], [old]), [old, fresh]);
});
