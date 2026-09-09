# First-iteration product specification: evidence curation for robot-policy training

Implementation and release evidence: [setup](CURATION_IMPLEMENTATION.md) ·
[verification ledger](CURATION_VERIFICATION.md). Public-data and human-review
qualification remain separate from fixture tests.

Specification revision: 0.3.0 | Status: implementation candidate; qualification pending

The product name is undecided. This document specifies the first product
iteration, not a rename or an application release. The working prototype retains
its existing identifiers, assets, and historical descriptions.

- [Backend specification](OSS_BACKEND_SPEC.md)
- [Frontend specification](OSS_FRONTEND_SPEC.md)
- [Archived planning revision 0.2.0](archive/oss-v0.2.0/README.md)
- [Existing prototype and setup](../README.md)
- [Prototype verification ledger](VERIFICATION.md)

Revision 0.3.0 supersedes the archived release requirements. The earlier
incident-to-simulation workflow, device capture, repair, and 1,000-episode batch
are deferred work, not prerequisites for this iteration.

## 1. User, promise, and research objective

The primary user is a robot-policy training team selecting recorded experience
for a declared learning or evaluation task.

The first-iteration promise is to find relevant recorded episodes, inspect their
evidence, label their intended use, and create reproducible dataset selections.
The first useful result is a reviewed collection with an inspectable export, not
a trained model or a populated simulation dashboard.

The long-term research objective is human-agent-robot alignment: respecting human
intent and correction and providing trustworthy information during physical tasks.
That objective does not establish the usefulness of our first product.

Video alone cannot establish permission, an agent's knowledge, human intent, or
the cause of a physical failure. A completed task may have violated an instruction;
an interrupted task may reflect a correct human-requested stop. Record those
distinctions only when supporting evidence exists. The reference dataset does not
by itself validate this human-correction research hypothesis.

Keep three judgments separate:

| Judgment | What it establishes | What it does not establish |
| --- | --- | --- |
| Integrity | Files, identities, schemas, and referenced intervals are readable and accounted for | Correct labels or suitability for a learning objective |
| Training suitability | Available evidence and modalities meet the declared use's reviewed prerequisites, or missing requirements are identified | Improved policy performance |
| Measured training benefit | A named downstream training/evaluation experiment produced reported results | General alignment, hardware safety, or benefit on untested tasks |

No combined quality score or alignment score is part of this iteration. An export
may be useful for inspection while remaining unsuitable for a stated training use.

## 2. Hypotheses and limits of validation

These hypotheses are unproven, not marketing claims:

| Hypothesis | Why it may fail | Evidence required |
| --- | --- | --- |
| H1: Evidence retrieval reduces curation effort versus ordinary metadata search | Existing filters already find the relevant episodes, or review overhead dominates | A frozen retrieval pilot comparing relevance and review effort against metadata search |
| H2: Explicit correction/recovery labels preserve useful examples lost by completion-only filtering | Recorded interactions lack correction evidence, or apparent recovery labels are wrong | Later interaction datasets with reviewed correction/recovery evidence and selection comparisons |
| H3: Selected data improves downstream policies | Failure actions become bad imitation targets; selection removes useful diversity | Later matched training experiments with held-out tasks and equal training budgets |
| H4: Policy-training teams will adopt the workflow | Their bottleneck is collection or training rather than curation | Later use by prospective teams on their own work, including repeat use and integration effort |

We currently have public datasets only, no partner recordings or training loop.
The first pilot can establish technical correctness and limited retrieval
usefulness, not customer demand, downstream training gains, or reduced misalignment.

A label such as failure, recovery, or successful demonstration is not an automatic
instruction to include or exclude an episode. A failed action is not an expert
imitation target merely because it exposes an interesting counterexample.

## 3. Delivery boundary and defaults

- One operator, multiple local projects; local execution and self-hosted Docker
  Compose. No cloud account or external model key is required for the core flow.
- One pinned public BotFails snapshot is the qualified reference input. Resolve
  the exact revision during implementation; this spec does not fabricate a SHA
  or assert that a dataset has already been downloaded or checked.
- CPU only, with one background data worker. No GPU job, pretraining, paid model
  call, or mandatory learned ranking. Metadata and source-annotation search are
  the baseline; compact-model adaptation is deferred pending measured need.
- Total initial CPU/storage allowance: $150, with at most $120 for compute and
  $30 reserved for storage/contingency. This is not a monthly allowance or an
  entitlement to credits. Verify actual rates before provisioning.
- Require a selected-file byte estimate and storage preflight before import.
  No automatic full-corpus download, egocentric bulk ingestion, or 1 TB target.
- First export is a versioned selection manifest and JSONL/Parquet annotations
  referencing original recordings. It is not a converted ROS bag, sliced LeRobot
  dataset, generated robot-action dataset, or universal training format.

The reference source is [BotFails](https://huggingface.co/datasets/kantine/BotFails).
Its separate annotation files, official splits, and episode identities are the
basis of the adapter. Multiple camera views are streams of one source episode.
The dataset viewer's camera-category label is not a failure label. Verify the
pinned files and rights during implementation rather than assuming all listed
modalities and labels are present and usable.

Original project code remains intended for Apache-2.0 release; dependency,
asset, and dataset rights remain separate. This revision does not publish the
repository, grant redistribution rights, or replace license review.

## 4. User journey and stories

Register public dataset -> inspect import quality -> search episodes -> inspect
relevant intervals -> review labels -> save collection -> export immutable selection.

| Story | First-iteration acceptance |
| --- | --- |
| Register a source | Inspect source revision, license, selected files, estimated bytes, and adapter coverage before starting an import |
| Understand completeness | Inspect import findings, missing/corrupt media, available channels, original splits, and unknown metadata |
| Find relevant episodes | Search indexed task/annotation text and structured metadata; see match reasons and coverage |
| Inspect evidence | Open source video and available state/action channels at a referenced interval; retain gaps and unknown clock relationships |
| Review a selection | Label an episode or interval as successful demonstration, failure, recovery, or unknown, with evidence and rationale |
| Preserve a collection | Save membership, exclusions, provenance, and intended use; reopen them after application restart |
| Export a version | Freeze membership and review revisions; export selection and annotations without inventing observations, actions, or timing |

Library and Collections are the only primary destinations. Episode inspection is
contextual to Library; search is embedded there. Settings and project selection
remain separate. Existing camera/world/repair journeys are preserved as prototype
capabilities but do not enter the first-iteration default workflow.

Reviews may describe source-relative intervals rather than assert precise causal
ordering. Missing authorization or human-event channels remain missing; a reviewer
cannot establish them by choosing a label.

## 5. Technical pilot and release gates

Create a frozen retrieval evaluation containing 20 manually reviewed questions,
expected relevant episodes/intervals, and supporting evidence references. Freeze
it before tuning search or introducing any learned ranking. Publish its source
revision, retrieval configuration, reviewer procedure, and evaluation version.

Keep two protocols distinct:

- Annotation-assisted retrieval: supplied annotations are searchable and match
  reasons disclose their use. This is retrieval, not failure detection.
- Label-hidden prediction: a later model must not consume withheld evaluation
  labels, revealing annotation text, or ground-truth-derived indexed features.
  Prediction is not a first-iteration feature or a required benchmark result.

Compare against ordinary task/metadata search using ranked relevance and review
effort. Report precision/recall at a declared cutoff (10), per-question results,
time to a correctly supported selection, and unsuccessful queries. Measure
human review time only when someone actually performs the review; missing
measurements stay unmeasured. Order comparisons to reduce familiarity effects
and disclose the small sample and reviewers used.

Respect official dataset splits. Keep views, derivatives, and intervals of the
same source episode together. Treat the BotFails holdout as held-out until its
labels are used for development; a consumed holdout becomes a named development
version, not evidence of unseen-task generalization. Any later trainable ranking
experiment also reserves whole task families when claiming task generalization.

Release gates:

1. Import the reference snapshot without duplicate camera-view episodes or
   invented channels; persist the quality report.
2. Reopen sources, reviews, collections, versions, and job states after restart.
3. Detect corrupt/missing media, checksum mismatches, invalid intervals, disk
   exhaustion, and interrupted imports; preserve recoverable evidence.
4. Export exactly the frozen selection and review revisions with source grouping,
   split assignments, checksums, and exclusions intact.
5. Prevent family leakage and preserve source timestamps, gaps, and unknown clock
   relationships in playback and exports.
6. Complete keyboard navigation and both light/dark journeys.
7. Measure import time, peak memory, disk consumption, query latency, and preview
   latency on the named CPU host, distinguishing cold and warm caches.
8. Publish the 20-question pilot and its baseline comparison without implying
   adoption, training improvement, or an alignment result.

A lack of retrieval gain is an acceptable negative result. Do not add a learned
model simply to satisfy a feature checklist; retain the simpler baseline unless
an extension improves held-out relevance or review effort at comparable quality.

## 6. Deferred work and later evidence

Defer GPU adaptation, large egocentric ingestion, human-correction benchmarks,
live device/phone/LiDAR capture, hardware diagnostics, simulator reproduction,
automated repair, fleet execution, and training-format conversion. Keep previous
designs in the archive rather than retaining them as active release requirements.

Before downstream training claims, compare:

- A: base training data.
- B: base data plus generic/random valid additions.
- C: base data plus our selected additions.

B and C use equal added counts and equivalent training budgets; all arms use a
declared training recipe, multiple seeds, and held-out evaluation. Report task
completion and response to human correction separately. Record uncertainty and
negative results; simple review labels do not establish either outcome.

[DemInf](https://arxiv.org/abs/2502.08623) and
[SCIZOR](https://arxiv.org/abs/2505.22626) are relevant curation baselines to assess
when training evaluation becomes available, not dependencies of this release.
Inspect Robots and simulator adapters remain candidates for later execution
integration, not required services in the CPU evidence-curation product.

This specification update is documentation-only. It does not deploy services,
download data, train models, alter runtime behavior, rename packages, or certify
the prototype against these future acceptance gates.
