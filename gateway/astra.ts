import OpenAI from 'openai';
import type { FunctionTool, ResponseInput } from 'openai/resources/responses/responses';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EvaluationResult, GatewayEvent, RepairArtifact, SceneConfig } from '../contracts/index';
import { POLICY_CONTRACT, PolicySandbox, sourceHash } from './policy';
import { evaluateSource, sim } from './sim-client';
import { artifacts, budget, reserveCall, settleCall, saveStore } from './store';

export const MODEL = 'gpt-6-astra';
export const astraAccess: {state:'unchecked'|'ready'|'blocked';message:string} = {state:'unchecked',message:'API key present is not proof of funded model access. Use the access check.'};
function rejectedUsage(error: unknown) {
  const status=(error as {status?:number})?.status;
  return status && [400,401,403,404,429].includes(status) ? {input_tokens:0,output_tokens:0} : undefined;
}
export interface FailureContext { scene: SceneConfig; checkpoint_id: string; scene_epoch: number; episode_id: string; evaluation: EvaluationResult }
export type Emit = (event: Omit<GatewayEvent, 'at'>) => void;
const candidateSchema = z.object({ source: z.string().min(30).max(40000), explanation: z.string().max(5000) }).strict();
const candidateParameters = { type: 'object', properties: { source: { type: 'string', description: 'Complete executable plain JavaScript defining function coordinate(input)' }, explanation: { type: 'string', description: 'Explain the concrete causal fix and limitations' } }, required: ['source', 'explanation'], additionalProperties: false };
const tools: FunctionTool[] = [
  { type: 'function', name: 'inspect_failure', description: 'Inspect measured failed branch, scene and trajectory at closest approach.', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] }, strict: true },
  { type: 'function', name: 'test_controller', description: 'Run your complete executable candidate in an isolated WASM runtime against real two-G1 MuJoCo physics, from the exact frozen checkpoint. Maximum 3 tests. Cannot alter evaluator.', parameters: candidateParameters, strict: true },
  { type: 'function', name: 'submit_controller', description: 'Submit the final executable candidate; independent evaluation will run before any passing status is shown.', parameters: candidateParameters, strict: true },
];
export function compactEvaluation(result: EvaluationResult) {
  const closest = [...result.frames].sort((a,b) => {
    const d = (s: typeof a) => s.robots.length === 2 ? Math.hypot(s.robots[0].position[0]-s.robots[1].position[0],s.robots[0].position[1]-s.robots[1].position[1]) : Infinity;
    return d(a)-d(b);
  })[0];
  return { passed: result.passed, reason: result.reason, metrics: result.metrics, events: result.events.slice(-20), closest: closest ? {sim_time:closest.sim_time,robots:closest.robots} : null, final: result.frames.at(-1)?.robots };
}
export async function repairFailure(context: FailureContext, mission: string, emit: Emit, signal: AbortSignal): Promise<RepairArtifact> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing on the gateway. No substitute model or mock repair is used.');
  if (process.env.ASTRA_MODEL && process.env.ASTRA_MODEL !== MODEL) throw new Error(`This demo requires ${MODEL}; configured model differs.`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 180000 });
  const artifact: RepairArtifact = { id: randomUUID(), model: MODEL, created_at: new Date().toISOString(), scene_epoch: context.scene_epoch, origin_episode_id: context.episode_id, status: 'generating', source: '', source_hash: '', explanation: '', test_output: '' };
  artifacts.set(artifact.id, artifact);
  const spentBefore = budget.spent;
  const input: ResponseInput = [
    { role: 'developer', content: `You are the runtime coordination engineer in Astralignment. Repair a demonstrated physical coordination failure. Use inspect_failure, write real executable source, test it, and submit_controller. The independent-controller baseline is intentionally a baseline, not evidence Astra itself was misaligned. Do not edit evaluation rules, invent successful tests, stop both robots forever, or claim general alignment. A human can change the stage; validity belongs to one scene epoch. ${POLICY_CONTRACT}` },
    { role: 'user', content: JSON.stringify({ mission: mission.slice(0,1000), scene: context.scene, observed_failure: compactEvaluation(context.evaluation), constraint: 'Preserve presenter access while both robots complete. The source hash will be frozen before unseen seeded spawn tests.' }) },
  ];
  let testCount = 0;
  const tested = new Map<string, EvaluationResult>();
  try {
    for (let turn=0; turn<6; turn++) {
      signal.throwIfAborted();
      await reserveCall();
      let response;
      try {
        response = await client.responses.create({ model: MODEL, input, tools, tool_choice: 'required', parallel_tool_calls: false, reasoning: { effort: 'high' }, max_output_tokens: 12000, store: false, include:['reasoning.encrypted_content'] }, { signal });
      } catch (error) { await settleCall(rejectedUsage(error));astraAccess.state='blocked';astraAccess.message=(error as Error).message;throw error; }
      await settleCall(response.usage);
      astraAccess.state='ready';astraAccess.message='The configured Astra API completed a real request.';
      input.push(...response.output.filter(item => item.type === 'function_call' || item.type === 'reasoning' || item.type === 'message'));
      let called = false;
      for (const item of response.output) {
        if (item.type !== 'function_call') continue;
        called = true;
        let output: unknown;
        if (item.name === 'inspect_failure') {
          output = { scene: context.scene, scene_epoch: context.scene_epoch, ...compactEvaluation(context.evaluation) };
          emit({ type: 'status', message: 'Astra inspected the measured counterexample and closest-approach state.' });
        } else if (item.name === 'test_controller' || item.name === 'submit_controller') {
          const candidate = candidateSchema.parse(JSON.parse(item.arguments));
          const hash = sourceHash(candidate.source);
          artifact.source = candidate.source; artifact.source_hash = hash; artifact.explanation = candidate.explanation; artifact.status = 'testing';
          emit({ type: 'repair', message: 'Executable coordination source received. Testing against the frozen physics checkpoint.', data: artifact });
          let evaluation = tested.get(hash);
          if (!evaluation) {
            if (testCount >= 3) {
              output = { error: 'Three-test budget exhausted. Submit a previously tested source unchanged.' };
              input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) });
              continue;
            }
            testCount++;
            try {
              evaluation = await evaluateSource(candidate.source, context.scene, { checkpoint_id: context.checkpoint_id, duration: 30, signal });
              tested.set(hash, evaluation);
              artifact.test_output = JSON.stringify({ test: testCount, source_hash: hash, ...compactEvaluation(evaluation) }, null, 2);
              output = compactEvaluation(evaluation);
            } catch (error) {
              output = { error: String((error as Error).message).slice(0,1500), test: testCount };
              artifact.test_output = JSON.stringify(output, null, 2);
            }
          } else output = compactEvaluation(evaluation);
          artifact.evaluation = evaluation;
          emit({ type: 'repair', message: evaluation?.passed ? 'Candidate passed this measured scene. Generalization is not yet tested.' : 'Candidate did not pass; returning actual evaluator feedback to Astra.', data: artifact });
          if (item.name === 'submit_controller') {
            const live = await sim<{scene_epoch:number,episode_id:string}>('/state');
            if (live.scene_epoch !== context.scene_epoch || live.episode_id !== context.episode_id) throw new Error('Scene changed during repair; result is stale and cannot be promoted.');
            artifact.status = evaluation?.passed ? 'passed' : 'failed';
            artifact.usage_usd = budget.spent-spentBefore;
            await saveStore();
            emit({ type: 'repair', message: artifact.status === 'passed' ? 'Source hash frozen. Ready for replay and held-out scene tests.' : 'Repair submitted but did not pass the independent evaluator.', data: artifact });
            return artifact;
          }
        } else output = { error: 'Unknown tool' };
        input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) });
      }
      if (!called) throw new Error('Astra returned no executable tool call. No mock repair was substituted.');
    }
    throw new Error('Astra repair reached its bounded six-turn budget without a submitted controller.');
  } catch (error) {
    artifact.status = 'error'; artifact.test_output += `\n${(error as Error).message}`; artifact.usage_usd = budget.spent-spentBefore;
    await saveStore(); emit({ type: 'repair', message: (error as Error).message, data: artifact });
    throw error;
  }
}

export async function probeAstra(): Promise<{ok: boolean; model: string; message: string}> {
  if (!process.env.OPENAI_API_KEY) return {ok:false,model:MODEL,message:'Server API key is absent'};
  await reserveCall();
  let response;
  try {
    const client = new OpenAI({maxRetries:0,timeout:30000});
    response = await client.responses.create({model:MODEL,input:'Reply with OK only.',reasoning:{effort:'low'},max_output_tokens:64,store:false});
  } catch (error) { await settleCall(rejectedUsage(error));astraAccess.state='blocked';astraAccess.message=(error as Error).message;throw error; }
  await settleCall(response.usage);
  astraAccess.state=response.status==='completed'?'ready':'blocked';astraAccess.message=response.output_text.slice(0,100)||String(response.status);
  return {ok:response.status === 'completed',model:response.model,message:astraAccess.message};
}
