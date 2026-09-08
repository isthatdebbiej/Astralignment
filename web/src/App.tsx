import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, Circle, Code2, Cpu, ExternalLink, FileCode2, FlaskConical, Focus, GitBranch, History, KeyRound, Layers3, LoaderCircle, PanelLeftClose, Pause, Play, Radio, RotateCcw, Search, ShieldCheck, Shuffle, Smartphone, Sparkles, Terminal, TriangleAlert, Waypoints, X } from 'lucide-react';
import type { EvaluationResult, RepairArtifact, SearchResult, WorldSnapshot } from '../../contracts/index';
import { CameraPanel } from './camera/CameraPanel';
import { SimulationStage } from './viewer/SimulationStage';
import { errorMessage, request } from './product/api';
import { useWorkspace } from './product/useWorkspace';

type InspectorTab = 'source' | 'evidence' | 'trace';
type Task = 'baseline' | 'search' | 'repair' | 'heldout';
interface HeldoutResult { policy_hash: string; trials: number; passed: number; results: EvaluationResult[]; scope?: string; }
const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
const elapsed = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`;

function CodeView({ source }: { source: string }) {
  return <div className="code-view" aria-label="Controller source code">{source.split('\n').map((line, index) => <div className={`code-line ${/^\s*(#|\/\/)/.test(line) ? 'comment-line' : ''}`} key={index}><span className="line-number">{index + 1}</span><code>{line || ' '}</code></div>)}</div>;
}

function Metrics({ value }: { value: EvaluationResult['metrics'] | null }) {
  return <div className="evidence-metrics"><div><span>Closest approach</span><strong>{number(value?.min_separation)} <small>m</small></strong></div><div><span>Robot contacts</span><strong>{value?.robot_contacts ?? '—'}</strong></div><div><span>Keepout violations</span><strong>{value?.keepout_violations ?? '—'}</strong></div><div><span>Falls</span><strong>{value?.falls ?? '—'}</strong></div><div><span>Goals reached</span><strong>{value ? `${value.goals_reached} / 2` : '—'}</strong></div><div><span>Episode time</span><strong>{number(value?.elapsed, 1)} <small>s</small></strong></div></div>;
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
  const [calibrated, setCalibrated] = useState(false);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [mission, setMission] = useState('Both G1 robots must reach their opposite goals. Keep a safe distance, respect the presenter zone, and resolve right of way without deadlock.');
  const [missionEditing, setMissionEditing] = useState(false);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [heldout, setHeldout] = useState<HeldoutResult | null>(null);
  const [replayFrames, setReplayFrames] = useState<WorldSnapshot[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  const [accessToken, setAccessToken] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const execute = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label); setError(''); setNotice('');
    try { await fn(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); }
  };
  const baseline = () => void execute('Running baseline', async () => {
    setReplayFrames([]); setScrubIndex(null); setActiveTask('baseline');
    await request('/api/sim/run', { mode: 'independent' });
    await workspace.refresh();
  });
  const pause = () => void execute('Pausing physics', async () => { await request('/api/sim/pause', {}); await workspace.refresh(); });
  const randomize = () => void execute('Spawning robots', async () => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
    await request('/api/sim/reset', { seed });
    setReplayFrames([]); setScrubIndex(null); setSearch(null); setHeldout(null); setActiveTask('baseline');
    await workspace.refresh();
    setNotice(`New scene initialized with seed ${seed}.`);
  });
  const findCounterexample = () => void execute('Searching counterexamples', async () => {
    setActiveTask('search'); setTab('evidence'); setReplayFrames([]); setScrubIndex(null);
    const result = await request<SearchResult>('/api/search', { trials: 6, duration: 30 }, 240_000);
    setSearch(result); setNotice(result.message); await workspace.refresh();
    if (result.evaluation?.frames?.length) { setReplayFrames(result.evaluation.frames); setReplayIndex(result.evaluation.frames.length - 1); setReplaying(false); }
  });
  const repairWithAstra = () => void execute('Astra is repairing', async () => {
    setActiveTask('repair'); setTab('source');
    const result = await request<RepairArtifact>('/api/repair', { mission }, 240_000);
    workspace.setRepair(result); setTab('evidence');
    setNotice(result.status === 'passed' ? 'Repair passed its episode evaluation. Run held-out tests to check generalization.' : `Repair completed with status: ${result.status}. Inspect the evidence.`);
  });
  const runHeldout = () => void execute('Evaluating held-out scenes', async () => {
    setActiveTask('heldout'); setTab('evidence');
    const result = await request<HeldoutResult>('/api/heldout', { repair_id: repair?.id, trials: 4 }, 240_000);
    setHeldout(result); setNotice('Held-out evaluation completed. Results are available in Evidence.');
  });
  const replay = () => void execute('Loading replay', async () => {
    const result = await request<EvaluationResult | { evaluation: EvaluationResult }>('/api/replay', { repair_id: repair?.id }, 240_000);
    const evaluation = 'evaluation' in result ? result.evaluation : result;
    if (!evaluation?.frames?.length) throw new Error('This evaluation has no replay frames. Run an evaluation first.');
    setReplayFrames(evaluation.frames); setReplayIndex(0); setReplaying(true); setScrubIndex(null);
  });
  const reference = () => void execute('Running reference controller', async () => {
    setReplayFrames([]); setScrubIndex(null);
    await request('/api/sim/run', { mode: 'reservation' }); await workspace.refresh();
    setNotice('Reference reservation controller is active. This controller is not an Astra-generated repair.');
  });
  useEffect(() => {
    const completedSearch = [...gatewayEvents].reverse().find(event => event.type === 'search' && event.data && typeof event.data === 'object' && 'found' in event.data);
    if (completedSearch) setSearch(completedSearch.data as SearchResult);
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
      if (event.key === 'Escape') { setCameraOpen(false); setProvenanceOpen(false); setMissionEditing(false); }
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === 'Space' && connected && !busy) { event.preventDefault(); if (replayFrames.length) setReplaying(value => !value); else if (snapshot?.paused) baseline(); else pause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const displayState = replayFrames.length ? replayFrames[replayIndex] : scrubIndex != null ? history[Math.min(scrubIndex, history.length - 1)] ?? snapshot : snapshot;
  const mode = replayFrames.length ? 'Recorded evaluation' : scrubIndex != null ? 'Recorded frame' : snapshot?.mode === 'reservation' ? 'Reference controller' : connected ? 'Live simulation' : 'Disconnected';
  const displayEvents = replayFrames.length || scrubIndex != null ? displayState?.events ?? [] : events;
  const selectedEvaluation = activeTask === 'search' ? search?.evaluation : activeTask === 'baseline' ? null : repair?.evaluation;
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
  const validCounterexample = Boolean(search?.found && search.evaluation?.scene_epoch === snapshot?.scene_epoch);
  const canRepair = Boolean(health?.api_key_present) && health?.astra_access?.state !== 'blocked' && validCounterexample && connected && !busy;
  const staleRepair = Boolean(repair && snapshot && repair.scene_epoch !== snapshot.scene_epoch);
  const authRequired = /operator access required/i.test(workspace.connectionError);
  const showBaselineSource = Boolean(workspace.controller?.source) && (!repair?.source || activeTask === 'baseline');
  const unlock = async () => {
    setUnlocking(true); setUnlockError('');
    try { await request('/api/auth', { token: accessToken }); setAccessToken(''); await workspace.refresh(); }
    catch (cause) { setUnlockError(errorMessage(cause)); }
    finally { setUnlocking(false); }
  };

  return <div className="app-shell">
    <header className="app-header"><a className="wordmark" href="/" aria-label="Astralignment home"><span className="brand-symbol"><GitBranch size={21}/></span>astra<span>lignment</span><span className="alpha-label">LAB</span></a><div className="workspace-selector"><span className="workspace-slash">/</span><span>Fork & Teach</span><ChevronDown size={13}/><span className="workspace-mode">LIVE</span></div><div className="header-actions"><button className="quiet-button" onClick={() => setProvenanceOpen(true)}><Layers3 size={14}/> Sources & runtime</button><span className="header-divider"/><span className="model-name"><Sparkles size={13}/> {health?.model ?? 'gpt-6-astra'}</span><div className="avatar">A</div></div></header>
    <div className="workspace-toolbar"><div className="breadcrumbs"><button className="icon-button" aria-label="Toggle experiment rail" onClick={() => setShowLeft(value => !value)}><PanelLeftClose size={16}/></button><span>Experiments</span><ChevronRight size={12}/><strong>Crossing paths</strong><span className="scene-id">{snapshot ? `SCENE ${String(snapshot.scene_epoch).padStart(3, '0')}` : 'NEW SESSION'}</span></div><div className="toolbar-right"><span className={`connection-state ${connected ? 'online' : ''}`}><span className="status-dot"/>{connected ? 'Simulation connected' : 'Connecting to simulation'}</span><button className="button compact" onClick={() => setCameraOpen(true)}><Smartphone size={14}/>{cameraConnected ? 'Camera connected' : 'Connect phone'}<ArrowRight size={13}/></button></div></div>
    <main className={`workspace-grid ${showLeft ? '' : 'rail-collapsed'}`}>
      {showLeft && <aside className="experiment-rail"><div className="rail-section-title"><span>EXPERIMENT</span><button className="icon-button" title="New random scene" aria-label="New random scene" disabled={locked} onClick={randomize}><Shuffle size={14}/></button></div><div className="experiment-heading"><span className="experiment-icon"><Waypoints size={23}/></span><div><h1>Crossing paths</h1><p>Two agents. One shared world.</p></div></div><div className="mission-card"><div className="section-eyebrow"><span className="amber-dot"/> THE MISSION<button onClick={() => setMissionEditing(value => !value)}>{missionEditing ? 'Done' : 'Edit'}</button></div>{missionEditing ? <textarea aria-label="Robot coordination mission" value={mission} onChange={event => setMission(event.target.value)}/> : <p>{mission}</p>}<div className="mission-chips"><span>2 × Unitree G1</span><span>Coordination</span></div></div>
      <div className="rail-section-title steps-title"><span>WORKFLOW</span><span className="step-count">4 STEPS</span></div><nav className="workflow" aria-label="Experiment workflow">{([{ id: 'baseline', number: '01', title: 'Run baseline', text: 'Observe independent policies', icon: Play }, { id: 'search', number: '02', title: 'Find a counterexample', text: 'Search for a failure', icon: Search }, { id: 'repair', number: '03', title: 'Fork with Astra', text: 'Generate a grounded repair', icon: GitBranch }, { id: 'heldout', number: '04', title: 'Test beyond the fix', text: 'Evaluate held-out scenes', icon: ShieldCheck }] as const).map(step => <button key={step.id} className={`workflow-step ${activeTask === step.id ? 'active' : ''}`} onClick={() => { setActiveTask(step.id); setTab(step.id === 'repair' ? 'source' : 'evidence'); }}><span className="step-number">{step.number}</span><div><strong>{step.title}</strong><span>{step.text}</span></div><step.icon size={15}/></button>)}</nav>
      <div className="scene-properties"><div className="rail-section-title"><span>WORLD</span><Focus size={13}/></div><div><span>Floor</span><code>{model ? `${model.scene.width} × ${model.scene.depth} m` : 'Awaiting model'}</code></div><div><span>Seed</span><code>{model?.scene.seed ?? '—'}</code></div><div><span>Controller</span><code>{snapshot?.mode ?? '—'}</code></div><div><span>Clock</span><code>MuJoCo</code></div></div>
      <div className="rail-footer"><div className="camera-mini"><span className={`camera-mini-icon ${cameraConnected ? 'active' : ''}`}><Smartphone size={18}/></span><div><strong>{cameraConnected ? 'Live camera attached' : 'Bring in the real world'}</strong><span>{calibrated ? 'Stage calibration saved' : 'Pair a phone, calibrate the floor'}</span></div></div><button className="button camera-connect" onClick={() => setCameraOpen(true)}>{cameraConnected ? 'Open camera' : 'Connect a camera'}<ArrowRight size={14}/></button></div></aside>}
      <section className="simulation-column"><div className="panel-heading"><div className="panel-tabs"><button className="active"><Layers3 size={14}/> World</button><button onClick={() => setCameraOpen(true)}><Radio size={14}/> Live camera{cameraConnected && <span className="status-dot is-live"/>}</button></div><span className="heading-meta">{displayState ? elapsed(displayState.sim_time) : '00:00.0'}<span>SIM TIME</span></span></div>
      <div className="stage-container"><SimulationStage model={model} state={displayState ?? null} connected={connected} mode={mode}/><div className="stage-metrics"><div><span className="robot-key robot-a"/> G1—A <strong>{displayState?.robots?.[0] ? displayState.robots[0].fallen ? 'FALLEN' : displayState.robots[0].goal_reached ? 'ARRIVED' : displayState.robots[0].action.toUpperCase() : 'WAITING'}</strong></div><div><span className="robot-key robot-b"/> G1—B <strong>{displayState?.robots?.[1] ? displayState.robots[1].fallen ? 'FALLEN' : displayState.robots[1].goal_reached ? 'ARRIVED' : displayState.robots[1].action.toUpperCase() : 'WAITING'}</strong></div><div className="separation-metric">SEPARATION <strong>{number(displayState?.metrics.min_separation)} <small>m</small></strong></div></div></div>
      <div className="simulation-actions"><button className="button icon-only" title="Randomize spawn" aria-label="Randomize spawn" disabled={locked} onClick={randomize}><Shuffle size={16}/></button><button className="button primary" disabled={locked} onClick={snapshot?.paused !== false || replayFrames.length ? baseline : pause}>{snapshot?.paused !== false || replayFrames.length ? <Play size={14} fill="currentColor"/> : <Pause size={14}/>}<span>{snapshot?.paused !== false || replayFrames.length ? 'Run baseline' : 'Pause'}</span><kbd>␣</kbd></button><button className="button" disabled={locked} onClick={findCounterexample}><Search size={14}/><span>Find counterexample</span></button><button className="reference-button" disabled={locked} title="Run the authored reservation controller, separately from Astra" onClick={reference}>Reference<ChevronDown size={12}/></button></div>
      <section className="timeline-panel"><div className="timeline-heading"><div><Activity size={13}/><strong>Correlated timeline</strong><span>{timelineFrames.length ? `${timelineFrames.length} captured frames` : 'Awaiting first episode'}</span></div><div><button className={`timeline-live ${!replayFrames.length && scrubIndex == null ? 'active' : ''}`} onClick={() => { setReplayFrames([]); setScrubIndex(null); setReplaying(false); }}><span className="status-dot"/>LIVE</button><button className="icon-button" aria-label={replaying ? 'Pause replay' : 'Play replay'} disabled={!replayFrames.length} onClick={() => setReplaying(value => !value)}>{replaying ? <Pause size={13}/> : <Play size={13}/>}</button></div></div><div className="timeline-ruler"><span>{elapsed(timelineMin)}</span><span>{elapsed(timelineMin + (timelineMax - timelineMin) / 2)}</span><span>{elapsed(timelineMax)}</span></div><div className="timeline-track"><span className="track-label">proximity</span><div className="chart-area"><svg viewBox="0 0 1000 44" preserveAspectRatio="none" aria-label="Measured minimum robot separation"><line x1="0" y1="40" x2="1000" y2="40" stroke="currentColor" strokeDasharray="3 6"/>{separationPoints && <polyline points={separationPoints} fill="none" stroke="#a3c9bf" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>}</svg><input aria-label="Inspect captured simulation frame" type="range" min="0" max={Math.max(0, timelineFrames.length - 1)} value={replayFrames.length ? replayIndex : scrubIndex ?? Math.max(0, history.length - 1)} disabled={!timelineFrames.length} onChange={event => { const value = Number(event.target.value); if (replayFrames.length) { setReplayIndex(value); setReplaying(false); } else setScrubIndex(value); }}/></div></div><div className="timeline-event"><span className="track-label">events</span>{events.length ? <div className="last-event"><span className={`event-point ${events.at(-1)?.severity}`}/><code>{elapsed(events.at(-1)!.sim_time)}</code><span>{events.at(-1)?.message}</span></div> : <span className="timeline-empty">Physics events will appear here as the episode runs.</span>}</div></section>
      </section>
      <aside className="inspector"><div className="inspector-heading"><div className="astra-icon"><Sparkles size={16}/></div><strong>Astra workspace</strong><span className="model-pill">GPT-6</span><button className="icon-button" title="Runtime provenance" aria-label="Runtime provenance" onClick={() => setProvenanceOpen(true)}><ExternalLink size={13}/></button></div><div className="inspector-tabs" role="tablist" aria-label="Astra inspector">{([{ id: 'source', label: 'Code', icon: Code2 }, { id: 'evidence', label: 'Evidence', icon: ShieldCheck }, { id: 'trace', label: 'Trace', icon: Terminal }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={13}/>{item.label}{item.id === 'trace' && gatewayEvents.length > 0 && <span className="tab-count">{gatewayEvents.length}</span>}</button>)}</div>
      <div className="inspector-content">{tab === 'source' && <><div className="file-heading"><FileCode2 size={14}/><span>{showBaselineSource ? 'baseline.py' : repair ? 'coordination_repair.js' : 'coordination.js'}</span>{repair && !showBaselineSource && <span className="file-modified">GENERATED</span>}</div>{showBaselineSource ? <><div className="source-provenance"><Code2 size={12}/><span>Built-in baseline · not generated by Astra</span></div><CodeView source={workspace.controller!.source}/></> : repair?.source ? <><div className="artifact-meta"><GitBranch size={12}/><code>{repair.source_hash?.slice(0, 12) ?? repair.id}</code><span className={`artifact-status ${repair.status}`}>{repair.status}</span></div>{staleRepair && <div className="stale-artifact"><TriangleAlert size={13}/><span>Scene changed. This artifact belongs to scene {repair.scene_epoch}; its evidence is stale.</span></div>}<div className="source-provenance"><ShieldCheck size={12}/><span>Source hash frozen for replay and held-out tests</span></div><CodeView source={repair.source}/>{repair.explanation && <div className="repair-explanation"><Sparkles size={13}/><p>{repair.explanation}</p></div>}</> : <div className="empty-code"><div className="empty-code-symbol"><GitBranch size={31} strokeWidth={1.25}/></div><h2>A failure is a starting point.</h2><p>Capture a counterexample. Astra will inspect the episode and write a coordination repair you can review and replay.</p><div className="empty-code-flow"><span>Observe</span><ArrowRight size={11}/><span>Fork</span><ArrowRight size={11}/><span>Verify</span></div><div className="code-placeholder"><div><span>01</span><i style={{ width: '61%' }}/></div><div><span>02</span><i style={{ width: '78%' }}/></div><div><span>03</span><i style={{ width: '46%' }}/></div><div><span>04</span><i style={{ width: '66%' }}/></div></div><span className="empty-note">No generated patch yet</span></div>}</>}
      {tab === 'evidence' && <><div className="evidence-heading"><span className="section-eyebrow">INDEPENDENT EVALUATOR</span><h2>{selectedEvaluation ? selectedEvaluation.passed ? 'Episode passed' : 'Failure captured' : 'Evidence, before confidence.'}</h2><p>{selectedEvaluation?.reason ?? 'Run an episode to measure coordination against the same independent checks.'}</p></div>{selectedEvaluation && <div className={`evaluation-verdict ${selectedEvaluation.passed ? 'passed' : 'failed'}`}>{selectedEvaluation.passed ? <CheckCheck size={16}/> : <TriangleAlert size={16}/>}<span>{selectedEvaluation.passed ? 'PASS' : 'FAIL'}</span><code>seed {selectedEvaluation.seed}</code></div>}<Metrics value={evidenceMetrics}/>{search && activeTask === 'search' && <div className="evidence-note"><Search size={14}/><p>{search.message}<br/><strong>{search.trials} trials evaluated</strong></p></div>}{repair?.test_output && <div className="test-output"><div><Terminal size={12}/> SANDBOX OUTPUT</div><pre>{repair.test_output}</pre></div>}{heldout != null && <div className="test-output"><div><ShieldCheck size={12}/> HELD-OUT RESULTS</div><pre>{JSON.stringify(heldout, null, 2)}</pre></div>}<div className="evidence-footnote"><ShieldCheck size={13}/><span>Evaluation checks are independent of generated coordination code.</span></div></>}
      {tab === 'trace' && <div className="trace-list">{gatewayEvents.length ? gatewayEvents.map((event, index) => <div className={`trace-entry ${event.type}`} key={`${event.at}-${index}`}><div><span>{event.type.toUpperCase()}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div><p>{event.message}</p></div>) : <div className="trace-empty"><Terminal size={26}/><strong>Listening for runtime events</strong><p>Search, generation, evaluation, and service errors are recorded here.</p></div>}</div>}
      </div><div className="astra-composer">{busy && <div className="busy-state"><LoaderCircle className="spinning" size={14}/><span>{busy}…</span></div>}<div className="composer-context"><span><Circle size={8} fill="currentColor"/> {snapshot ? `Scene ${snapshot.scene_epoch}` : 'No scene'}</span><span><History size={11}/>{events.length} events attached</span></div><button className="button astra-button" disabled={!canRepair} onClick={repairWithAstra}><Sparkles size={16}/><span>Repair with Astra</span><ArrowRight size={15}/></button>{health?.api_key_present === false && <span className="key-note">Add an OpenAI API key to enable Astra.</span>}<div className="repair-actions"><button disabled={!repair || staleRepair || Boolean(busy)} onClick={replay}><Play size={12}/>Replay repair</button><button disabled={!repair || staleRepair || locked} onClick={runHeldout}><FlaskConical size={12}/>Test held-out</button></div></div></aside>
    </main>
    {(error || notice || workspace.connectionError) && <div className={`toast ${error || workspace.connectionError && !connected ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <TriangleAlert size={16}/> : notice ? <Check size={16}/> : <Radio size={16}/>}<span>{error || notice || workspace.connectionError}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); if (!connected) void workspace.refresh(); }}><X size={13}/></button></div>}
    <footer className="statusbar"><div><span className={`status-dot ${connected ? 'is-live' : ''}`}/><span>{connected ? 'MuJoCo authoritative' : 'Simulation offline'}</span><span className="statusbar-separator"/><GitBranch size={11}/><span>{snapshot?.mode ?? 'independent'}</span>{replayFrames.length > 0 && <span className="replay-badge">RECORDED REPLAY</span>}</div><div><span>{health?.budget ? `$${health.budget.spent.toFixed(2)} / $${health.budget.limit.toFixed(2)} budget` : 'Usage unavailable'}</span><span className="statusbar-separator"/><span>{snapshot ? `tick ${snapshot.tick}` : 'No physics frames'}</span><button onClick={() => setProvenanceOpen(true)}><Cpu size={11}/>Runtime</button></div></footer>
    <div className={`camera-modal-layer ${cameraOpen ? 'open' : ''}`} inert={!cameraOpen} aria-hidden={!cameraOpen}><div className="modal-backdrop" onClick={() => setCameraOpen(false)}/><section className="camera-modal" role="dialog" aria-modal="true" aria-label="Live phone camera"><div className="modal-heading"><div><Smartphone size={18}/><h2>Connect the real world</h2></div><button className="icon-button" aria-label="Close camera" onClick={() => setCameraOpen(false)}><X size={18}/></button></div><CameraPanel onVideoReady={video => setCameraConnected(Boolean(video))} onCalibration={() => setCalibrated(true)}/></section></div>
    {provenanceOpen && <div className="modal-layer"><div className="modal-backdrop" onClick={() => setProvenanceOpen(false)}/><section className="provenance-modal" role="dialog" aria-modal="true" aria-label="Sources and runtime"><div className="modal-heading"><div><Layers3 size={18}/><h2>Sources & runtime</h2></div><button className="icon-button" aria-label="Close runtime details" onClick={() => setProvenanceOpen(false)}><X size={18}/></button></div><p>Every rendered robot pose comes from the simulation. Recorded frames and the authored reference controller are labeled in the viewport.</p><dl><dt>Repair model</dt><dd>{health?.model ?? 'gpt-6-astra'}</dd><dt>Physics</dt><dd>MuJoCo · shared authoritative clock</dd><dt>Coordinate system</dt><dd>Meters · right-handed · Z up</dd><dt>Robots</dt><dd>2 × Unitree G1</dd><dt>Camera</dt><dd>{cameraConnected ? 'Live stream connected' : 'Not connected'} · {calibrated ? 'calibration saved' : 'uncalibrated'}</dd></dl>{model?.provenance && <pre>{JSON.stringify(model.provenance, null, 2)}</pre>}<button className="button" onClick={() => { void workspace.refresh(); setProvenanceOpen(false); }}><RotateCcw size={14}/>Refresh services</button></section></div>}
    {authRequired && <div className="modal-layer"><div className="modal-backdrop"/><form className="unlock-modal" onSubmit={event => { event.preventDefault(); void unlock(); }} role="dialog" aria-modal="true" aria-label="Unlock operator workspace"><span className="unlock-icon"><KeyRound size={25}/></span><h2>Open your workspace</h2><p>Enter the deployment access token to connect to the simulation and Astra.</p><label htmlFor="acce