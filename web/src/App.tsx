import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, Circle, Code2, Cpu, ExternalLink, FileCode2, FlaskConical, Focus, GitBranch, History, KeyRound, Layers3, LoaderCircle, PanelLeftClose, Pause, Play, Radio, RotateCcw, Search, ShieldCheck, Shuffle, Smartphone, Sparkles, Terminal, TriangleAlert, Waypoints, X } from 'lucide-react';
import type { CameraCalibration, EvaluationResult, RepairArtifact, SceneConfig, SearchResult, WorldSnapshot } from '../../contracts/index';
import { CameraPanel } from './camera/CameraPanel';
import { SimulationStage } from './viewer/SimulationStage';
import { CameraOverlay } from './viewer/CameraOverlay';
import { errorMessage, request } from './product/api';
import { useWorkspace } from './product/useWorkspace';
import { evidenceMatches } from './product/workspaceConsistency';

type InspectorTab = 'source' | 'evidence' | 'trace';
type Task = 'baseline' | 'search' | 'repair' | 'heldout';
interface HeldoutResult { policy_hash: string; trials: number; passed: number; results: EvaluationResult[]; scope?: string; scene_epoch: number; origin_episode_id: string; }
interface BoundReplay { frames: WorldSnapshot[]; scene: SceneConfig | null; epoch: number; episodeId: string; sourceHash: string | null; }
const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const elapsed = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`;

function CodeView({ source }: { source: string }) {
  return <div className="code-view" aria-label="Controller source code">{source.split('\n').map((line, index) => <div className={`code-line ${/^\s*(#|\/\/)/.test(line) ? 'comment-line' : ''}`} key={index}><span className="line-number">{index + 1}</span><code>{line || ' '}</code></div>)}</div>;
}

function Metrics({ value }: { value: EvaluationResult['metrics'] | null }) {
  return <div className="evidence-metrics"><div><span>Closest approach</span><strong>{number(value?.min_separation)} <small>m</small></strong></div><div><span>Robot contact ticks</span><strong>{value?.robot_contacts ?? '—'}</strong></div><div><span>Keepout violation ticks</span><strong>{value?.keepout_violations ?? '—'}</strong></div><div><span>Falls</span><strong>{value?.falls ?? '—'}</strong></div><div><span>Goals reached</span><strong>{value ? `${value.goals_reached} / 2` : '—'}</strong></div><div><span>Episode time</span><strong>{number(value?.elapsed, 1)} <small>s</small></strong></div></div>;
}

export default function App() {
  const workspace = useWorkspace();
  const { snapshot, model, health, connected, repair, events, gatewayEvents, history } = workspace;
  const [tab, setTab] = useState<InspectorTab>('source');
  const [activeTask, setActiveTask] = useState<Task>('baseline');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraCalibration, setCameraCalibration] = useState<CameraCalibration | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [stageView, setStageView] = useState<'camera' | 'world'>('camera');
  const calibrated = Boolean(cameraCalibration);
  const cameraConnected = Boolean(cameraStream);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [mission, setMission] = useState('Both G1 robots must reach their assigned goals. Keep a safe distance, respect the presenter zone, and resolve right of way without deadlock.');
  const [missionEditing, setMissionEditing] = useState(false);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [heldoutData, setHeldout] = useState<HeldoutResult | null>(null);
  const [replayData, setReplayData] = useState<BoundReplay | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [scrubState, setScrubState] = useState<WorldSnapshot | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<'mission' | 'camera'>('camera');
  const [cancelling, setCancelling] = useState(false);
  const setupTrigger = useRef<HTMLElement | null>(null);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const setupDrawer = useRef<HTMLElement>(null);
  const inspectorClose = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const openSetup = (section: 'mission' | 'camera' = 'camera') => { setupTrigger.current = document.activeElement as HTMLElement; setSetupTab(section); setCameraOpen(true); };
  const closeSetup = () => { setCameraOpen(false); requestAnimationFrame(() => setupTrigger.current?.focus()); };
  const closeInspector = () => { setInspectorOpen(false); requestAnimationFrame(() => inspectorTrigger.current?.focus()); };
  const openInspector = (section: InspectorTab) => { inspectorTrigger.current = document.activeElement as HTMLElement; setTab(section); setInspectorOpen(true); };
  useEffect(() => { if (cameraOpen) requestAnimationFrame(() => setupDrawer.current?.querySelector<HTMLButtonElement>('[aria-label="Close setup"]')?.focus()); }, [cameraOpen]);
  useEffect(() => { if (inspectorOpen) requestAnimationFrame(() => inspectorClose.current?.focus()); }, [inspectorOpen]);
  useEffect(() => { if (replayData?.frames.length || scrubIndex != null) setTimelineOpen(true); }, [replayData, scrubIndex]);
  const [accessToken, setAccessToken] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const repairRef = useRef(repair);
  const previousSourceHash = useRef(repair?.source_hash);
  repairRef.current = repair;
  const replayMatches = evidenceMatches(replayData?.epoch, replayData?.sourceHash, snapshot?.scene_epoch, repair?.source_hash, replayData?.episodeId, snapshot?.episode_id);
  const replayFrames = replayMatches ? replayData!.frames : [];
  const heldout = evidenceMatches(heldoutData?.scene_epoch, heldoutData?.policy_hash, snapshot?.scene_epoch, repair?.source_hash, heldoutData?.origin_episode_id, snapshot?.episode_id) ? heldoutData : null;
  const acceptReplay = (evaluation: EvaluationResult, scene: SceneConfig | null, epoch: number, episodeId: string, sourceHash: string | null = null) => {
    if (!evidenceMatches(epoch, sourceHash, workspace.currentEpoch(), repairRef.current?.source_hash, episodeId, workspace.currentEpisode())) throw new Error('The scene or repair source changed while loading this replay. Load a current evaluation.');
    setReplayData({ frames: evaluation.frames, scene: evaluation.scene ?? scene, epoch, episodeId, sourceHash });
  };
  useEffect(() => {
    if (snapshot?.scene_epoch == null) return;
    if (previousSourceHash.current !== repair?.source_hash) { previousSourceHash.current = repair?.source_hash; setScrubState(null); setScrubIndex(null); }
    setReplayData(current => current && !evidenceMatches(current.epoch, current.sourceHash, snapshot.scene_epoch, repair?.source_hash, current.episodeId, snapshot.episode_id) ? null : current);
    setHeldout(current => current && !evidenceMatches(current.scene_epoch, current.policy_hash, snapshot.scene_epoch, repair?.source_hash, current.origin_episode_id, snapshot.episode_id) ? null : current);
    setSearch(current => current?.evaluation && !evidenceMatches(current.evaluation.scene_epoch, null, snapshot.scene_epoch, undefined, current.evaluation.episode_id, snapshot.episode_id) ? null : current);
    if (scrubState && (scrubState.scene_epoch !== snapshot.scene_epoch || scrubState.episode_id !== snapshot.episode_id)) { setScrubState(null); setScrubIndex(null); }
  }, [snapshot?.scene_epoch, snapshot?.episode_id, repair?.source_hash, scrubState]);

  const execute = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label); setError(''); setNotice('');
    try { await fn(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
  };
  const baseline = () => void execute('Running baseline', async () => {
    setReplayData(null); setScrubIndex(null); setActiveTask('baseline');
    if (snapshot && (snapshot.metrics.goals_reached === 2 || snapshot.metrics.falls > 0)) await request('/api/sim/reset', { expected_scene_epoch: snapshot.scene_epoch, expected_episode_id: snapshot.episode_id });
    await request('/api/sim/run', { mode: 'independent' });
    await workspace.refresh();
  });
  const pause = () => void execute('Pausing physics', async () => { await request('/api/sim/pause', {}); await workspace.refresh(); });
  const randomize = () => void execute('Spawning robots', async () => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
    await request('/api/sim/reset', { seed });
    setReplayData(null); setScrubIndex(null); setSearch(null); setHeldout(null); setActiveTask('baseline');
    await workspace.refresh();
    setNotice(`New scene initialized with seed ${seed}.`);
  });
  const findCounterexample = () => void execute('Searching counterexamples', async () => {
    setActiveTask('search'); openInspector('evidence'); setReplayData(null); setScrubIndex(null);
    const result = await request<SearchResult>('/api/search', { trials: 6, duration: 30 }, 240_000);
    setSearch(result); setNotice(result.message); await workspace.refresh();
    if (result.evaluation?.frames?.length) { acceptReplay(result.evaluation, result.scene, result.evaluation.scene_epoch, result.evaluation.episode_id); setReplayIndex(result.evaluation.frames.length - 1); setReplaying(false); }
  });
  const repairWithAstra = () => void execute('Astra is repairing', async () => {
    setActiveTask('repair'); openInspector('source');
    const result = await request<RepairArtifact>('/api/repair', { mission }, 240_000);
    workspace.setRepair(result); setTab('evidence');
    setNotice(result.status === 'passed' ? 'Repair passed its episode evaluation. Run held-out tests to check generalization.' : `Repair completed with status: ${result.status}. Inspect the evidence.`);
  });
  const runHeldout = () => void execute('Evaluating held-out scenes', async () => {
    if (!snapshot || !repair) throw new Error('Load a current repair before running held-out scenes.');
    const sourceHash = repair.source_hash; const sceneEpoch = snapshot.scene_epoch; const episodeId = snapshot.episode_id;
    setActiveTask('heldout'); openInspector('evidence');
    const result = await request<HeldoutResult>('/api/heldout', { repair_id: repair?.id, trials: 4 }, 240_000);
    if (!evidenceMatches(sceneEpoch, sourceHash, workspace.currentEpoch(), repairRef.current?.source_hash, episodeId, workspace.currentEpisode()) || result.policy_hash !== sourceHash) throw new Error('The scene or source changed; these held-out results no longer apply.');
    setHeldout({ ...result, scene_epoch: sceneEpoch, origin_episode_id: episodeId }); setNotice('Held-out evaluation completed. Results are available in Evidence.');
  });
  const replay = () => void execute('Loading replay', async () => {
    if (!snapshot || !repair) throw new Error('Load a current repair before replaying it.');
    const sceneEpoch = snapshot.scene_epoch; const sourceHash = repair.source_hash; const episodeId = snapshot.episode_id;
    const result = await request<EvaluationResult | { evaluation: EvaluationResult }>('/api/replay', { repair_id: repair?.id }, 240_000);
    const evaluation = 'evaluation' in result ? result.evaluation : result;
    if (!evaluation?.frames?.length) throw new Error('This evaluation has no replay frames. Run an evaluation first.');
    acceptReplay(evaluation, model?.scene ?? null, sceneEpoch, episodeId, sourceHash); setReplayIndex(0); setReplaying(true); setScrubIndex(null);
  });
  const reference = () => void execute('Starting reference from the scene origin', async () => {
    if (!snapshot) throw new Error('Load the current scene before running its reference controller.');
    setReplayData(null); setScrubIndex(null);
    await request('/api/sim/reset', { expected_scene_epoch: snapshot.scene_epoch, expected_episode_id: snapshot.episode_id });
    setSearch(null); setHeldout(null); setActiveTask('baseline'); setTab('evidence');
    await request('/api/sim/run', { mode: 'reservation' }); await workspace.refresh();
    setNotice('Reference reservation controller started from the initial scene with fresh metrics. This is an authored reference, not an Astra-generated repair.');
  });
  const playHeldout = (evaluation: EvaluationResult) => void execute('Loading held-out replay', async () => {
    if (!heldout) throw new Error('These held-out results no longer match the current source and scene.');
    if (!evaluation.scene) throw new Error('This held-out evaluation does not contain its recorded scene geometry. Rerun held-out evaluation before replay.');
    acceptReplay(evaluation, evaluation.scene ?? null, heldout.scene_epoch, heldout.origin_episode_id, heldout.policy_hash);
    setReplayIndex(0); setReplaying(true); setScrubIndex(null);
  });
  useEffect(() => {
    const completedSearch = [...gatewayEvents].reverse().find(event => event.type === 'search' && event.data && typeof event.data === 'object' && 'found' in event.data);
    if (completedSearch) { const result = completedSearch.data as SearchResult; if (evidenceMatches(result.evaluation?.scene_epoch, null, workspace.currentEpoch(), undefined, result.evaluation?.episode_id, workspace.currentEpisode())) setSearch(result); }
  }, [gatewayEvents]);
  useEffect(() => {
    if (!replaying || !replayFrames.length) return;
    const current = replayFrames[replayIndex];
    const next = replayFrames[replayIndex + 1];
    if (!next) { setReplaying(false); return; }
    const timer = window.setTimeout(() => setReplayIndex(index => index + 1), Math.max(16, Math.min(300, (next.sim_time - current.sim_time) * 1000)));
    return () => clearTimeout(timer);
  }, [replaying, replayFrames, replayIndex]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === 'Escape') {
        if (provenanceOpen) setProvenanceOpen(false);
        else if (cameraOpen) closeSetup();
        else if (moreOpen) { setMoreOpen(false); moreTrigger.current?.focus(); }
        else if (inspectorOpen) closeInspector();
        setMissionEditing(false); return;
      }
      if (cameraOpen) {
        if (event.key === 'Tab') {
          const controls = Array.from(setupDrawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href]') ?? []).filter(element => element.getClientRects().length && !element.closest('[inert]'));
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && target === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && target === last) { event.preventDefault(); first?.focus(); }
        }
        return;
      }
      if (provenanceOpen || authRequired) return;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === 'Space' && connected && !busy) { event.preventDefault(); if (replayFrames.length) setReplaying(value => !value); else if (snapshot?.paused) baseline(); else pause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const scrubMatches = scrubIndex != null && evidenceMatches(scrubState?.scene_epoch, null, snapshot?.scene_epoch, undefined, scrubState?.episode_id, snapshot?.episode_id);
  const displayState = replayFrames.length ? replayFrames[replayIndex] : scrubMatches ? scrubState : snapshot;
  const mode = replayFrames.length ? 'Recorded evaluation' : scrubMatches ? 'Recorded frame' : snapshot?.mode === 'reservation' ? 'Reference controller' : connected ? 'Live simulation' : 'Disconnected';
  const displayEvents = replayFrames.length || scrubMatches ? displayState?.events ?? [] : events;
  const renderModel = useMemo(() => {
    if (!model || model.scene_epoch !== snapshot?.scene_epoch || model.episode_id !== snapshot?.episode_id) return null;
    return replayMatches && replayData?.scene ? { ...model, scene: replayData.scene } : model;
  }, [model, snapshot?.scene_epoch, snapshot?.episode_id, replayMatches, replayData]);
  const selectedEvaluation = activeTask === 'search' ? evidenceMatches(search?.evaluation?.scene_epoch, null, snapshot?.scene_epoch, undefined, search?.evaluation?.episode_id, snapshot?.episode_id) ? search?.evaluation : null : activeTask === 'baseline' ? null : repair?.evaluation;
  const evidenceMetrics = selectedEvaluation?.metrics ?? displayState?.metrics ?? null;
  const timelineFrames = replayFrames.length ? replayFrames : history;
  const timelineMax = timelineFrames.at(-1)?.sim_time ?? 0;
  const timelineMin = timelineFrames[0]?.sim_time ?? 0;
  const separationPoints = useMemo(() => {
    const valid = timelineFrames.map((frame, i) => ({ value: frame.metrics?.min_separation, i })).filter(item => item.value != null && Number.isFinite(item.value));
    const max = Math.max(2, ...valid.map(item => item.value!));
    return valid.map(item => `${(item.i / Math.max(1, timelineFrames.length - 1)) * 1000},${39 - (item.value! / max) * 32}`).join(' ');
  }, [timelineFrames]);
  const locked = Boolean(busy) || !connected;
  const validCounterexample = Boolean(search?.found && evidenceMatches(search.evaluation?.scene_epoch, null, snapshot?.scene_epoch, undefined, search.evaluation?.episode_id, snapshot?.episode_id));
  const canRepair = Boolean(health?.api_key_present) && health?.astra_access?.state !== 'blocked' && validCounterexample && connected && !busy;
  const staleRepair = Boolean(repair && snapshot && !evidenceMatches(repair.scene_epoch, repair.source_hash, snapshot.scene_epoch, repair.source_hash, repair.origin_episode_id, snapshot.episode_id));
  const authRequired = /operator access required/i.test(workspace.connectionError);
  const showBaselineSource = Boolean(workspace.controller?.source) && (!repair?.source || activeTask === 'baseline');
  const unlock = async () => {
    setUnlocking(true); setUnlockError('');
    try { await request('/api/auth', { token: accessToken }); setAccessToken(''); await workspace.refresh({ hydrate: true }); }
    catch (cause) { setUnlockError(errorMessage(cause)); }
    finally { setUnlocking(false); }
  };

  const cancelTask = async () => {
    if (cancelling) return;
    setCancelling(true);
    try { await request('/api/cancel', {}); setNotice('Cancellation requested. Waiting for the active task to stop.'); await workspace.refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setCancelling(false); }
  };
  const pauseNow = async () => {
    try { await request('/api/sim/pause', {}); await workspace.refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
  };
  const hasCurrentRepair = Boolean(repair && !staleRepair);
  return <div className="app-shell clean-workspace">
    <header className="workspace-nav">
      <a className="wordmark" href="/" aria-label="Astralignment home"><span className="brand-symbol"><GitBranch size={18}/></span>astra<span>lignment</span></a>
      <span className="nav-divider"/>
      <nav className="view-switch" aria-label="Viewport"><button className={stageView === 'camera' ? 'active' : ''} aria-pressed={stageView === 'camera'} onClick={() => setStageView('camera')}><Radio size={14}/>Camera overlay</button><button className={stageView === 'world' ? 'active' : ''} aria-pressed={stageView === 'world'} onClick={() => setStageView('world')}><Layers3 size={14}/>World</button></nav>
      <div className="workspace-nav-actions">
        <button className={cameraOpen ? 'nav-button active' : 'nav-button'} aria-expanded={cameraOpen} aria-controls="setup-drawer" onClick={() => cameraOpen ? closeSetup() : openSetup('mission')}><Focus size={14}/>Setup</button>
        <span className="nav-divider"/>
        {([{ id: 'source', label: 'Code', icon: Code2 }, { id: 'evidence', label: 'Evidence', icon: ShieldCheck }, { id: 'trace', label: 'Trace', icon: Terminal }] as const).map(item => <button key={item.id} className={inspectorOpen && tab === item.id ? 'nav-button active' : 'nav-button'} aria-expanded={inspectorOpen && tab === item.id} aria-controls="workspace-inspector" onClick={() => inspectorOpen && tab === item.id ? closeInspector() : openInspector(item.id)}><item.icon size={14}/>{item.label}</button>)}
        <button className="runtime-link" aria-label="Sources and runtime" onClick={() => setProvenanceOpen(true)}><Cpu size={13}/><span>{health?.model ?? 'gpt-6-astra'}</span></button>
      </div>
    </header>
    <main className={`workspace-grid ${inspectorOpen ? 'inspector-visible' : ''}`}>
      <section className="simulation-column">
      <div className="stage-container">{stageView === 'camera' ? <CameraOverlay stream={cameraStream} calibration={cameraCalibration} model={renderModel} state={displayState ?? null} connected={connected} mode={mode} onConnect={() => openSetup()} onWorld={() => setStageView('world')}/> : <SimulationStage model={renderModel} state={displayState ?? null} connected={connected} mode={mode}/>}</div>
      <div className="simulation-actions">
        <div className="primary-controls">
          <button className="button primary" disabled={!connected || Boolean(busy) && snapshot?.paused !== false} onClick={snapshot?.paused !== false || replayFrames.length ? baseline : () => void pauseNow()}>{snapshot?.paused !== false || replayFrames.length ? <Play size={14} fill="currentColor"/> : <Pause size={14}/>}<span>{snapshot?.paused !== false || replayFrames.length ? 'Run baseline' : 'Pause'}</span><kbd aria-hidden="true">␣</kbd></button>
          {busy ? <><span className="action-progress"><LoaderCircle size={13} className="spinning"/>{busy}…</span><button className="button cancel-button" disabled={cancelling} onClick={() => void cancelTask()}>{cancelling ? 'Cancelling…' : 'Cancel task'}</button></> : hasCurrentRepair ? <button className="button next-action" disabled={locked} onClick={runHeldout}><FlaskConical size={14}/>Test held-out</button> : validCounterexample ? <button className="button next-action" disabled={!canRepair} onClick={repairWithAstra}><Sparkles size={14}/>Repair with Astra</button> : <button className="button next-action" disabled={locked} onClick={findCounterexample}><Search size={14}/>Find counterexample</button>}
          <div className="action-menu"><button ref={moreTrigger} className="icon-button" aria-label="More scene actions" aria-expanded={moreOpen} aria-controls="scene-action-menu" onClick={() => setMoreOpen(value => !value)}><ChevronDown size={16}/></button>{moreOpen && <div id="scene-action-menu" className="scene-action-menu"><button disabled={locked} onClick={() => { setMoreOpen(false); randomize(); }}><Shuffle size={14}/>Randomize spawn</button><button disabled={locked || !model} aria-label="Run reference from scene start" onClick={() => { setMoreOpen(false); reference(); }}><RotateCcw size={14}/>Reference from scene start</button>{hasCurrentRepair && <button disabled={locked} onClick={() => { setMoreOpen(false); replay(); }}><Play size={14}/>Replay repair</button>}<button onClick={() => { setMoreOpen(false); openSetup('mission'); }}><Focus size={14}/>Edit mission</button></div>}</div>
        </div>
        <div className="playback-controls">
          <span className={`connection-state ${connected ? 'online' : ''}`}><span className="status-dot"/>{connected ? snapshot?.paused ? 'Paused' : 'Running' : 'Offline'}</span>
          <code className="action-clock">{displayState ? elapsed(displayState.sim_time) : '00:00.0'}</code>
          <button className={`timeline-toggle ${timelineOpen ? 'active' : ''}`} aria-label="Timeline" aria-expanded={timelineOpen} aria-controls="simulation-timeline" onClick={() => setTimelineOpen(value => !value)}><History size={14}/>Timeline{replayFrames.length > 0 && <span className="recorded-indicator"/>}<ChevronDown size={12}/></button>
        </div>
      </div>
      <section id="simulation-timeline" className="timeline-panel" hidden={!timelineOpen}><div className="timeline-heading"><div><Activity size={13}/><strong>Correlated timeline</strong><span>{timelineFrames.length ? `${timelineFrames.length} captured frames` : 'Awaiting first episode'}</span></div><div><button className={`timeline-live ${!replayFrames.length && scrubIndex == null ? 'active' : ''}`} onClick={() => { setReplayData(null); setScrubIndex(null); setReplaying(false); }}><span className="status-dot"/>LIVE</button><button className="icon-button" aria-label={replaying ? 'Pause replay' : 'Play replay'} disabled={!replayFrames.length} onClick={() => setReplaying(value => !value)}>{replaying ? <Pause size={13}/> : <Play size={13}/>}</button></div></div><div className="timeline-ruler"><span>{elapsed(timelineMin)}</span><span>{elapsed(timelineMin + (timelineMax - timelineMin) / 2)}</span><span>{elapsed(timelineMax)}</span></div><div className="timeline-track"><span className="track-label">min. dist.</span><div className="chart-area"><svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-label="Running minimum robot separation"><line x1="0" y1="40" x2="1000" y2="40" stroke="currentColor" strokeDasharray="3 6"/>{separationPoints && <polyline points={separationPoints} fill="none" stroke="#a3c9bf" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>}</svg><input aria-label="Inspect captured simulation frame" type="range" min="0" max={Math.max(0, timelineFrames.length - 1)} value={replayFrames.length ? replayIndex : scrubIndex ?? Math.max(0, history.length - 1)} disabled={!timelineFrames.length} onChange={event => { const value = Number(event.target.value); if (replayFrames.length) { setReplayIndex(value); setReplaying(false); } else { setScrubIndex(value); setScrubState(history[value] ?? null); } }}/></div></div><div className="timeline-event"><span className="track-label">events</span>{displayEvents.length ? <div className="last-event"><span className={`event-point ${displayEvents.at(-1)?.severity}`}/><code>{elapsed(displayEvents.at(-1)!.sim_time)}</code><span>{displayEvents.at(-1)?.message}</span></div> : <span className="timeline-empty">Physics events will appear here as the episode runs.</span>}</div></section>
      </section>
      <aside id="workspace-inspector" className="inspector" aria-label="Workspace inspector" hidden={!inspectorOpen} inert={!inspectorOpen}><div className="inspector-heading"><strong>{tab === 'source' ? 'Controller code' : tab === 'evidence' ? 'Evaluation evidence' : 'Runtime trace'}</strong><button ref={inspectorClose} className="icon-button" aria-label="Close inspector" onClick={closeInspector}><X size={16}/></button></div>
      <div className="inspector-content">{tab === 'source' && <><div className="file-heading"><FileCode2 size={14}/><span>{showBaselineSource ? 'baseline.py' : repair ? 'coordination_repair.js' : 'coordination.js'}</span>{repair && !showBaselineSource && <span className="file-modified">GENERATED</span>}</div>{showBaselineSource ? <><div className="source-provenance"><Code2 size={12}/><span>Built-in baseline · not generated by Astra</span></div><CodeView source={workspace.controller!.source}/></> : repair?.source ? <><div className="artifact-meta"><GitBranch size={12}/><code>{repair.source_hash?.slice(0, 12) ?? repair.id}</code><span className={`artifact-status ${repair.status}`}>{repair.status}</span></div>{staleRepair && <div className="stale-artifact"><TriangleAlert size={13}/><span>This artifact belongs to a different or unverified world instance. Capture a new counterexample.</span></div>}<div className="source-provenance"><ShieldCheck size={12}/><span>{repair.status === 'passed' || repair.status === 'failed' ? 'Source hash frozen for replay and held-out tests' : 'Candidate source under evaluation'}</span></div><CodeView source={repair.source}/>{repair.explanation && <div className="repair-explanation"><Sparkles size={13}/><p>{repair.explanation}</p></div>}</> : <div className="empty-code"><div className="empty-code-symbol"><GitBranch size={31} strokeWidth={1.25}/></div><h2>A failure is a starting point.</h2><p>Capture a counterexample. Astra will inspect the episode and write a coordination repair you can review and replay.</p><div className="empty-code-flow"><span>Observe</span><ArrowRight size={11}/><span>Fork</span><ArrowRight size={11}/><span>Verify</span></div><div className="code-placeholder"><div><span>01</span><i style={{ width: '61%' }}/></div><div><span>02</span><i style={{ width: '78%' }}/></div><div><span>03</span><i style={{ width: '46%' }}/></div><div><span>04</span><i style={{ width: '66%' }}/></div></div><span className="empty-note">No generated patch yet</span></div>}</>}
      {tab === 'evidence' && <><div className="evidence-scope"><label htmlFor="evidence-scope">Show</label><select id="evidence-scope" value={activeTask} onChange={event => setActiveTask(event.target.value as Task)}><option value="baseline">Current episode</option>{search && <option value="search">Counterexample</option>}{repair && <option value="repair">Repair evaluation</option>}{heldout && <option value="heldout">Held-out results</option>}</select></div>{staleRepair && activeTask !== "baseline" && activeTask !== "search" && <div className="stale-artifact"><TriangleAlert size={13}/><span>This evidence does not match the current world identity. Its verdict cannot be reused here.</span></div>}<div className="evidence-heading"><span className="section-eyebrow">INDEPENDENT EVALUATOR</span><h2>{selectedEvaluation ? selectedEvaluation.passed ? 'Episode passed' : 'Failure captured' : 'Evidence, before confidence.'}</h2><p>{selectedEvaluation?.reason ?? 'Run an episode to measure coordination against the same independent checks.'}</p></div>{selectedEvaluation && <div className={`evaluation-verdict ${selectedEvaluation.passed ? 'passed' : 'failed'}`}>{selectedEvaluation.passed ? <CheckCheck size={16}/> : <TriangleAlert size={16}/>}<span>{selectedEvaluation.passed ? 'PASS' : 'FAIL'}</span><code>seed {selectedEvaluation.seed}</code></div>}<Metrics value={evidenceMetrics}/>{search && activeTask === 'search' && <div className="evidence-note"><Search size={14}/><p>{search.message}<br/><strong>{search.trials} trials evaluated</strong></p></div>}{repair?.test_output && <div className="test-output"><div><Terminal size={12}/> SANDBOX OUTPUT</div><pre>{repair.test_output}</pre></div>}{heldout && <div className="heldout-results"><div className="heldout-summary"><ShieldCheck size={15}/><strong>{heldout.passed} / {heldout.trials} passed</strong><span>HELD-OUT</span></div><code className="heldout-hash">frozen · {heldout.policy_hash.slice(0, 16)}</code>{heldout.results.map((result, index) => <div className="heldout-trial" key={`${result.seed}-${index}`}><div><span className={result.passed ? "trial-pass" : "trial-fail"}>{result.passed ? "PASS" : "FAIL"}</span><code>seed {result.seed}</code><button disabled={!result.frames.length} onClick={() => playHeldout(result)}><Play size={11}/>Replay</button></div><p>{result.reason}</p><span>{result.metrics.goals_reached}/2 goals · {result.metrics.robot_contacts} contact ticks · {result.metrics.falls} falls</span></div>)}{heldout.scope && <p className="heldout-scope">{heldout.scope}</p>}</div>}<div className="evidence-footnote"><ShieldCheck size={13}/><span>Evaluation checks are independent of generated coordination code.</span></div></>}
      {tab === 'trace' && <div className="trace-list">{gatewayEvents.length ? gatewayEvents.map((event, index) => <div className={`trace-entry ${event.type}`} key={`${event.at}-${index}`}><div><span>{event.type.toUpperCase()}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div><p>{event.message}</p></div>) : <div className="trace-empty"><Terminal size={26}/><strong>Listening for runtime events</strong><p>Search, generation, evaluation, and service errors are recorded here.</p></div>}</div>}
      </div><div className="astra-composer" hidden={tab === 'trace'}>{busy && <div className="busy-state"><LoaderCircle className="spinning" size={14}/><span>{busy}…</span></div>}{health?.astra_access?.state === "blocked" && <div className="astra-access-blocked"><TriangleAlert size={13}/><div><strong>Astra access blocked</strong><p>{health.astra_access.message}</p><button disabled={Boolean(busy)} onClick={() => void execute("Checking Astra access", async () => { try { await request("/api/probe", {}, 240_000); } finally { await workspace.refresh(); } })}><RotateCcw size={11}/>Recheck Astra</button></div></div>}<div className="composer-context"><span><Circle size={8} fill="currentColor"/> {snapshot ? `Scene ${snapshot.scene_epoch}` : 'No scene'}</span><span><History size={11}/>{events.length} events attached</span></div><button className="button astra-button" disabled={!canRepair} onClick={repairWithAstra}><Sparkles size={16}/><span>Repair with Astra</span><ArrowRight size={15}/></button>{health?.api_key_present !== false && health?.astra_access?.state !== "blocked" && !validCounterexample && <span className="key-note">Capture a counterexample before generating a repair.</span>}{health?.api_key_present === false && <span className="key-note">Add an OpenAI API key to enable Astra.</span>}<div className="repair-actions"><button disabled={!repair || staleRepair || Boolean(busy)} onClick={replay}><Play size={12}/>Replay repair</button><button disabled={!repair || staleRepair || locked} onClick={runHeldout}><FlaskConical size={12}/>Test held-out</button></div></div></aside>
    </main>
    {(error || notice || workspace.connectionError) && <div className={`toast ${error || workspace.connectionError && !connected ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <TriangleAlert size={16}/> : notice ? <Check size={16}/> : <Radio size={16}/>}<span>{error || notice || workspace.connectionError}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); if (!connected) void workspace.refresh(); }}><X size={13}/></button></div>}
    <div className={`camera-modal-layer setup-layer ${cameraOpen ? 'open' : ''}`} inert={!cameraOpen} aria-hidden={!cameraOpen}><div className="modal-backdrop" onClick={closeSetup}/><section ref={setupDrawer} id="setup-drawer" className="camera-modal setup-drawer" role="dialog" aria-modal="true" aria-label="Scene setup"><div className="modal-heading"><div><Focus size={17}/><h2>Scene setup</h2></div><button className="icon-button" aria-label="Close setup" onClick={closeSetup}><X size={18}/></button></div>
      <div className="setup-tabs" role="tablist" aria-label="Setup sections"><button role="tab" aria-selected={setupTab === 'mission'} onClick={() => setSetupTab('mission')}>Mission</button><button role="tab" aria-selected={setupTab === 'camera'} onClick={() => setSetupTab('camera')}>Camera</button></div>
      <section className="setup-mission" hidden={setupTab !== 'mission'}><span className="section-eyebrow">CROSSING PATHS</span><h3>Two agents. One shared world.</h3><label htmlFor="coordination-mission">Coordination mission</label><textarea id="coordination-mission" value={mission} onChange={event => setMission(event.target.value)}/><p>Astra receives this mission with the captured counterexample. Editing it does not change the physics or existing evidence.</p><dl><dt>Robots</dt><dd>2 × Unitree G1</dd><dt>Measured floor</dt><dd>{model ? `${model.scene.width} × ${model.scene.depth} m` : 'Awaiting model'}</dd><dt>Scene seed</dt><dd>{model?.scene.seed ?? '—'}</dd><dt>Controller</dt><dd>{snapshot?.mode ?? '—'}</dd></dl><button className="button" onClick={() => setSetupTab('camera')}><Smartphone size={14}/>{cameraConnected ? 'Manage camera & calibration' : 'Connect phone'}<ArrowRight size={14}/></button></section>
      <div hidden={setupTab !== 'camera'} inert={setupTab !== 'camera'}><CameraPanel onVideoReady={video => { const stream = video?.srcObject instanceof MediaStream ? video.srcObject : null; setCameraStream(stream); if (stream) setStageView('camera'); }} onCalibration={value => setCameraCalibration({ width: value.widthMeters, depth: value.depthMeters, corners: value.corners, captured_at: value.capturedAt, frame_width: value.imageWidth, frame_height: value.imageHeight })}/></div>
      {cameraConnected && setupTab === 'camera' && <div className="camera-modal-footer"><span>{calibrated ? 'Keep the camera fixed.' : 'Measure the floor to align the robots.'}</span><button className="button primary" onClick={() => { setStageView('camera'); closeSetup(); }}>View camera overlay<ArrowRight size={14}/></button></div>}
    </section></div>
    {provenanceOpen && <div className="modal-layer"><div className="modal-backdrop" onClick={() => setProvenanceOpen(false)}/><section className="provenance-modal" role="dialog" aria-modal="true" aria-label="Sources and runtime"><div className="modal-heading"><div><Layers3 size={18}/><h2>Sources & runtime</h2></div><button className="icon-button" aria-label="Close runtime details" onClick={() => setProvenanceOpen(false)}><X size={18}/></button></div><p>Every rendered robot pose comes from the simulation. Recorded frames and the authored reference controller are labeled in the viewport.</p><dl><dt>Repair model</dt><dd>{health?.model ?? 'gpt-6-astra'}</dd><dt>Physics</dt><dd>MuJoCo · shared authoritative clock</dd><dt>Coordinate system</dt><dd>Meters · right-handed · Z up</dd><dt>Robots</dt><dd>2 × Unitree G1</dd><dt>Camera</dt><dd>{cameraConnected ? 'Live stream connected' : 'Not connected'} · {calibrated ? 'calibration saved' : 'uncalibrated'}</dd></dl>{model?.provenance && <pre>{JSON.stringify(model.provenance, null, 2)}</pre>}<button className="button" onClick={() => { void workspace.refresh(); setProvenanceOpen(false); }}><RotateCcw size={14}/>Refresh services</button></section></div>}
    {authRequired && <div className="modal-layer"><div className="modal-backdrop"/><form className="unlock-modal" onSubmit={event => { event.preventDefault(); void unlock(); }} role="dialog" aria-modal="true" aria-label="Unlock operator workspace"><span className="unlock-icon"><KeyRound size={25}/></span><h2>Open your workspace</h2><p>Enter the deployment access token to connect to the simulation and Astra.</p><label htmlFor="access-token">Access token</label><input id="access-token" type="password" autoComplete="current-password" autoFocus value={accessToken} onChange={event => setAccessToken(event.target.value)}/>{unlockError && <p className="unlock-error" role="alert">{unlockError}</p>}<button className="button astra-button" type="submit" disabled={!accessToken || unlocking}>{unlocking ? <LoaderCircle size={15} className="spinning"/> : <KeyRound size={15}/>}<span>{unlocking ? 'Connecting…' : 'Unlock workspace'}</span><ArrowRight size={15}/></button></form></div>}
  </div>;
}
