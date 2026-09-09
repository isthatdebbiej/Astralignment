> Archived planning revision 0.2.0. Superseded by the [active specification](../../OSS_FRONTEND_SPEC.md).
> Historical proposals below are not current requirements or implemented capabilities.

# OSS frontend specification

Specification revision: 0.2.0 | Status: planned, not an implementation claim

Implements the [OSS product specification](OSS_SPEC.md) and consumes the
[backend contracts](OSS_BACKEND_SPEC.md). The product is one workspace for
investigating an episode and its related tests, not a dashboard displaying every
metric at once. Preserve existing working camera/world journeys during migration.

## 1. Navigation and visual system

Use four primary destinations: Experiments, Search, Datasets, and Devices. Keep a
project switcher and Settings separate. Incidents, batches, counterfactuals and
repairs are contextual views within an experiment/episode, not additional global
navigation sections. Deep links preserve project, episode, time interval, selected
evidence, filters and comparison without serializing private media into the URL.

Retain React/TypeScript/Vite and Three.js; use React Router for location state,
TanStack Query for server state and TanStack Table for virtualized result tables.
Telemetry/render loops stay outside high-frequency React state updates.

Use the existing product logo, JetBrains Mono, uppercase section labels, square
panels, bracket-style actions, restrained borders and generous whitespace.
No replacement logo, decorative ASCII art, artificial typing delay, fake terminal
logs, CRT distortion or glow over sensor imagery and scientific evidence.

Support System/Light/Dark with a persistent preference; default follows the
browser. Dark tokens: background `#0A0A0A`, primary `#33FF00`, secondary `#79A574`,
warning `#FFB000`, error `#FF3333`. Light tokens: background `#F4F6EF`, primary
`#174A21`, secondary `#4C6350`, action `#146B25`, warning `#825700`, error `#B42318`.
Validate actual text/background contrast; low-contrast decorative green is not
essential text. Use labels/icons as well as color, visible focus, keyboard
navigation and reduced-motion support.

## 2. Experiment and incident investigation

The experiment page shows its task/environment/policy/evaluator revisions and the
episode list. Default columns answer: what ran, which robot(s), where, when, what
happened, and whether sufficient evidence exists. Show unknown separately from
success. Open an episode to view its scene/media, one contextual inspector, and a
collapsible timeline. Do not put device-health charts on every experiment page.

An episode header always exposes origin (physical recording, simulation, imported
recording, or labeled fixture), versions and recording completeness. Timing has
two independent labels: alignment (`ALIGNED`, `UNALIGNED`, `TIMING UNKNOWN`) and
presentation (`LIVE`, `DELAYED`, `REPLAY`). A healthy connection is not evidence of
fresh or synchronized samples.

The incident workflow is:

1. Select an interval, robot/component, and observed symptom. Pin source evidence
   before requesting analysis. Selecting a symptom does not assert its cause.
2. Inspect commands versus measurements, reported component status, observations
   available to the agent, and human/assurance events. Every finding links to raw
   samples or a versioned deterministic check.
3. Open Investigation to inspect Astra's proposed explanation, alternatives,
   missing channels, and suggested bounded tests. Explicitly label model output.
4. Review the hypothesis and, when an adapter is available, choose Create
   simulation test. The review lists measured/fitted/assumed parameters, model
   mismatch and unobserved state. Never call this action Fork real world.
5. Compare the physical recording and simulated reproduction with clearly
   separate origins, axes and matching criteria. Show non-matching outcomes too.
6. If a software correction is applicable, inspect its change and executed tests.
   A simulated pass does not change a hardware incident to Physically repaired.

Use explicit states: `REPORTED FAULT`, `CHECK FINDING`, `HYPOTHESIS`, `SIMULATED
MATCH`, and `PHYSICAL RETEST`. Review status is separate from evidence kind.
Confirmation requires its supporting inspection/retest record. Do not display an
unvalidated confidence percentage. A missing channel reads, for example, "Motor
temperature was not recorded; thermal diagnosis unavailable," not "Hardware OK."

## 3. Devices and physical fleet records

Devices lists robot identity, component inventory, firmware/configuration,
connected streams, last observed data, timing health and adapter capabilities.
Group by robot or site without assuming that every device belongs to one type of
robot. A component can move between robots; use its dated installation history.

Connect/import setup presents only relevant inputs: existing ROS recording, ROS
read-only capture, desktop camera, or supported phone/device adapter. Show what
data is and is not available before recording. Phone RGB is not labeled LiDAR;
estimated depth is distinct from measured depth. Camera overlay keeps original
video pixels and explicitly simulated robots.

Record-only mode is conspicuous but concise. Available actions are inspect,
record, stop recording, annotate, import and export. No physical motion, enable,
firmware, gain-tuning, fault-clear, or emergency-stop-reset action is present.
Stopping recording is not an emergency-stop control.

An incident recorder shows armed state, actual retained history, byte limit,
trigger and post-trigger range. Show gaps, overflow and incomplete finalization.
Continuous recording versus rolling incident history is an explicit choice;
unrecorded or overwritten history cannot be presented as recoverable evidence.

## 4. Batches, counterfactuals, and repair visibility

Batch setup separates robot roster per world, maximum concurrent worlds, and
total episodes. Select a qualified scene/task recipe, policy revisions, bounded
perturbations and seed strategy. Preview actual parameter ranges, validity rules,
family split, projected executions and estimated resource use before enqueueing.
Do not imply heterogeneous robot support merely because a selector can list it.

The batch page shows queued/running/completed/failed jobs, valid/invalid samples,
reused historical results, unique configurations, counterexamples, dataset-eligible
episodes, compute time and model usage separately. One row represents a logical
episode; attempt history exposes retries. Cancellation and current job stage are
always reachable. Resume after reload/restart from server state, not browser memory.

Show only a selected live/replay world by default. Use a virtualized results table
and optional static contact sheet, not 1,000 WebGL renderers. A cache indicator
explains which setup was reused and whether a fresh execution occurred. Do not
present theoretical token savings or cached results as new evaluated episodes.

Counterfactuals identify their parent simulated checkpoint, intervention, policy,
evaluator and outcome. A branch can pass; a job can fail without producing a
counterexample. Incident-derived simulations show their source incident and
assumptions rather than an exact-fork badge.

Repair uses durable stages: Inspecting, Proposing, Testing, Evaluating held-out,
and Complete/Failed/Cancelled. Show last progress time, elapsed time, completed
tests and budget, without inventing a percentage for model reasoning. A completed
job replaces the spinner from persisted server status. Disabled actions explain
the missing prerequisite and provide a relevant next action.

Display baseline and candidate outcomes, source/configuration diff, changed
decisions, and remaining failures. Enable Watch repaired run only for a persisted,
playable candidate trajectory. If only a partial trace exists, label its limits;
if none exists, offer Run and record when supported. A textual model submission
is not an executed repair and must not enable a fabricated replay.

## 5. Time-correct replay and comparisons

Use one playback clock derived from a monotonic anchor, selected rate and recorded
timestamps. Video, robot poses, telemetry plots and events subscribe to it.
Do not accumulate time through chained timers or clamp long gaps into short ones.
Mark gaps, clock resets, missing samples, model request/return/accept/reject and
evidence expiry on the timeline. Inspector exposes capture, receive, availability,
mapping uncertainty and the task's timing limits.

Seeking cancels stale media/data requests. Default pauses playback when the page
is backgrounded. Interpolate permitted continuous values for presentation only;
never interpolate fault codes, discrete interventions or evidence decisions.
Use one renderer owner with animation-frame/resize cleanup, bounded buffers and
proper resource disposal.

Compare by episode start or a selected event using an explicit display offset.
Keep original timestamps intact and make clock uncertainty visible. Historical
robot playback uses matching recorded video if available; otherwise show World
view. Never overlay an old repair on the current live camera as if simultaneous.
When tracking/alignment becomes invalid, hide the registered overlay and keep
real video visible with the reason.

## 6. Search, datasets, and acceptance

Search supports structured filters and visible SQL for robot/component, site/map/
region, task/policy/firmware, incident signature, timing quality, hypothesis review,
reproduction and repair outcome. Show data coverage and unknown values. Language
queries may propose filters/SQL, not invent unrecorded physical states.

Dataset review separates integrity, training eligibility and measured utility.
Show family grouping, source incidents, label provenance, timing exclusions,
feature compatibility, licenses and exporter version before publishing. Export
profiles say Project MCAP, ROS 2-compatible bag, or the supported LeRobot recipe;
they are not interchangeable names for the current JSON-schema archive.

Acceptance journeys:

- Import an incomplete robot recording, inspect supported channels and explicit
  unknowns, create an incident, and reopen it after application restart.
- Follow source evidence to an Astra hypothesis, reviewed reproduction and actual
  simulation test without confusing any of their evidence states.
- Inspect a 1,000-episode batch with bounded browser memory; pause/cancel/resume
  jobs and distinguish cached setup, fresh results and retried attempts.
- View a real persisted repair through completion and replay; no permanent spinner,
  unexplained disabled button, stale trajectory, or live-video/replay mismatch.
- Inject a clock reset and delayed model response; show their actual consequences
  without granting a stale assurance or silently joining incompatible streams.
- Verify keyboard/focus behavior, both themes and reduced motion. Desktop media
  fixtures are labeled; actual handheld/mobile alignment has a separate device QA.
- Ten-minute recorded playback has no cumulative clock drift; at 30 fps the chosen
  playback target is within one frame when data/render capacity permits, with
  buffering and dropped frames disclosed rather than hidden.
