import type { EvaluationResult, RepairArtifact } from '../../../contracts';
import './RepairResult.css';

export interface RepairResultProps {
  repair: RepairArtifact | null;
  baseline: EvaluationResult | null;
  stale: boolean;
  busy: boolean;
  progress: string;
  onReplay: () => void;
  onInspect: () => void;
}

export function RepairResult({ repair, baseline, stale, busy, progress, onReplay, onInspect }: RepairResultProps) {
  if (!repair && !busy) return null;
  // A previous artifact is not evidence for the repair currently in flight.
  if (busy) return <section className="repair-result" aria-label="Repair result" aria-busy="true"><div className="repair-result-heading"><strong>Repair in progress</strong><span className="repair-result-badge">WORKING</span></div><p role="status">{progress || 'Astra is preparing and evaluating a coordination repair…'}</p></section>;
  if (!repair) return null;
  const evaluation = repair.evaluation;
  const evaluated = Boolean(repair.source_hash) && evaluation?.policy_hash === repair.source_hash;
  const terminal = repair.status === 'passed' || repair.status === 'failed';
  const verdict = stale ? 'STALE' : repair.status === 'error' ? 'ERROR' : terminal && evaluated ? evaluation!.passed ? 'PASSED' : 'FAILED' : terminal ? 'UNVERIFIED' : repair.status.toUpperCase();
  const comparable = evaluated && terminal && baseline != null && Boolean(repair.origin_episode_id) && baseline.episode_id === repair.origin_episode_id && baseline.scene_epoch === repair.scene_epoch;
  const metric = (value: number | undefined, suffix = '') => value == null || !Number.isFinite(value) ? 'Unavailable' : `${suffix === ' s' ? value.toFixed(1) : value}${suffix}`;
  return <section className={`repair-result repair-result-${verdict.toLowerCase()}`} aria-label="Repair result">
    <div className="repair-result-heading"><strong>Repair result</strong><span className="repair-result-badge">{verdict}</span><code title={repair.source_hash}>{repair.source_hash ? repair.source_hash.slice(0, 12) : 'Source pending'}</code></div>
    <p>{stale ? 'The live world changed. Watch the saved experiment in World view; its verdict does not apply to the current scene.' : repair.status === 'error' ? 'Repair did not complete. Inspect the code and runtime evidence for details.' : terminal && evaluated ? evaluation!.reason : terminal ? 'Matching independent evaluation is unavailable.' : repair.status === 'testing' ? 'The independent evaluator is testing the candidate.' : 'Astra is generating a candidate.'}</p>
    {terminal && <div className="repair-result-comparison" aria-label="Baseline to repair comparison">
      <span>Before → after</span>
      <span>Contact ticks <strong>{comparable ? `${metric(baseline!.metrics.robot_contacts)} → ${metric(evaluation!.metrics.robot_contacts)}` : 'Unavailable'}</strong></span>
      <span>Goals <strong>{comparable ? `${metric(baseline!.metrics.goals_reached, '/2')} → ${metric(evaluation!.metrics.goals_reached, '/2')}` : 'Unavailable'}</strong></span>
      <span>Episode time <strong>{comparable ? `${metric(baseline!.metrics.elapsed, ' s')} → ${metric(evaluation!.metrics.elapsed, ' s')}` : 'Unavailable'}</strong></span>
    </div>}
    {terminal && <small className="repair-result-scope">Independent episode verdict · not a general safety guarantee.{!comparable && ' Same-origin baseline comparison unavailable.'}</small>}
    <div className="repair-result-actions"><button className="button" disabled={!terminal || !evaluated} onClick={onReplay}>Watch repaired run</button><button className="button" disabled={!repair.source} onClick={onInspect}>Inspect code</button></div>
    {repair.explanation && <details className="repair-result-explanation"><summary>Astra explanation</summary><p>{repair.explanation}</p></details>}
  </section>;
}
