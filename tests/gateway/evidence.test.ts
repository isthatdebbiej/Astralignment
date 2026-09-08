import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {RepairArtifact} from '../../contracts/index';
import {assertArtifactOrigin} from '../../gateway/evidence';

test('persisted source cannot become fresh when a restarted simulator reuses an epoch',()=>{
  const artifact:RepairArtifact={id:'fixture',model:'human-authored-test-only',created_at:'2026-09-08',scene_epoch:1,origin_episode_id:'captured-uuid',status:'passed',source:'function coordinate(){}',source_hash:'fixture-only',explanation:'',test_output:''};
  assert.doesNotThrow(()=>assertArtifactOrigin(artifact,{scene_epoch:1,episode_id:'captured-uuid'}));
  assert.throws(()=>assertArtifactOrigin(artifact,{scene_epoch:1,episode_id:'restart-uuid'}),{status:409});
  assert.throws(()=>assertArtifactOrigin(artifact,{scene_epoch:2,episode_id:'captured-uuid'}),{status:409});
  assert.throws(()=>assertArtifactOrigin({...artifact,origin_episode_id:undefined},{scene_epoch:1,episode_id:'captured-uuid'}),{status:409});
  assert.throws(()=>assertArtifactOrigin({...artifact,status:'testing'},{scene_epoch:1,episode_id:'captured-uuid'}),{status:409});
});
