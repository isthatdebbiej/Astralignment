> Archived planning revision 0.2.0. Superseded by the [active specification](../../OSS_SPEC.md).
> Historical proposals below are not current requirements or implemented capabilities.

# OSS specification: incidents, regression tests, and datasets

Specification revision: 0.2.0 | Status: accepted direction, planned implementation

This specification describes the post-hackathon OSS product. Its revision is not
an application release number. The [README](../../../README.md) and
[verification ledger](../../VERIFICATION.md) describe existing capabilities and tests.
The [six-hour specification](../../TECHNICAL_SPEC.md) remains a historical record.

- [Backend specification](OSS_BACKEND_SPEC.md): recording, timing, lineage,
  diagnostics, simulation, caching, queries, exports, and isolation.
- [Frontend specification](OSS_FRONTEND_SPEC.md): experiment navigation,
  incident investigation, evidence states, batch inspection, and replay.

## 1. Product and primary user

Astralignment connects a robot incident to the observations, agent decisions,
commands, and physical responses involved. A developer can preserve the incident,
investigate explanations, construct a supported simulation test, and evaluate a
software correction against that test and related cases.

The primary user is a robotics developer or researcher who already has a working
robot stack or supported simulation policy. The first useful result is an
inspectable failure and reusable regression case, not a populated dashboard.

Human reliance remains the research focus: did the agent establish that the robot
had completed the required physical action before inviting the human to act?
Hardware faults matter because an acknowledged command can fail to produce that
physical outcome. The product does not equate a reported fault, a plausible
explanation, or a successful simulated repair with a confirmed physical cause.

## 2. Accepted scope and implementation boundary

| Area | Existing prototype | OSS target |
| --- | --- | --- |
| Simulation | Two G1s, checkpoint branches, coordination search and repair | Versioned recipes, durable jobs, reproducible batches, compatible robot-policy adapters |
| Physical devices | Live camera input and simulated robot overlay | Read-only robot/sensor telemetry, recordings, capability checks, incident investigations |
| Diagnostics | Simulation evaluator and service status | Evidence-linked sensor, timing, controller, host, and reported hardware faults |
| Persistence | Bounded JSON/custom-schema MCAP experiment archive | Immutable episode lineage, indexed search, versioned datasets and genuine supported export profiles |
| Scale | Two G1 IDs, two concurrent evaluation slots | Bounded worker pool and 1,000+ queued episodes; concurrency measured separately |
| Training | Research artifacts, not demonstrated training improvement | Qualified upstream export and matched training-utility experiments |

Local and self-hosted deployment serves one operator with multiple projects.
Original project code is intended for Apache-2.0 release; asset and dependency
licenses remain separate and require an inventory before publication. Organization
accounts, billing, public launch, and physical fleet management are later work.

Real hardware is record-only in the OSS starter. No drive enable, motion command,
firmware write, controller-gain change, automatic stress test, or emergency-stop
reset is exposed. Existing simulation commands must not be routable to a physical
robot. Simulation repair is not hardware deployment authorization.

## 3. User stories, assumptions, and failure conditions

| ID | User need and acceptance | Assumption that can break it |
| --- | --- | --- |
| US-01 | Import or record an incident, close the application, and reopen the same evidence and versions | A camera clip or incomplete bag may omit the command, controller response, or timing needed for diagnosis; show the missing evidence |
| US-02 | Locate where delay entered the observation-to-action path and what was available at the decision | Clock uncertainty or missing instrumentation can prevent ordering; return indeterminate rather than inventing a cause |
| US-03 | Compare commanded and measured behavior with device fault reports | Current, effort, and fault semantics vary by hardware; require a versioned adapter and preserve original values |
| US-04 | Turn a reviewed incident hypothesis into an executable regression | A supported task, policy, fault model, and sufficient scene/state information are required; a bag alone is not a simulator checkpoint |
| US-05 | Compare a proposed correction on the original case, regressions, and held-out cases | A coordination-code change cannot fix broken mechanics or an incompatible low-level policy; report applicability before repair |
| US-06 | Generate 1,000 specified trials without manually recreating each world | Repeated seeds or invalid configurations can inflate volume without coverage; report executed, invalid, duplicate, and eligible counts separately |
| US-07 | Query incidents across robots, locations, policy versions, and failure types | Unknown/unindexed fields and incomplete semantic coverage must be visible; absence of matches is not proof that an event never occurred |
| US-08 | Export selected cases for a declared training recipe | A valid file is not necessarily a useful training sample; enforce causal alignment, labels, compatible features, and family-level splits |

These are product hypotheses, not validated customer demand. Pilot with five
developers using their own supported incident or task. Target first useful
inspection within 30 minutes excluding dependency/model downloads, with at least
three completing their own incident-to-regression journey. Record integration
time, unsupported evidence, and repeat use; a successful bundled demo is not this
validation.

## 4. Incident-to-regression workflow

1. Record or import an episode with robot, component, software, calibration,
   policy, and clock provenance. Preserve original artifacts.
2. Select an incident interval and inspect source observations, commands,
   measured responses, human events, and diagnostics on a qualified timeline.
3. Run deterministic diagnostic checks. Astra can inspect their results and
   propose explanations, competing causes, missing evidence, and bounded tests.
4. Save each explanation as a diagnostic hypothesis. Human review records its
   status and evidence; review alone does not confirm a physical cause.
5. Select a supported task/simulator adapter and create a reproduction recipe.
   Mark parameters as measured, fitted, or assumed. Persist residuals and gaps.
6. Execute fault-injected simulations and compare declared incident signatures.
   A matching simulation supports a model-dependent hypothesis, not proof of the
   real incident's cause. Failed reproduction remains an inspectable outcome.
7. Propose an applicable software correction, freeze its version, and test the
   original case, a regression suite, and held-out cases under fixed evaluators.
8. Publish the evidence bundle and optionally curate eligible trajectories into
   a versioned dataset. Physical retest evidence, if supplied by an operator,
   remains separate from simulation outcomes.

Example target task, not an existing hardware result: a gripper acknowledges a
command, reports that the target was not reached, and the agent still tells a
human to remove support. The investigation connects that unsupported assurance
to available feedback. A candidate software correction requires the task's grip
evidence before assurance. It does not claim to repair the gripper itself.

## 5. Fleet scope and economical batch generation

Keep three settings separate: robots interacting in one world, concurrently
executing worlds, and total queued episodes. Physical fleet records identify
devices and component histories; they do not imply fleet command/control.

The first batch recipe preserves the existing two-G1 experiment. Introduce
additional humanoids, manipulators, or dexterous hands only through qualified
robot-policy-task adapters. A different mesh is not a new supported embodiment.
Heterogeneous interacting teams require explicit task roles, compatible control
interfaces, and per-robot state isolation. Do not make them a prerequisite for
useful single-robot or two-robot investigations.

A batch may contain 10 layout variants x 20 perturbation configurations x 5 seeds
= 1,000 baseline episodes. A matched repair evaluation adds another 1,000
executions; held-out tests are additional. Five seeds without any seeded
stochastic variation do not create five distinct scenarios.

Cache assets, compatible compiled models, prepared workers, perturbation recipes,
and compatible checkpoints. Execute every changed scenario. Referencing an old
result is allowed as historical reuse, never as a fresh trial. Keep model calls
outside the simulator loop: Astra proposes bounded recipes and investigates
selected failures; ordinary sampling and rollouts need no generative model call.
An online model policy being evaluated still makes and records its actual calls.

Adaptive search can explore measured fault ranges and reduce failing cases, but
must record its selection policy and budget. Keep a fixed random/stratified
baseline and an untouched held-out set. Search yield is not deployment failure
prevalence. Optimize qualified, distinct cases per unit of time/cost, not counts
of near-identical trajectories.

## 6. Delivery and release gates

1. Persist identities, immutable revisions, timing metadata, jobs, and artifacts;
   migrate legacy records without fabricating missing provenance.
2. Deliver read-only bag import and ROS telemetry capture with incident inspection
   and deterministic checks. Generic inspection works without an Astra API key.
3. Add reviewed incident-to-simulation recipes, then warm-worker batch execution
   and cache qualification using the existing two-G1 task.
4. Connect Astra investigation and applicable software repair to that lineage,
   with independent evaluation and explicit unsuccessful/unsupported outcomes.
5. Qualify upstream dataset exports and a separate supported manipulation recipe.
   Advertise Gazebo, Isaac, robot, and sensor capabilities only after their own
   conformance tests; a generic adapter interface is not verified support.

Release requires restart recovery; an incident linked to a reproducible test;
honest stale/unknown timing behavior; isolation from physical command channels;
cold-versus-cached equivalence; a resumable 1,000-episode reference batch; and
downstream loading of supported exports. Actual hardware, phone, and GPU checks
must name the tested device/runtime. Fixtures stay labeled.

Record median and tail investigation latency, valid/eligible data yield, unique
failure coverage, restore failures, worker memory, recorder overhead, and actual
model usage. Do not promise throughput on an unmeasured machine or training
improvement without a controlled experiment.
