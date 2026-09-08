import type { RepairArtifact, WorldSnapshot } from '../contracts/index';

/** Epoch counters restart with the process; the captured episode UUID must match too. */
export function assertArtifactOrigin(artifact: RepairArtifact, state: Pick<WorldSnapshot,'scene_epoch'|'episode_id'>) {
  if (!artifact.origin_episode_id || artifact.origin_episode_id !== state.episode_id || artifact.scene_epoch !== state.scene_epoch) {
    throw Object.assign(new Error('Repair origin is stale or unavailable. Find a fresh counterexample after scene changes or simulation restarts.'), {status:409});
  }
  if (!artifact.source || !['passed','failed'].includes(artifact.status)) {
    throw Object.assign(new Error('Only submitted, independently evaluated source can be replayed or tested on held-out scenes.'), {status:409});
  }
}
