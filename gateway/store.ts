import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { RepairArtifact } from '../contracts/index';
const root = path.resolve('runtime');
export const artifacts = new Map<string, RepairArtifact>();
export const budget = { limit: Number(process.env.ASTRA_BUDGET_USD || 80), spent: 0, reserved: 0, estimated: true };
export async function initializeStore() {
  await mkdir(root, { recursive: true });
  try { const old = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8')); budget.spent = old.spent || 0; for (const a of old.artifacts || []) artifacts.set(a.id, a); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
let writes = Promise.resolve();
export function saveStore() {
  writes = writes.then(async () => {
    const data = JSON.stringify({ spent: budget.spent, artifacts: [...artifacts.values()].map(a => ({ ...a, evaluation: a.evaluation ? { ...a.evaluation, frames: [] } : undefined })) }, null, 2);
    await writeFile(path.join(root, 'state.tmp'), data);
    await rename(path.join(root, 'state.tmp'), path.join(root, 'state.json'));
  });
  return writes;
}
export function reserveCall() {
  if (!Number.isFinite(budget.limit) || budget.spent + budget.reserved + 3 > budget.limit) throw new Error('API demo budget limit reached; no further model call made');
  budget.reserved += 3;
}
export async function settleCall(usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } }) {
  budget.reserved = Math.max(0, budget.reserved - 3);
  // Conservative token estimate; billing/tool/storage charges are not claimed exact.
  budget.spent += usage ? ((usage.input_tokens - (usage.input_tokens_details?.cached_tokens || 0)) * 10 + (usage.input_tokens_details?.cached_tokens || 0) + usage.output_tokens * 50) / 1e6 : 3;
  await saveStore();
}
