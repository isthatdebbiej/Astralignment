import type { GatewayEvent, RepairArtifact } from '../../../contracts/index';

export function evidenceMatches(epoch: number | null | undefined, sourceHash: string | null | undefined, currentEpoch: number | undefined, currentSourceHash: string | undefined, originEpisodeId: string | undefined, currentEpisodeId: string | undefined): boolean {
  return epoch != null && epoch === currentEpoch && Boolean(originEpisodeId) && originEpisodeId === currentEpisodeId && (!sourceHash || sourceHash === currentSourceHash);
}

export function mergeGatewayEvents(current: GatewayEvent[], incoming: GatewayEvent[]): GatewayEvent[] {
  const merged = new Map<string, GatewayEvent>();
  for (const event of [...incoming, ...current]) merged.set(JSON.stringify([event.at, event.type, event.message]), event);
  return [...merged.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-100);
}

export function hydratedRepair(current: RepairArtifact | null, incoming: RepairArtifact | undefined, revisionUnchanged: boolean): RepairArtifact | null {
  if (!incoming || !revisionUnchanged) return current;
  if (current && Date.parse(current.created_at) > Date.parse(incoming.created_at)) return current;
  return incoming;
}
