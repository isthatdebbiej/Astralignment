/** Canonical world basis: meters, right handed, Z up, XY stage centered at (0,0). */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type QuatWXYZ = [number, number, number, number];
export type RobotId = 'g1_a' | 'g1_b';
export type ControllerMode = 'independent' | 'reservation' | 'external';
export interface RobotSpec { id: RobotId; spawn: [number, number, number]; goal: Vec2 }
export interface Obstacle { id: string; position: Vec2; size: Vec3 }
export interface Keepout { id: string; polygon: Vec2[] }
export interface SceneConfig { width: number; depth: number; seed: number; robots: RobotSpec[]; obstacles: Obstacle[]; keepouts: Keepout[] }
export interface BodyPose { name: string; position: Vec3; quaternion: QuatWXYZ }
export interface RobotState { id: RobotId; position: Vec3; quaternion: QuatWXYZ; velocity: Vec3; fallen: boolean; goal_reached: boolean; distance_to_goal: number; command: Vec3; action: 'go' | 'wait' }
export interface Metrics { min_separation: number | null; robot_contacts: number; obstacle_contacts: number; keepout_violations: number; falls: number; goals_reached: number; elapsed: number; deadlock: boolean }
export interface TraceEvent { id: string; tick: number; sim_time: number; kind: string; message: string; severity: 'info' | 'warning' | 'error' | 'success'; robot_id?: RobotId }
export interface WorldSnapshot { episode_id: string; scene_epoch: number; tick: number; sim_time: number; paused: boolean; mode: ControllerMode; robots: RobotState[]; bodies: BodyPose[]; metrics: Metrics; events: TraceEvent[] }
export interface VisualGeom { name: string; body: string; kind: 'mesh' | 'box' | 'sphere' | 'capsule' | 'cylinder' | 'plane'; size: number[]; local_position: Vec3; local_quaternion: QuatWXYZ; mesh?: string; rgba: [number, number, number, number] }
export interface ModelDescription { scene_epoch: number; episode_id: string; geoms: VisualGeom[]; scene: SceneConfig; provenance: Record<string, unknown> }
export interface RobotCommand { robot_id: RobotId; action: 'go' | 'wait'; speed?: number; waypoint?: Vec2 }
export interface EvaluationResult { episode_id: string; scene_epoch: number; scene?: SceneConfig; mode: ControllerMode; seed: number; policy_hash?: string; passed: boolean; metrics: Metrics; frames: WorldSnapshot[]; events: TraceEvent[]; reason: string }
export interface RepairArtifact { id: string; model: string; created_at: string; scene_epoch: number; origin_episode_id?: string; status: 'generating' | 'testing' | 'passed' | 'failed' | 'error'; source: string; source_hash: string; explanation: string; test_output: string; evaluation?: EvaluationResult; usage_usd?: number }
export interface GatewayEvent { type: 'status' | 'repair' | 'search' | 'error' | 'scene_invalidated'; at: string; message: string; data?: unknown }
export interface SearchResult { found: boolean; trials: number; seed: number; scene: SceneConfig; evaluation: EvaluationResult | null; message: string }
export interface CameraCalibration { corners: Vec2[]; width: number; depth: number; captured_at: string; frame_width: number; frame_height: number }
export const DEFAULT_SCENE: SceneConfig = {
  width: 8, depth: 6, seed: 7,
  robots: [ { id: 'g1_a', spawn: [-2, 0, 0], goal: [2, 0] }, { id: 'g1_b', spawn: [0, -2, Math.PI / 2], goal: [0, 2] } ],
  obstacles: [], keepouts: [{ id: 'presenter', polygon: [[-3.8, -2.7], [-2.85, -2.7], [-2.85, 2.7], [-3.8, 2.7]] }],
};
