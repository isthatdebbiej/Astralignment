import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairPlaybackIsCurrent } from '../../web/src/App';
import type { RepairArtifact } from '../../contracts';

test('repair playback requires current origin, actual frames, and matching evaluated source', () => {
  const artifact = { scene_epoch: 7, origin_episode_id: 'origin', source_hash: 'frozen', evaluation: { policy_hash: 'frozen', frames: [{}] } } as RepairArtifact;
  assert.equal(repairPlaybackIsCurrent(artifact, 7, 'origin'), true);
  assert.equal(repairPlaybackIsCurrent(artifact, 8, 'origin'), false);
  assert.equal(repairPlaybackIsCurrent(artifact, 7, 'restarted'), false);
  assert.equal(repairPlaybackIsCurrent({ ...artifact, source_hash: 'changed' }, 7, 'origin'), false);
  assert.equal(repairPlaybackIsCurrent({ ...artifact, evaluation: { ...artifact.evaluation!, frames: [] } }, 7, 'origin'), false);
});
