# First-iteration frontend specification

Specification revision: 0.3.0 | Status: planned, not implemented

Implements the [product specification](OSS_SPEC.md) and consumes the
[backend contract](OSS_BACKEND_SPEC.md).
[Revision 0.2.0](archive/oss-v0.2.0/OSS_FRONTEND_SPEC.md) is archived.
The product name is undecided. Do not rename packages, invent branding, replace
assets, or present planned screens as existing prototype functionality.

## 1. Navigation and visual design

Use Library and Collections as the two primary destinations. Library contains
source registration, import status, filters/search, and episode results.
Episode inspection is contextual to a library result. Collections contains saved
drafts, immutable versions, and export history. Keep project selection and
Settings separate.

Retain React/TypeScript/Vite. Use URL-backed navigation for source, query/filter,
episode, selected interval, collection, and version. Do not put credentials,
private media contents, or arbitrary filesystem paths in URLs. Preserve existing
prototype journeys and assets; any prototype entry remains secondary and clearly
separate from the product's first-iteration navigation.

Default to System theme, following browser light/dark preference. Persist an
explicit System/Light/Dark choice. Use restrained typography, clear hierarchy,
consistent spacing, visible controls, accessible contrast, and non-color-only
states. Existing visual assets may be retained without asserting a new product
identity. No mandatory neon/terminal theme, fake telemetry, artificial typing
delay, decorative score cards, or invented progress.

Use keyboard-operable controls, visible focus, accessible form labels,
reduced-motion support, and sensible focus restoration after drawers close.
Keep secondary provenance/quality panels collapsible. Do not require Three.js,
a live camera, a simulator, or an external model key to inspect recorded evidence.

## 2. Library, source setup, and search

The empty state offers Register public dataset. The reference path is the
supported BotFails adapter, not an arbitrary-video import advertised as robot
training data.

Before starting an import, show:

- Repository/source identity, resolved revision, adapter version, and license.
- Selected files and estimated download/staging/storage needs.
- Modalities and labels the adapter expects, plus what has actually been checked.
- Available local storage and the configured import limit.

Source registration is not a download. Starting import is explicit; no automatic
full-repository or 1 TB pull. Unknown byte estimates must be resolved before the
import can start. Do not accept dataset license/access terms on the user's behalf.

An import panel shows persisted job stage, counts/bytes where known, last progress
time, cancellation, and an actionable failure reason. Reloading resumes the view
of the existing job. Completion is based on server state, not a spinner timeout.
Expose partial/imported/skipped/failed counts without conflating files, streams,
and logical episodes.

Library rows show source/revision, task, available modalities, original split,
source outcome labels, reviewed role if any, and integrity/completeness findings.
Multiple camera views belong to one episode and do not inflate episode counts.
Source labels and reviewer labels have distinct visual treatment. Missing
channels and unknown metadata are not presented as successful checks.

Embed structured filters and text search in Library. Show matched fields,
annotation-use mode, evidence links, and indexed coverage. Differentiate:

- Metadata search: task/source and other indexed metadata.
- Annotation-assisted search: also searches supplied annotations or reviewed
  labels, with the source of each match visible.

Do not call annotation-assisted retrieval failure detection or claim that
unsearched video contains no relevant event. An unsupported query reports which
evidence is missing rather than inventing an answer. Natural-language model
queries, mandatory semantic embeddings, and label-hidden prediction are deferred.

Use paged or virtualized result tables with explicit selection and sort state.
A source/import issue should not prevent browsing already committed episodes.

## 3. Episode evidence and review

Opening a result shows one recorded media view, a shared playback cursor, a
contextual evidence inspector, and a collapsible timeline. Expose alternative
camera streams without auto-playing every camera at full resolution.

The header identifies the episode's original source, revision, task, split,
stream coverage, and integrity findings. Content is recorded/imported evidence,
not live robot state. Present robot and policy metadata only when supplied.

The timeline relates recorded video, available robot state/action channels,
source annotations, and reviewer intervals. Preserve original timestamps and
native frame indices. Display any derived episode-time mapping and its limits.

- A common playback cursor is a presentation aid, not proof of causal alignment.
- Mark gaps, discontinuities, unmapped streams, and unknown clock relationships.
- When no defensible shared mapping exists, permit separate stream inspection
  without asserting that observations and actions occurred simultaneously.
- Seeking cancels stale media/data requests. Decode bounded previews on demand.
  Pause playback when backgrounded by default; avoid cumulative timer drift.
- Presentation interpolation must not rewrite annotations, discrete events, or
  export evidence. Preserve real gaps rather than compressing them away.

A reviewer may select a whole episode or a valid source-relative interval and
assign successful demonstration, failure, recovery, or unknown. Require evidence
references and a rationale, showing source annotations alongside the review.
Editing a review creates a new revision; expose the previous label and basis.
A source anomaly is not automatically a failure or a reason to discard data.

A reviewed label does not establish training benefit, a physical cause, or human
permission. Where human/agent events were not recorded, state that their meaning
cannot be established from this evidence. Do not offer an unsupported alignment
score or a confidence percentage without a defined validated measure.

## 4. Collections and immutable export

Create a collection from selected episodes/intervals or a search result. Store
explicit membership, not a live query whose future results silently change a
published version. Preserve the originating query and later manual selection
decisions as provenance.

Collection review shows:

- Included episodes/intervals and explicit exclusions with reasons.
- Intended training/evaluation use and missing prerequisites.
- Source revisions, original splits, family grouping, and available features.
- Source and reviewer label provenance, evidence, and exact review revisions.
- Integrity findings, unresolved references, source rights, and media availability.

Keep integrity, training suitability, and measured training benefit separate.
Use clear explanatory states, not one green quality badge. A valid evidence
selection can have unknown suitability for the declared learning task.
No training study means measured training benefit is not evaluated.

Publishing freezes an immutable collection version. Subsequent membership or
review changes produce a new version. Old versions remain selectable and
exportable; do not silently replace their labels with the latest review.

The export screen explicitly describes the bundle: a versioned selection
manifest, JSONL/Parquet annotations, source references/checksums, provenance,
family grouping, and original split assignments. Intervals reference original
recordings; this does not create sliced video or ready-to-train action data.
Media is not automatically bundled; show whether references resolve locally.

Use the label Selection manifest, not ROS bag, MCAP conversion, LeRobot training
dataset, or universally training-ready. Export progress and terminal status come
from persisted jobs. Disable download until a committed artifact exists, with
a reason and retry path for failures. Validation errors are not a successful
export with a hidden warning.

## 5. Budget, capabilities, and prototype coexistence

Settings identifies the CPU-only data-worker configuration, storage/cache limits,
backup location, and source access settings. No model API key is required.
Show measured bytes, estimates, and resource limits without implying that the
application enforces the provider's cloud-billing cap.

The initial total CPU/storage allowance is $150, not a monthly budget: at most
$120 compute and $30 storage/contingency, with actual rates checked before
provisioning. This first iteration does not provision cloud resources through
the UI. Cancelling an import is not stopping a cloud instance.

Camera capture, phone/LiDAR adapters, hardware diagnostics, experiments,
counterfactuals, repair, fleet batches, and training are deferred product work.
Existing world/camera/repair prototype screens remain usable in their own
context; do not remove them or imply they satisfy new curation acceptance gates.
Do not clutter first-iteration navigation with disabled future feature tabs.

No new logo, product name, or model-specific identity is chosen here. Historical
prototype branding and model names may remain where they describe actual
existing behavior.

## 6. Acceptance journeys and evaluation

Verify these journeys with the backend's pinned reference data and labeled small
fixtures for edge cases. Do not claim public-data validation from fixtures alone.

1. Register the supported source, inspect revision/rights/bytes, explicitly start
   import, and see persisted progress or an actionable failure.
2. Search by task/metadata and source annotations, identify why a result matched,
   and open the referenced episode without duplicated camera-view rows.
3. Inspect media and available channels; see gaps and unknown mappings rather
   than fabricated synchronization or missing data shown as healthy.
4. Review an episode and an interval, add evidence/rationale, change a review,
   and reopen the complete review history after restart.
5. Create a collection, record exclusions/intended use, publish version one, edit
   the draft, and verify version one remains unchanged.
6. Export a frozen version and verify displayed membership/review revisions
   match the manifest and both annotation formats exactly.
7. Recover the UI after interrupted imports/exports, backend restarts, missing
   artifacts, and validation errors; no permanently pending spinner or invented
   success/download button.
8. Complete both themes and keyboard-only navigation, including drawer focus,
   result selection, playback, interval review, and export.
9. Measure query latency and time-to-first-preview under worker load on the
   named CPU host. Publish cold/warm results and resource usage; do not promise
   hard real-time performance or untested corpus scale.

The product spec defines a frozen 20-question retrieval pilot. Reviewer-facing
measurements use actual time to a correct evidence-supported selection and
document unsuccessful searches. Do not invent user studies or estimated time
savings as measured outcomes. Annotation-assisted results and any future
label-hidden prediction results must be separate reports.

First-iteration UI and documentation must not claim customer adoption, improved
robot-policy training, or reduced human-agent-robot misalignment.
