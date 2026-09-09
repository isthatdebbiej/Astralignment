export const BOTFAILS_REVISION = '3478e49d91e1737eb76dfee2d81bb22617039c13';
export const REVIEW_ROLES = ['successful demonstration', 'failure', 'recovery', 'unknown'] as const;
export type ReviewRole = typeof REVIEW_ROLES[number];
export interface EvidenceInterval { stream_id: string; start: number; end: number; unit: 'seconds' | 'frames'; }
export interface Artifact { id: string; path: string; sha256: string; bytes: number; kind: string; }
export interface Episode {
  id: string; source_id: string; source_episode: string; family_id: string;
  task: string; split: string; origin: 'public recording' | 'fixture';
  robot: string | null; duration: number | null; fps: number | null;
  frames: number; upstream_splits: Record<string,string>; task_text: string[];
  streams: Array<{id:string; kind:string; artifact_id:string; timing:string}>;
  artifacts: Artifact[]; annotations: Array<{label:string; start_frame:number; end_frame:number; evidence:string}>;
  findings: string[]; channels: string[]; latest_review?: Review;
}
export interface Review {
  id:string; episode_id:string; role:ReviewRole; rationale:string; evidence:string[];
  interval:EvidenceInterval|null; created_at:string; supersedes:string|null; reviewer:string;
}
export interface Source {
  id:string; project_id:string; name:string; snapshot:string; revision:string; license:string;
  tasks:string[]; status:string; origin:'public recording'|'fixture'; created_at:string;
  plan?:{estimated_bytes:number; files:Array<{path:string;bytes:number|null;sha256:string}>; episodes:unknown[]; findings:string[]};
}
export interface CollectionMember { episode_id:string; interval:EvidenceInterval|null; }
export interface Collection {
  id:string; project_id:string; name:string; intended_use:string; members:CollectionMember[];
  exclusions:Array<{episode_id:string;reason:string}>; selection:Record<string,unknown>;
  revision:number; created_at:string;
}
export interface CollectionVersion {
  id:string; collection_id:string; created_at:string; schema_version:'1.0.0';
  collection:Collection; episodes:Episode[]; reviews:Review[]; sources:Source[];
  integrity:string; training_suitability:'unknown'; measured_training_benefit:'not evaluated';
}
export interface Job {
  id:string; kind:'preflight'|'import'|'export'|'preview'; status:'queued'|'running'|'completed'|'failed'|'cancelled';
  stage:string; progress:number; attempt:number; created_at:string; updated_at:string;
  error:string|null; payload:Record<string,unknown>; result:Record<string,unknown>|null;
}
