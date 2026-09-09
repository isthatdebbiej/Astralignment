# First-iteration backend specification

Specification revision: 0.3.0 | Status: implementation candidate; qualification pending

Implements the [product specification](OSS_SPEC.md) for a CPU-only,
single-operator evidence-curation workflow. The product is unnamed and
model-agnostic. [Revision 0.2.0](archive/oss-v0.2.0/OSS_BACKEND_SPEC.md) is archived
planning, not the active release contract. Existing prototype routes and stored
records remain intact. See [implementation and setup](CURATION_IMPLEMENTATION.md)
and the [verification ledger](CURATION_VERIFICATION.md) for executed checks.

## 1. Runtime, deployment, and budget

Retain the TypeScript application/API and use one Python CPU data worker.
The core Docker Compose distribution contains only those services and persistent
data volumes. Native Node/Python execution must support the same workflow.
MuJoCo, ROS, DimOS, depth services, 3D rendering, GPU runtimes, and external model
accounts are not core dependencies. Do not modify the legacy simulator's behavior
as a side effect of introducing the data worker.

- API-owned SQLite WAL is the metadata source of truth and has one writer.
  Store it on a local SSD or Docker volume, not OneDrive or a network share.
- Preserve original media/annotations separately; derived Parquet and indexes
  can be rebuilt from pinned inputs and versioned transforms.
- The worker claims a leased job through the API, reads allowlisted source
  artifacts, and publishes staging results through the API. It does not write
  SQLite directly or require access to a Docker socket.
- Run one background import/index/export job at a time initially; cap numerical
  and decoding thread pools rather than allowing each library to use every core.
  Keep request handling and video range serving responsive under worker load.
- Local listening interfaces are loopback. Self-hosting requires HTTPS and
  single-operator authentication covering queries, jobs, and media. Container
  networking is not authorization; do not expose worker or database endpoints.
- Use bounded resources, named volumes, and a documented backup/restore procedure.
  No Kubernetes, Kafka, managed database, vector database, or cloud account is
  required. Source files and collection manifests are not disposable caches.

Treat $150 as the total initial CPU/storage budget: at most $120 compute and
$30 storage/contingency. Verify actual prices and selected resources before any
provisioning; neither credits nor an hourly rate are assumed current. Record
estimated versus observed resource costs separately. Job cancellation cannot
stop cloud-instance billing; deployment instructions must explain that resource
lifecycle separately and never claim an application quota caps the provider bill.

No pretraining, GPU jobs, paid model calls, or mandatory learned ranking in this
iteration. Import requires a selected-file byte estimate and disk-space
preflight. An unavailable size estimate requires resolving the selection before
download, not an implicit unlimited import. No automatic 1 TB/full-corpus pull.

## 2. Source registration and BotFails import

The only initially qualified dataset adapter is a pinned
[BotFails](https://huggingface.co/datasets/kantine/BotFails) snapshot. The
implementation must resolve and persist the exact upstream revision and hashes;
the spec does not supply an invented revision or claim successful ingestion.

Source registration records repository/URI, resolved immutable revision, selected
files, source license/access terms, estimated bytes, adapter version, and
available modalities. Show this manifest before starting work. Source revisions
are not interchangeable with application, schema, or exporter versions.

BotFails-specific rules:

- Parse the source episode identities and separate CSV annotation files using a
  versioned adapter. Do not use the dataset viewer's camera-category label as a
  failure label.
- Keep normal_train and test assignments exactly as supplied. Distinguish the
  viewer representation from the source directory structure and source counts.
- Group all camera views, annotations, and available robot state/action channels
  under the same logical source episode. Use source identifiers within their
  repository/revision/task namespace; an episode number alone may not be unique.
- Inspect actual pinned schemas and units. A listed modality is not available
  until the selected files support it. Do not manufacture actions from poses or
  infer a robot's causal state from a human/video annotation.
- Preserve anomalies that are not failures as source categories. Keep source
  labels and reviewer labels distinct when their taxonomies disagree.
- Resolve frame-index annotations against the source stream's declared timing.
  Preserve frame indices and mapping provenance; do not assume 30 fps or convert
  ambiguous frame indices into exact cross-stream timestamps.
- Report unsupported schemas, missing labels, duplicate views, unresolved
  references, corrupt/truncated media, and checksum mismatches. Partial imports
  remain inspectable with their exclusions and incomplete status.

Imports may use a predownloaded read-only snapshot or an explicitly approved
selected-file download. No dataset repository scripts or custom executable
loaders run merely because they accompany data. Restrict paths to the registered
source roots and staging area; reject path traversal and arbitrary remote fetches.
Retain licenses; public availability does not authorize rebundling all media.

EgoSuite/EgoDemo bulk ingestion and generic ROS bag/MCAP/LeRobot conversion are
deferred. Their presence in historical docs is not an adapter capability.

## 3. Identity, provenance, and recorded time

Use stable IDs plus immutable revision/content hashes. Source records and review
history are append-only. Mutable project/collection names are not version IDs.

| Resource | Minimum preserved relationship |
| --- | --- |
| Project | Operator workspace for sources, reviews, and collections |
| Dataset source revision | Upstream identity/revision, selected-file manifest, licenses, checksums, and adapter version |
| Episode | Logical source episode, original split, task, known robot/policy metadata, source-family identity, streams, and integrity findings |
| Stream/artifact | Original path reference, content hash, schema/units, modality, source timestamps, and media/frame association |
| Evidence interval | Episode/stream references, native interval or frame bounds, and any mapping revision used for display |
| Source annotation | Original label, author/source if supplied, scope, and source-file reference |
| Review revision | Episode/interval, selected role, evidence references, rationale, reviewer, time, and superseded revision if applicable |
| Collection version | Frozen members/exclusions, intended use, source and review revisions, family/split assignments, and selection provenance |
| Job/export | Requested immutable inputs, attempt history, status, worker/transform/exporter versions, and committed output references |

Reference source families group different views and derived intervals together.
Preserve upstream policy/model identities only when supplied; do not substitute
our application's version for a missing source policy version.

Keep original timestamps, their units/meaning, source clock identities/epochs
when present, and known uncertainty. Use normalized episode offsets only as
derived presentation data with documented mapping provenance. Precision is not
accuracy. Missing receive, availability, or cross-clock synchronization
information remains unknown, not a zero timestamp or an inferred causal order.

A shared playback cursor does not certify synchronized sensors. Mark gaps and
discontinuities. Streams with no defensible mapping may be inspected separately,
but cannot support precise observation-before-action claims. Interval validation
uses the referenced recording's available bounds; missing media leaves the
interval unverified rather than silently clipping it.

This iteration does not implement live clock negotiation, phone tracking, online
freshness/assurance gates, or controller-deadline enforcement. Retain supplied
timing evidence so later work can use it without rewriting original records.

## 4. Persistence, jobs, and resource bounds

SQLite stores sources, logical episodes, artifact references, annotations,
reviews, collections, jobs, and quality reports. Derived Parquet supports
analytical scans; ordinary text indexes serve metadata and annotation search.
No mandatory embedding pipeline.

- Stage large artifacts, flush and hash them, publish atomically, and then commit
  metadata. Reconcile orphan/incomplete writes on startup; never expose partial
  exports as complete collection versions.
- Import/index/export jobs retain states queued, running, completed, failed, or
  cancelled, with stages, leases, heartbeats, attempt IDs, and progress counts.
  Retry only idempotent work; publish a logical result once.
- Restart can resume a verified partial download or reuse verified files. If
  resumption is unsupported, report a restart of that file instead of pretending
  transferred bytes were preserved. Cancellation retains the last durable state.
- Preflight source bytes, staging needs, expected derivatives, and free disk.
  Enforce configured storage limits during writes; disk-full stops the job with
  an explicit reason and preserves already committed source evidence.
- Keep original media compressed. Decode only requested previews/intervals;
  never read whole videos or the entire dataset into process memory.
- Use bounded thumbnail/preview caches keyed by source content hash, stream,
  interval/frame identity, and transform version. Evict only derived, unpinned
  cache entries; source media and immutable exports are not LRU victims.
- Serve media by authorized byte ranges and page episode/query results.
  Metadata status responses must not embed complete media or telemetry arrays.
- Bound worker queues, decoder threads, query duration, memory, and returned
  rows. Measure actual limits on the named CPU host before increasing admission.

Backups include metadata, manifests, original artifacts or verified recoverable
source references, and published annotations. Test restore, not just archive
creation. Unavailable externally referenced media must be reported after restore.

## 5. Search and review semantics

The first baseline is structured filters plus task/metadata text search. Add
explicit annotation-assisted search over imported source annotations and
reviewed labels. No natural-language-to-SQL model or inferred-video semantics are
required.

Supported filters use only indexed data: source/revision, task, original split,
modality availability, source outcome/category, reviewed role, integrity finding,
and known robot/policy metadata. Unknown is a distinct value. A no-result query
does not establish that a physical event never happened.

Return evidence references and match reasons, including whether source
annotations or reviewer labels produced a match. State which fields/episodes were
searched and which were unindexed or incomplete. Do not present an annotation
lookup as automatic failure detection.

DuckDB scans only registered derived Parquet in a bounded read-only query
environment. Public search inputs select supported filters/query expressions,
not unrestricted SQL with filesystem/network/extension access. Neither imported
text nor a future model may execute code or mutate original evidence.

Review roles are successful demonstration, failure, recovery, or unknown,
assigned to an episode or a referenced interval. Require a rationale and source
evidence references; changing a review creates a new revision. Preserve unresolved
or conflicting source annotations rather than overwriting them.

Keep intended training use and its missing prerequisites visible. Reviewer
approval alone does not create missing action labels, validate human permission,
prove a physical cause, or turn a failure trajectory into a good imitation target.
Any future model annotation needs producer/model/configuration identity and
review status; it must not masquerade as a source or human-reviewed label.

## 6. Collections, splits, and exports

A collection draft can change. Publishing creates an immutable version containing
explicit episode/interval membership, exclusions/reasons, intended use, source
revisions and checksums, exact review revisions, selection query/manual decisions,
family identities, and original split assignments. Later edits publish another
version; exports of an old version remain reproducible.

Preserve official source splits. Never randomly repartition camera views or clips
from the same source episode. Record recognized cross-format/derived lineage;
flag uncertain lineage instead of claiming perfect deduplication. Original split
membership and a later experiment-specific split are distinct fields; this
iteration must not silently move source test episodes into training.

The export job emits:

- A versioned JSON selection manifest identifying the collection version,
  sources, members/intervals, exclusions, schemas, transforms, and exporter.
- JSONL and Parquet representations of the same selected annotation/review
  records, with IDs, scope, roles, evidence, rationale, and provenance.
- Source artifact references/checksums, license references, original splits,
  family grouping, and the integrity/suitability findings applicable to the
  frozen version.

All formats describe the same selection. Intervals remain references into
original recordings; do not trim/re-encode media, resample actions, fabricate
robot control targets, normalize training features, or recalculate source labels.
Media is not automatically bundled into the export; report whether referenced
files are present locally and how the source can be resolved.

Export validation checks membership, interval bounds where known, checksums,
source/review references, and split consistency. Validation errors cannot yield
a successful export. Declared unknown suitability remains in a valid evidence
export rather than being promoted to training-ready.

No promise of converted ROS bags, sliced LeRobot datasets, robot-action
synthesis, or universal loader compatibility. A later training adapter needs its
own feature/time/action contract and upstream-reader tests.

## 7. Minimum public API contract

These resources are implemented under /api/v1. Shared types are in
contracts/curation.ts; runtime schemas are in gateway/curation/app.ts.
See the verification ledger for outstanding release qualification.

| Resource / operation | Required behavior |
| --- | --- |
| POST /projects/{id}/sources | Register a resolved source revision and selected-file/byte manifest; no download as a side effect |
| GET /sources/{id} | Return provenance, planned/available modalities, estimates, and import findings |
| POST /sources/{id}/imports | Start an explicit durable import after storage/selection preflight |
| GET /episodes and GET /episodes/{id} | Paged logical episodes and detailed source/stream/annotation/quality references |
| GET /episodes/{id}/intervals | Retrieve available source or review intervals with their native timing references |
| POST /queries | Bounded structured/text search with match evidence and annotation-use disclosure |
| POST /episodes/{id}/reviews | Append an episode/interval review revision with role, evidence, and rationale |
| POST /projects/{id}/collections and GET/PATCH /collections/{id} | Create, inspect, and edit draft selections without mutating published versions |
| POST /collections/{id}/versions and GET /collection-versions/{id} | Freeze and retrieve immutable membership and review/source references |
| POST /collection-versions/{id}/exports | Export a frozen version through a durable job |
| GET /jobs/{id} and POST /jobs/{id}/cancel | Persisted progress, attempt history, terminal outcome, and cancellation |
| GET /artifacts/{id} | Authorized range reads for registered media and committed exports |

Use resource IDs rather than caller-supplied filesystem paths. Expose clear
validation and unsupported-schema errors. Poll persisted job state initially;
streaming progress is not a requirement. A reloaded UI reconstructs state from
the API rather than local-only optimistic job records.

Existing prototype API/archive routes remain unchanged and separate. No
hardware command, live capture, training, simulator execution, or repair endpoint
is added to this first-iteration API.

## 8. Acceptance, retrieval evaluation, and future work

Implement the data/persistence/security tests in the [product spec](OSS_SPEC.md):

- Restart during import, review, collection publication, and export; no lost
  committed reviews, duplicated episodes, or falsely complete artifacts.
- Corrupt/missing media, checksum mismatch, invalid intervals, ambiguous timing,
  unsupported schema, and disk exhaustion yield inspectable failures.
- Camera views and derived intervals share their source episode/family; no
  cross-split leakage. Source categories and reviewer labels remain separate.
- JSONL/Parquet annotations and selection manifests round-trip to the exact
  frozen collection, including exclusions, original splits, and review history
  references; no hidden media slicing or source mutation.
- Reject path traversal, unregistered artifacts, unsafe query execution, and
  unauthenticated remote reads. Data-worker output cannot execute host code.
- Measure import time, peak memory, bytes stored, query p50/p95, and
  time-to-first-preview with the reference CPU host/configuration named. No
  unmeasured real-time or large-corpus throughput claims.

Persist the frozen 20-question retrieval pilot as a versioned evaluation artifact
with source revisions, reviewed relevance/evidence, query modes, and baseline
configuration. Report precision/recall at 10, per-query findings, and actual
review effort where measured. Scoring labels may support offline measurement but
must not leak into a label-hidden predictor's features or searchable fields.
Annotation-assisted retrieval deliberately uses source annotations and must be
reported under that name. The pilot does not train or validate an alignment model.

A future ranking model must earn its complexity against the baseline on untouched
evaluation cases. A future training-utility experiment compares base data,
equal-count random additions, and selected additions with matched budgets and
held-out interaction tests; report completion and human-correction response
separately. Neither is a first-iteration release requirement.

Live sensors, clock synchronization protocols, simulator forks, policy repair,
fleet jobs, GPU adaptation, bulk egocentric ingestion, and training-format
conversion remain deferred. Preserve the prototype and archived designs without
forcing their dependencies into the CPU curation path.
