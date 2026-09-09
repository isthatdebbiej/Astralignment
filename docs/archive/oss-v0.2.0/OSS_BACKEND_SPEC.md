> Archived planning revision 0.2.0. Superseded by the [active specification](../../OSS_BACKEND_SPEC.md).
> Historical proposals below are not current requirements or implemented capabilities.

# OSS backend specification

Specification revision: 0.2.0 | Status: planned, not an implementation claim

This is the implementation contract for the [OSS product specification](OSS_SPEC.md).
It incorporates read-only hardware investigation, incident-derived regressions,
timing integrity, and cached perturbation batches. The existing two-G1 simulator
remains the initial qualified execution target.

## 1. Runtime and deployment

- Retain a TypeScript API and Python simulation/data workers. Docker Compose is
  the reference local/self-hosted distribution; native Node/Python development
  remains supported for the core application. Pin runtime and adapter versions.
- Base services are the application/API and a trusted job runner with MuJoCo.
  Optional profiles provide ROS capture, depth, Gazebo, Isaac, and training.
  GPU-dependent profiles are opt-in and must declare driver/runtime requirements.
  DimOS is an optional adapter, not required to inspect recorded incidents.
- The API must not receive a Docker socket. A dedicated trusted runner launches
  allowlisted job images with constrained resources and mounts. Imported files,
  recipe data, and model outputs cannot select arbitrary host commands or images.
- Local mode binds to loopback. Self-hosting uses HTTPS, operator authentication,
  and expiring device credentials. Preserve named data volumes across upgrades.
  Do not require Kubernetes, Kafka, a vector database, or a cloud account.
- SQLite WAL is the metadata source of truth, with one API-owned writer. Store it
  on local SSD or a Docker volume, not a OneDrive/network-synchronized directory.
  Store immutable blobs separately; derived Parquet supports analytical queries.
- Jobs have durable leases, heartbeats, attempt IDs, cancellation, progress,
  budgets, and idempotent result publication. Reserve model spend before dispatch;
  ambiguous paid calls remain unresolved until reconciled, not silently retried.

## 2. Identity, versions, and evidence lineage

Use UUID identities plus content hashes for immutable revisions. Friendly names
and aliases may change; historical revision references may not. A spec revision,
application version, schema version, and policy version are different fields.

| Entity | Required relationship or meaning |
| --- | --- |
| Project | Operator-owned namespace for devices, experiments, incidents, and datasets |
| Task/environment/evaluator revision | Executable success/failure rules, scene assets, timing requirements, and assumptions |
| Robot/configuration revision | Robot identity, component inventory, firmware, calibration, action/observation contract, and capability manifest |
| Policy revision | Artifact/source hash, controller configuration, compatible robot/task revisions, and memory schema |
| Model configuration revision | Requested model, returned model identity where available, prompts/tools, generation settings, and SDK version |
| Experiment revision | Task, environment, evaluator, policies, recipes, sampler, budgets, and split assignment |
| Episode | One physical recording or simulated execution, with origin, versions, stream set, outcome, and quality report |
| Checkpoint | Compatible simulator/controller/RNG state tied to a simulated episode and logical tick |
| Incident | Immutable references to an episode interval, affected robots/components, observations, and detector version |
| Diagnostic hypothesis | Explanation, alternatives, evidence references, missing evidence, author/model, and append-only review history |
| Reproduction recipe | Incident/hypothesis links, simulator adapter, initial-state construction, fault parameters, assumptions, and match criteria |
| Counterexample | A failed executed evaluation linked to episode, rule revision, branch intervention, and evidence; not merely any branch or job error |
| Repair candidate | Target software revision, proposed change, applicability, and actual evaluation runs; no physical deployment state |
| Batch and dataset version | Frozen execution manifest or curated membership, respectively; lineage and selection provenance remain attached |

An incident belongs to its source episode. A simulated reproduction references the
incident through `derived_from_incident_id`; it must not pretend to be an exact
physical-state fork. A counterfactual simulated episode uses a new episode ID and
`parent_checkpoint_id`. Repair tests create new episodes/evaluations rather than
rewriting the original failure.

Keep hardware-reported status, deterministic rule findings, model hypotheses,
simulated outcomes, and operator-supplied physical retests as distinct evidence
kinds. An operator confirmation requires an attached basis such as an inspection
or retest record. Never generate numerical diagnostic confidence without a
defined, validated method. Unknown evidence remains unknown.

## 3. Read-only hardware capture and diagnostics

The recorder subscribes to explicitly selected telemetry topics or imports files.
It must not relay commands or expose hardware-write services/actions. Record an
existing command stream as data when permitted; do not republish it on a physical
network. Replay runs in an isolated process/network/ROS domain. ROS credentials
and middleware permissions should deny command publication and write services
where supported; application allowlists alone are not the only boundary.

A `DeviceAdapter` discovers capabilities, declares schemas/units/clock semantics,
subscribes, and closes. A robot-specific profile declares required channels,
expected rates, vendor fault meanings, thresholds, calibration dependencies,
quality rules, and unsupported checks. Non-ROS devices require an explicit adapter;
generic camera connectivity does not imply access to robot internals.

| Input group | Capture and diagnostic use |
| --- | --- |
| Camera/phone | Original RGB/video, intrinsics, frame IDs, camera pose/depth if genuinely available; detect gaps and association failures |
| LiDAR/IMU/transforms | Original scans/points, per-point or scan timing when supplied, IMU, TF and calibration revisions; check frame/time compatibility |
| Controller and joints | Existing command targets, measured position/velocity, reported effort/current, acknowledgement, execution, cancellation and controller state |
| Hardware diagnostics | Component identity, firmware, reported voltage/temperature/faults/derating and original vendor values |
| Host/transport | Opt-in process/resource metrics, ROS execution traces, message sequence/deadline/QoS observations and recorder health |
| Human/agent events | Explicit user interventions, assurances, model request/result, observations available to the decision, and command/evidence references |

Retain measured versus estimated torque/effort distinctions and sensor units.
Do not infer a failed motor from tracking error alone. A detector may establish a
reported drive fault or an exceeded versioned threshold; causal explanation is a
separate record. Missing channels disable only dependent checks, not basic import
or inspection. Never invoke a vendor self-test merely because it is named a test;
it may move or reconfigure hardware.

Reuse ROS `diagnostic_msgs`/existing diagnostic producers rather than inventing a
parallel vendor status protocol. The upstream message includes component status,
hardware identity, and key/value data. Preserve those originals alongside indexed
fields. [ROS message definition](https://github.com/ros2/common_interfaces/blob/rolling/diagnostic_msgs/msg/DiagnosticStatus.msg).

Use optional Linux `ros2_tracing` for instrumented execution analysis. Its snapshot
mode can retain a bounded rolling history; tracing must capture required
initialization metadata. Do not assume full callback or kernel evidence is
available from an ordinary topic recording.
[Upstream tracing documentation](https://github.com/ros2/ros2_tracing).

### Recording cost and retention

Offer continuous episode recording and an explicitly armed incident recorder.
The latter pins available pre-trigger history plus a configured post-trigger
window. Persist its actual retained interval, byte budget, missing initialization
data, and overwritten history; do not advertise a guaranteed duration when the
byte cap retained less. Capture failure must not block the physical control loop.

Default application queues: 32 MiB/100 ms for live alignment work and 256 MiB for
pending recorder writes, whichever applicable limit is reached first. Preview may
drop old frames; authoritative recording gaps must be counted and surfaced. On
disk exhaustion, stop/finalize as incomplete with explicit reason and retained
range; do not silently evict pinned evidence. Defaults are configurable and are
not certified real-time bounds. Measure recorder-on versus recorder-off deadline
misses, CPU, memory, serialization, and disk load on each qualified stack.

## 4. Time synchronization, freshness, and causality

Every sample retains episode/capture-session/stream identity, stream epoch,
sequence/sample ID, original timestamp and unit, source clock identity/epoch,
timestamp meaning, collector-receive time, consumer-availability time when
instrumented, normalized session time, mapping revision, and uncertainty.
Represent nanosecond integers as decimal strings in JSON. Precision of storage
does not establish measurement accuracy. Missing capture/availability time is
unknown, never substituted silently with receive time or zero uncertainty.

Use the collector's monotonic clock as a capture-session reference. UTC is for
display/correlation; wall-clock changes cannot drive deadlines. Preserve native
hardware synchronization when available. For other connected sources estimate
offset/drift using authenticated four-timestamp exchanges: eight bootstrap probes,
then approximately one per second with a rolling fit. Include mapping age,
timestamp precision and unbounded network asymmetry in the quality assessment;
clock probes are not exposure synchronization or a proof of bounded one-way delay.
When a conservative bound cannot be established, leave alignment unqualified.

Reboots, timestamp resets, browser reloads and unexplained discontinuities create
new clock epochs. Reordered packets do not. Invalidate pending joins, projection
associations and live proposals on discontinuities. Preserve raw data; improved
offline mappings create derived revisions, not a rewrite of what an online agent
could have known. Host NTP/PTP status is supporting metadata, not automatic proof
of sensor capture alignment.

Each task/adapter defines a `TimingPolicy`: required streams, permitted pair error,
clock uncertainty, observation age, buffer/wait bounds, interpolation rules,
causality requirements, and failure behavior. Pair error includes timestamp
separation and both uncertainty bounds; unknown bounds cannot pass a strict gate.

- Reference sensorimotor export: at most 20 ms observation/action alignment error
  and 5 ms cross-clock uncertainty, plus observation availability before decision.
- Registered handheld preview: at most 20 ms image/pose association error and
  250 ms capture-to-display age where measurable; otherwise disclose unknown.
- These are initial engineering recipe limits, not universal robot safety limits.
  A consequential-assurance task must declare its own freshness/validity rules;
  missing, expired or failed evidence cannot authorize the assurance.
- Browser video frame metadata is best effort. Native phone RGB, pose, depth and
  intrinsics must be associated by frame identity/time. Inferred depth is not
  ground-truth LiDAR and cached depth is not current camera pose. Hide registered
  overlay on invalid tracking while leaving the real video visible.
- Retain LiDAR scan intervals/per-point times; deskew only with a qualified motion
  and timing adapter. Generic approximate matching does not repair clock errors.

Simulator time remains authoritative for simulation: the G1 reference uses
500 Hz physics, 50 Hz walking and 5 Hz coordination. Offline workers run as fast
as possible without changing the physics timestep. Live-coupled workers record
tick-to-monotonic anchors and lag, and invalidate stale overlay associations.
Each branch has a separate clock context even when it inherits a logical tick.

Model requests record origin/dependency revisions, request/return time, and a
validity deadline. Late or incompatible output is retained for investigation but
cannot replace the live policy. Existing low-level controllers continue without
waiting for cloud reasoning. Default policy promotion begins a new episode.

## 5. Reproduction, repair, and simulator adapters

A `SimulatorAdapter` declares robot/task compatibility, reset, step, observations,
evaluation, recording, and optional checkpoint/restore capabilities. Absence of
checkpoint support disables exact branching, not ordinary recorded playback.
Qualify MuJoCo, Gazebo and Isaac independently; seeds and assets alone do not
guarantee equivalent physics or portable checkpoints across engines/builds.

A `RobotPolicyAdapter` declares joint/actuator order, units, observation/action
schema, controller period, limits, recurrent-memory schema, asset hashes and
supported tasks. Arbitrary robot IDs replace the two-G1 restriction only as part
of a tested recipe. Dexterous support additionally requires a suitable policy,
contact/sensor model and evaluator; it is not enabled by loading a hand mesh.

Incident conversion creates an explicit model, not an automatic physical clone.
Require operator-reviewed measured/fitted/assumed parameters, uncertainty ranges,
missing state, and predeclared reproduction signatures. Store fit residuals and
failed matches. Faults such as stale observations, missing feedback, derating,
or command delay are injected at the corresponding interface, not by editing the
outcome label. Unsupported mechanical faults remain unsupported hypotheses.

Supported simulated checkpoints include integration/contact state required by the
engine, low-level policy buffers, coordinator memory, queued commands, RNG streams,
evaluator state, logical time, and schema/runtime hashes. Restore qualification
must cover all of them. Physical recordings never receive an exact-fork flag.

Astra may inspect bounded evidence, propose typed recipes and applicable software
changes, and run isolated tests. Preserve actor, investigator and evaluator
boundaries. Generated code runs in QuickJS without host/network/secret access or
evaluator mutation. It cannot change timestamps or quality thresholds to make a
case pass. Fixes outside the supported coordinator/configuration surface are
marked unsupported or require a separate developer-authored revision.

Test each candidate on the original case and frozen regressions, then on held-out
cases without feeding that held-out evidence back into the same repair search.
If used for further development, retire that holdout version and create a new one.
Report task completion, failures and waiting time together. Changed evaluator
rules create a new evaluation revision, not a repaired old outcome.

## 6. Cached scenes and perturbation batches

A `PerturbationRecipe` identifies its versioned base environment/task, supported
robot roster, parameter units/bounds/distributions/dependencies, injection phase,
validity checks, seed scheme, evaluator/timing policy, and source incidents.
Store the sampler version and every fully resolved sampled manifest. Invalid
samples receive a reason and are not counted as executed episodes. Reject
duplicate resolved configurations by default; intentional stochastic repeats are
explicit and record their independent RNG inputs.

Distinguish initial-state variations, interventions after a compatible checkpoint,
and model/dynamics/topology changes. A checkpoint from one robot roster or model
must not be restored into another. Model changes require an isolated compatible
variant plus reset/state construction; they are not a free checkpoint patch.

| Cache layer | Key and permitted reuse |
| --- | --- |
| Assets | Content hash, license/provenance; immutable geometry/textures/config blobs |
| Compiled models | Model/assets/physics options plus simulator build, platform and compiler compatibility; prepared model reused only within that contract |
| Policy artifacts | Weight/source hash, runtime and action/observation contract; no shared mutable recurrent state |
| Checkpoints | Full state hash, low-level policy/model/runtime/memory schema and dependencies; restore only with qualified compatibility |
| Recipes/manifests | Recipe/sampler revision, resolved parameters and RNG scheme; reuse definition, execute new intended trials |
| Existing evaluations | Exact inputs, versions, seed/state, evaluator and timing policy; historical reference only, not a new execution or independent sample |

Use long-lived, resource-bounded workers grouped by compatible model/policy.
Compile/load once per compatible worker and restore/reset private state per job.
Begin CPU admission at two workers, cap library thread oversubscription, and
benchmark one/two/four worker settings before increasing deployment concurrency.
Keep the interactive simulator/recorder resource reservation separate. A worker
pool is not a container per episode and a batch of 1,000 is not 1,000 live robots.

MuJoCo permits a read-only model with separate writable simulation data for each
concurrent execution. Do not mutate that shared model for friction/geometry
randomization. Process workers may each retain a model; sharing across processes
is not assumed. [MuJoCo simulation documentation](https://mujoco.readthedocs.io/en/stable/programming/simulation.html).

Current migration hotspot: `SharedWorld.from_checkpoint` constructs a new world
before restoring it, and `G1Controller` loads a TorchScript policy with internal
recurrent buffers. Start by pooling isolated controllers; only share weights or
batch inference after an explicit per-robot/per-episode memory API and isolation
tests exist. Reset every stateful subsystem before returning a worker to the pool.

Cache eviction is bounded LRU for unpinned derived artifacts only. In-flight jobs
pin dependencies. Persist source assets/manifests/checkpoints independently of
evictable caches. Hash mismatches and incompatible cache entries trigger a rebuild
or an explicit unsupported-restore error, never a silent approximate restore.

Headless state-based evaluation can omit video and render selected cases later
from qualified state playback. Vision-policy evaluation/training must render and
retain the actual observations used at decision time; failure-only rendering does
not provide a valid visual training dataset.

### Model-call economy

Astra authors a bounded recipe and investigates selected failures; deterministic
sampling/physics/evaluation does not call a generative model per episode. Cache
reusable proposals as versioned artifacts, but revalidate them against new inputs.
If the evaluated policy calls an LLM online, execute and account for those calls.

For `gpt-6-astra` investigations, keep stable instructions/tool schemas first and
dynamic evidence afterward. Use explicit cache breakpoints for reusable stable
prefixes where eligible; `prompt_cache_key` helps routing but does not guarantee a
hit. Record input, cached-input, cache-write and output usage, request latency and
actual budget consumption. Prompt caching reuses input computation, not answers,
and does not remove output-generation cost. These choices follow the
[official OpenAI caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching);
verify SDK support and account behavior during implementation rather than hard-code
a claimed discount or zero-token run.

Batch manifests freeze requested episodes, policies, seeds, budgets and selection
strategy. Leased attempts may retry, but one logical episode has one published
result; retries remain visible. Paired baseline/repair trials use matched inputs
and randomness, not old outcomes. Adaptive selection has a new manifest revision
and cannot quietly alter a fixed benchmark or draw from held-out families.

## 7. Persistence, query, and exports

Write artifacts to staging, flush/hash, publish atomically, then register committed
metadata. Reconcile orphan/incomplete writes on startup. Preserve original bags,
schema definitions, clock mappings and calibration artifacts. Apply explicit
quotas, backup/restore checks and dependency-aware deletion; caches are not backups.

Expose `/api/v1` through OpenAPI and shared types. Minimum new resources:

- `POST /projects/{id}/recordings/import` and capture sessions: durable import or
  explicitly armed read-only recording with capability/quality reports.
- `POST /episodes/{id}/incidents`: source interval and observed evidence references.
- `POST /incidents/{id}/investigations`: optional budgeted Astra investigation job.
- `POST /incidents/{id}/reproductions`: reviewed recipe and immutable provenance.
- `POST /experiments/{id}/batches`: frozen manifest, budgets, admission policy.
- `GET /jobs/{id}` plus resumable SSE and cancellation: stage, progress and errors.
- `POST /queries` and versioned dataset/export jobs: bounded query and immutable
  selection manifest. No hardware-write endpoint exists.

Use binary telemetry channels/WebRTC for high-volume live media; do not stream full
episodes as repeated JSON status payloads. Artifact range reads and cursor-based
results support large recordings. Keep existing archive routes readable during
migration; legacy custom JSON MCAP is not relabeled as a ROS bag.

Indexed metadata supports project, robot/component, firmware, policy/task/model,
incident signature, reported fault, review status, scene/map revision, region,
time interval, alignment quality, reproduction outcome and repair regression.
DuckDB queries operate over registered Parquet with bounded time/memory/results;
disable arbitrary file/network access, extensions and writes. Natural-language
queries expose the generated SQL and data coverage. Semantic labels remain
model-proposed until reviewed, and unsearched video is not a negative match.

Dataset versions contain membership, family lineage, selection/query, label
provenance, exclusions, transforms and normalization, exporter and feature schemas.
Offer MCAP with documented project schemas, genuine ROS 2 message/CDR-compatible
exports when mappings exist, and a pinned upstream LeRobot writer/loader for
supported features. Preserve original MimicGen HDF5 and source demonstration
lineage. Unmapped LiDAR/depth/vendor fields remain linked sidecars, not invented
training inputs. [LeRobot dataset documentation](https://huggingface.co/docs/lerobot/lerobot-dataset-v3).

MimicGen generation is an optional supported-task adapter with task-specific object
poses, subtask boundaries and source demonstrations, not arbitrary-world generation.
[MimicGen integration requirements](https://mimicgen.github.io/docs/tutorials/datagen_custom.html).

Separate integrity (readable/complete), training eligibility (compatible/causal/
reviewed), and measured utility. Failure trajectories are not automatically expert
imitation targets. Label failure, recovery, successful demonstration, and unknown
roles explicitly. Use 80/10/10 default family-grouped splits, keeping source
incidents, demonstrations, parent checkpoints, branches, repairs and near-duplicates
together. Reserve whole scene families for generalization tests. Fit normalization
only on training data. Offline temporal interpolation must not expose observations
that were unavailable to the original decision.

Training-utility reference comparison: A is base data, B adds generic valid data,
C adds targeted valid data; B/C have equal added counts and training budgets.
Use three training seeds and 50 held-out evaluation episodes per trained policy
as an initial declared protocol, not a statistical-power guarantee. Publish
uncertainty, negative results and qualification failures. No automatic claim that
more generated episodes improve the model.

## 8. Acceptance tests and rollout measurements

- Hardware boundary: synthetic publisher/recording fixtures prove no command,
  service/action write, parameter change, or simulated `/clock` leaks to physical
  networks; unknown adapters cannot gain write access.
- Incident evidence: missing feedback, ambiguous motor tracking errors, sensor
  dropouts and reported derating produce distinct observations/hypotheses; a
  simulated match never becomes a confirmed physical cause automatically.
- Temporal faults: offsets of +/-5 s, drift of +/-100 ppm, 0-200 ms jitter,
  asymmetry, loss, duplicates, reorder, restarts, clock jumps and late model
  responses never cause cross-epoch joins or acceptance of stale evidence.
- Cache equivalence: cold construction and qualified warm restore match the
  pinned reference trace/outcome within declared numerical tolerances; changed
  model, timestep, policy memory schema or assets invalidate reuse.
- Isolation: interleaved A/B episodes and multiple robots cannot exchange physics,
  RNG, recurrent state, pending commands, evaluator state or logical clocks.
- Batch durability: execute a 1,000-episode two-G1 reference manifest with process
  termination, retries, cancellation and resume; reconcile attempts, results,
  bytes and model spend without duplicate published episodes or silent omissions.
- Data: corrupt/truncated artifacts, disk-full, missing schemas, unknown timing,
  incompatible sensors and family leakage are detected. Round-trip supported
  exports through actual upstream readers, not only our own decoder.
- Performance: benchmark cold/warm startup, completed valid episodes/second,
  memory per worker, recorder overhead, query latency and UI update load. Initial
  metadata-query target is 250 ms p95 at 100,000 episodes on an 8-vCPU/32-GB SSD
  reference host; this is a test target, not measured capability or hard real time.
- Real-device qualification separately names the robot/sensors/firmware, ROS and
  OS versions, tracing setup, observed timing uncertainty and recording overhead.
  Phone projection and Isaac/GPU checks require their actual target hardware.

Publish capability and verification matrices with the release. No schema field,
mock, container startup, or successful data import alone qualifies hardware
diagnosis, checkpoint portability, or training utility.
