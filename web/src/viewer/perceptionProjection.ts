import { Matrix4 } from 'three';
import type { PerceptionResult } from '../../../contracts/index';

export const MAX_TRACKED_POSE_AGE_MS = 5_000;
export interface PerceptionCursor { sessionId: string; frameId: number; capturedAt: number }
export interface TrackedProjection { worldToClip: number[]; ageMs: number }

/** Gate inferred poses; never extrapolate or alter the authoritative world basis. */
export function inspectPerceptionProjection(result: PerceptionResult | null | undefined, videoWidth: number, videoHeight: number, now: number, cursor?: PerceptionCursor | null): { value: TrackedProjection | null; reason: string; ageMs: number | null } {
  const reject = (reason: string, ageMs: number | null = null) => ({ value: null, reason, ageMs });
  if (!result) return reject('Waiting for a spatial estimate.');
  if (!result.session_id || !Number.isSafeInteger(result.frame_id) || result.frame_id < 0 || !Number.isFinite(result.captured_at)) return reject('Invalid spatial frame identity.');
  if (cursor?.sessionId === result.session_id && (result.frame_id < cursor.frameId || result.captured_at < cursor.capturedAt)) return reject('Out-of-order spatial estimate ignored.');
  const ageMs = now - result.captured_at;
  if (ageMs < -250) return reject('Spatial frame timestamp is ahead of the camera clock.');
  if (ageMs > MAX_TRACKED_POSE_AGE_MS) return reject('Spatial estimate is stale. Robot overlay hidden until a fresh pose arrives.', ageMs);
  if (result.status !== 'tracking') return reject(result.reason || (result.status === 'lost' ? 'Tracking lost. Move slowly and keep the floor in view.' : 'Searching for the floor and camera pose.'), Math.max(0, ageMs));
  if (result.scale !== 'estimated_metric') return reject('Spatial scale is unavailable. Robot overlay hidden.', ageMs);
  if (![videoWidth, videoHeight, result.frame_width, result.frame_height].every(value => Number.isFinite(value) && value > 0)) return reject('Waiting for camera frame dimensions.', ageMs);
  if (Math.abs((videoWidth / videoHeight) / (result.frame_width / result.frame_height) - 1) >= 0.025) return reject('Camera framing changed. Waiting for a matching spatial estimate.', ageMs);
  const matrix = result.world_to_clip;
  if (!matrix || matrix.length !== 16 || !matrix.every(Number.isFinite) || Math.abs(new Matrix4().fromArray(matrix).determinant()) < 1e-12) return reject('Spatial projection is invalid. Robot overlay hidden.', ageMs);
  return { value: { worldToClip: matrix, ageMs: Math.max(0, ageMs) }, reason: '', ageMs: Math.max(0, ageMs) };
}
