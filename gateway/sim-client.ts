import type { EvaluationResult, SceneConfig, WorldSnapshot } from '../contracts/index';
import { PolicySandbox, toVelocities, sourceHash } from './policy';
import { recordExperiment } from './recordings';
const base = process.env.SIM_URL || 'http://127.0.0.1:8001';
export async function sim<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Object.assign(new Error(`Simulation ${path}: ${response.status} ${(await response.text()).slice(0, 500)}`),{status:response.status});
  return response.json() as Promise<T>;
}
export async function evaluateSource(source: string, scene: SceneConfig, options: { checkpoint_id?: string; duration?: number; onStep?: (state: WorldSnapshot) => void; signal?: AbortSignal } = {}): Promise<EvaluationResult> {
  let sandbox: PolicySandbox | undefined;
  let branch: string | undefined;
  const frames: WorldSnapshot[] = [];
  const command_trace: NonNullable<EvaluationResult['command_trace']> = [];
  try {
    const fork = await sim<{ branch_id: string; state: WorldSnapshot }>('/fork', { ...(options.checkpoint_id ? { checkpoint_id: options.checkpoint_id } : { scene }), mode: 'external' });
    branch = fork.branch_id;
    sandbox = new PolicySandbox();
    let state = fork.state;
    let memory: Record<string, unknown> = {};
    const until = state.sim_time + (options.duration ?? 30);
    frames.push(state);
    while (state.sim_time < until && !state.robots.some(r => r.fallen) && !state.robots.every(r => r.goal_reached)) {
      options.signal?.throwIfAborted();
      const output = await sandbox.call(source, { scene, robots: state.robots, sim_time: state.sim_time, scene_epoch: state.scene_epoch, memory });
      command_trace.push({sim_time:state.sim_time,tick:state.tick,output:structuredClone(output)});
      memory = output.memory;
      state = await sim<WorldSnapshot>(`/branch/${branch}/step`, { commands: toVelocities(output.commands, state, scene), steps: 10 });
      frames.push(state); options.onStep?.(state);
    }
    const result = await sim<EvaluationResult>(`/branch/${branch}/result`);
    return { ...result, scene: structuredClone(scene), policy_hash: sourceHash(source), frames, command_trace };
  } catch(error) {
    await recordExperiment('evaluation_error',{source,source_hash:sourceHash(source),scene,checkpoint_id:options.checkpoint_id,frames,command_trace,error:(error as Error).message});
    throw error;
  } finally {
    await sandbox?.close();
    if (branch) await sim(`/branch/${branch}`, undefined, 'DELETE').catch(() => undefined);
  }
}
