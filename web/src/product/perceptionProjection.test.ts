import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import type { PerceptionResult } from '../../../contracts/index';
import { inspectPerceptionProjection } from '../viewer/perceptionProjection';

const now = 10_000;
function sample(overrides: Partial<PerceptionResult> = {}): PerceptionResult {
  const camera = new PerspectiveCamera(55, 16 / 9, .03, 150);
  camera.up.set(0, 0, 1); camera.position.set(0, -4, 3); camera.lookAt(0, 0, .5); camera.updateMatrixWorld();
  return { session_id: 'session-a', frame_id: 8, captured_at: 9_000, processed_at: 9_500, frame_width: 1280, frame_height: 720, status: 'tracking', world_to_clip: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray(), scale: 'estimated_metric', reason: '', model: 'synthetic-test', inference_ms: 500, ...overrides };
}

test('tracked matrix passes canonical Z-up world projection through without moving robot coordinates', () => {
  const point = new Vector3(.2, .4, 1.1), before = point.toArray(), original = sample();
  const result = inspectPerceptionProjection(original, 1920, 1080, now);
  assert.ok(result.value); assert.equal(result.value.worldToClip, original.world_to_clip);
  const first = point.clone().applyMatrix4(new Matrix4().fromArray(result.value.worldToClip));
  const movedCamera = new PerspectiveCamera(55, 16 / 9, .03, 150);
  movedCamera.up.set(0, 0, 1); movedCamera.position.set(1, -4, 3); movedCamera.lookAt(0, 0, .5); movedCamera.updateMatrixWorld();
  const changed = sample({ frame_id: 9, world_to_clip: new Matrix4().multiplyMatrices(movedCamera.projectionMatrix, movedCamera.matrixWorldInverse).toArray() });
  const accepted = inspectPerceptionProjection(changed, 1920, 1080, now);
  assert.ok(accepted.value);
  assert.notDeepEqual(first.toArray(), point.clone().applyMatrix4(new Matrix4().fromArray(accepted.value.worldToClip)).toArray());
  assert.deepEqual(point.toArray(), before);
});

test('stale, future, out-of-order, mismatched-aspect, lost and scale-unavailable poses fail closed', () => {
  const cursor = { sessionId: 'session-a', frameId: 8, capturedAt: 9_000 };
  for (const invalid of [sample({ captured_at: 4_999 }), sample({ captured_at: 10_300 }), sample({ frame_id: 7 }), sample({ captured_at: 8_999 }), sample({ status: 'lost' }), sample({ status: 'searching' }), sample({ status: 'error' }), sample({ scale: 'unavailable' }), sample({ frame_width: 720, frame_height: 1280 })]) assert.equal(inspectPerceptionProjection(invalid, 1280, 720, now, cursor).value, null);
  assert.ok(inspectPerceptionProjection(sample(), 1280, 720, now, cursor).value);
  assert.equal(inspectPerceptionProjection(sample(), 1280, 720, 14_001, cursor).value, null);
});

test('malformed matrices and missing video dimensions never reach the renderer', () => {
  for (const matrix of [null, [], Array(16).fill(0), [...Array(15).fill(1), NaN], [...Array(15).fill(1), Infinity]]) assert.equal(inspectPerceptionProjection(sample({ world_to_clip: matrix }), 1280, 720, now).value, null);
  assert.equal(inspectPerceptionProjection(sample(), 0, 0, now).value, null);
});
