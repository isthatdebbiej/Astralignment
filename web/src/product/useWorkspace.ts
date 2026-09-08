import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayEvent, ModelDescription, RepairArtifact, TraceEvent, WorldSnapshot } from '../../../contracts/index';
import { errorMessage, request, socketUrl } from './api';
import { hydratedRepair, mergeGatewayEvents } from './workspaceConsistency';

export interface Health { status?: string; model?: string; api_key_present?: boolean; job?: string | null; astra_access?: { state: 'unchecked' | 'ready' | 'blocked'; message: string }; sim?: Record<string, unknown>; budget?: { limit: number; spent: number }; }
export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [model, setModel] = useState<ModelDescription | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [gatewayEvents, setGatewayEvents] = useState<GatewayEvent[]>([]);
  const [repair, setRepair] = useState<RepairArtifact | null>(null);
  const [history, setHistory] = useState<WorldSnapshot[]>([]);
  const [controller, setController] = useState<{ mode: string; language: string; source: string; provenance: unknown } | null>(null);
  const seenEvents = useRef(new Set<string>());
  const epoch = useRef<number | null>(null);
  const lastHistoryTime = useRef(-1);
  const lastReceived = useRef(0);
  const lastEpisode = useRef('');
  const repairRevision = useRef(0);
  const snapshotRevision = useRef(0);
  const hydrationSequence = useRef(0);
  const publishRepair = useCallback((next: RepairArtifact) => { repairRevision.current++; setRepair(next); }, []);
  const acceptModel = useCallback((next: ModelDescription) => {
    if (next.scene_epoch !== epoch.current || next.episode_id !== lastEpisode.current) return;
    setModel(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  const acceptSnapshot = useCallback((next: WorldSnapshot) => {
    if (!next || !Array.isArray(next.bodies) || typeof next.sim_time !== 'number') return;
    snapshotRevision.current++;
    lastReceived.current = Date.now();
    setConnected(true);
    setConnectionError('');
    setSnapshot(next);
    if (epoch.current !== next.scene_epoch || lastEpisode.current !== next.episode_id) {
      epoch.current = next.scene_epoch;
      lastEpisode.current = next.episode_id;
      setModel(previous => previous?.scene_epoch === next.scene_epoch && previous.episode_id === next.episode_id ? previous : null);
      lastHistoryTime.current = -1;
      setHistory([]);
      seenEvents.current.clear();
      setEvents([]);
      void request<ModelDescription>('/api/sim/model').then(acceptModel).catch(() => undefined);
    }
    if (Math.abs(next.sim_time - lastHistoryTime.current) >= 0.12 || lastHistoryTime.current < 0) {
      lastHistoryTime.current = next.sim_time;
      setHistory(previous => [...previous.slice(-599), next]);
    }
    const fresh = (next.events ?? []).filter(event => !seenEvents.current.has(event.id));
    for (const event of fresh) seenEvents.current.add(event.id);
    if (fresh.length) setEvents(previous => [...previous, ...fresh].slice(-200));
  }, [acceptModel]);
  const refresh = useCallback(async (options?: { hydrate?: boolean }) => {
    const revisionAtStart = repairRevision.current;
    const snapshotAtStart = snapshotRevision.current;
    const hydrationAtStart = options?.hydrate ? ++hydrationSequence.current : undefined;
    const results = await Promise.allSettled([request<Health>('/api/health'), request<ModelDescription>('/api/sim/model'), request<WorldSnapshot>('/api/sim/state')]);
    if (results[0].status === 'fulfilled') setHealth(results[0].value);
    if (snapshotAtStart === snapshotRevision.current) {
      if (results[2].status === 'fulfilled') acceptSnapshot(results[2].value);
      else { setConnectionError(errorMessage(results[2].reason)); setConnected(false); }
    }
    if (results[1].status === 'fulfilled') acceptModel(results[1].value);
    void request<{ mode: string; language: string; source: string; provenance: unknown }>('/api/controller').then(setController).catch(() => undefined);
    if (options?.hydrate) {
      const history = await Promise.allSettled([request<{ events: GatewayEvent[] }>('/api/events'), request<{ artifacts: RepairArtifact[] }>('/api/artifacts')]);
      if (history[0].status === 'fulfilled') { const incoming = history[0].value.events ?? []; setGatewayEvents(current => mergeGatewayEvents(current, incoming)); }
      if (history[1].status === 'fulfilled') { const incoming = history[1].value.artifacts?.[0]; setRepair(current => hydratedRepair(current, incoming, hydrationAtStart === hydrationSequence.current && revisionAtStart === repairRevision.current)); }
    }
  }, [acceptSnapshot, acceptModel]);
  useEffect(() => {
    let active = true;
    let stateSocket: WebSocket | null = null;
    let eventSocket: WebSocket | null = null;
    let stateRetry = 0;
    let eventRetry = 0;
    void refresh({ hydrate: true });
    const connectState = () => {
      if (!active) return;
      stateSocket = new WebSocket(socketUrl('/ws/state'));
      stateSocket.onmessage = event => {
        try { const data = JSON.parse(event.data); acceptSnapshot(data.type === 'state' ? data.data ?? data.state : data); }
        catch { setConnectionError('The simulation sent an unreadable state frame.'); }
      };
      stateSocket.onclose = () => { if (active) { setConnected(false); stateRetry = window.setTimeout(connectState, 3000); } };
      stateSocket.onerror = () => stateSocket?.close();
    };
    const connectEvents = () => {
      if (!active) return;
      eventSocket = new WebSocket(socketUrl('/ws/events'));
      eventSocket.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as GatewayEvent;
          setGatewayEvents(previous => mergeGatewayEvents(previous, [data]));
          if (data.type === 'repair' && data.data && typeof data.data === 'object' && 'source' in data.data) publishRepair(data.data as RepairArtifact);
        } catch { /* A malformed gateway message does not interrupt physics. */ }
      };
      eventSocket.onclose = () => { if (active) eventRetry = window.setTimeout(connectEvents, 3000); };
      eventSocket.onerror = () => eventSocket?.close();
    };
    connectState(); connectEvents();
    const poll = window.setInterval(() => {
      if (Date.now() - lastReceived.current > 5000) {
        const revision = snapshotRevision.current;
        void request<WorldSnapshot>('/api/sim/state').then(next => { if (revision === snapshotRevision.current) acceptSnapshot(next); }).catch(error => { if (revision === snapshotRevision.current) { setConnected(false); setConnectionError(errorMessage(error)); } });
      }
      void request<Health>('/api/health').then(setHealth).catch(() => undefined);
    }, 8000);
    return () => { active = false; clearTimeout(stateRetry); clearTimeout(eventRetry); clearInterval(poll); stateSocket?.close(); eventSocket?.close(); };
  }, [acceptSnapshot, refresh, publishRepair]);
  return { snapshot, model, health, connected, connectionError, events, gatewayEvents, repair, setRepair: publishRepair, history, refresh, acceptSnapshot, controller, currentEpoch: () => epoch.current ?? undefined, currentEpisode: () => lastEpisode.current };
}
