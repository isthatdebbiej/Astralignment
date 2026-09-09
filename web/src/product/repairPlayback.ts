import type { RepairArtifact } from '../../../contracts';
import { evidenceMatches } from './workspaceConsistency';

export function repairPlaybackIsCurrent(result: RepairArtifact, epoch: number | undefined, episodeId: string): boolean {
  return evidenceMatches(result.scene_epoch, null, epoch, undefined, result.origin_episode_id, episodeId)
    && Boolean(result.source_hash) && result.evaluation?.policy_hash === result.source_hash
    && Boolean(result.evaluation?.frames.length);
}
