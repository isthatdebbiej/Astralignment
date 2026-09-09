# Product implementation rules

## Active first-iteration contract

The product name is undecided. Follow the planned revision 0.3.0 in
[the product spec](docs/OSS_SPEC.md), [backend spec](docs/OSS_BACKEND_SPEC.md),
and [frontend spec](docs/OSS_FRONTEND_SPEC.md). These documents describe planned
work, not implemented capabilities. Revision 0.2.0 is retained as
[archived planning](docs/archive/oss-v0.2.0/README.md), not current requirements.

The first product iteration serves robot-policy training teams: register a public
dataset, inspect import quality, search episodes, inspect intervals, review labels,
save collections, and export immutable selections. Library and Collections are
its primary destinations. Do not add unrelated platform features as prerequisites.

Core operation is CPU-only, model-agnostic, and requires no external model key,
MuJoCo, ROS, DimOS, or GPU. Use one bounded CPU data worker. No pretraining, paid
model calls, or bulk egocentric ingestion is part of this iteration. The initial
total CPU/storage budget is $150 ($120 compute, $30 storage/contingency), not a
monthly entitlement; obtain actual rates and task authorization before spending.

Keep integrity, training suitability, and measured training benefit separate.
A source annotation lookup is not automatic failure detection. Public-dataset
tests do not prove customer adoption, policy improvement, or human-agent-robot
alignment. Preserve source data, timestamps, official splits, family lineage,
licenses, and review history. Do not invent missing observations or actions.

Preserve working prototype behavior and unrelated changes. Do not rename packages,
replace existing assets/logos, or choose a new product name. Documentation-only
tasks must not implement or deploy runtime changes, download datasets, train
models, or run paid services.

## General engineering and evidence rules

Use apply_patch for file edits. Never read or commit secrets. Follow sandbox
approvals. Preserve third-party licenses and source attribution; do not introduce
dependencies on another local project. Do not commit or push unless requested.

No fake telemetry, fabricated pass rates, invented cost/time savings, or recorded
outputs presented as fresh. Seeded fixtures are permitted only when labeled.
Source evidence, reviewer judgments, model proposals, and measured outcomes are
distinct. Unknown evidence stays unknown. Run focused checks and name what
actually ran; do not claim tests, hardware validation, or training results without
executing them.

## Existing prototype only

The six-hour build constraint and Astra-specific implementation lanes belong to
the historical prototype, not new product work. When editing the prototype,
preserve its two G1 humanoids and continuous camera journey. Do not silently
substitute animated meshes, wheeled bases, or prerecorded footage for working
features. Preserve its existing GPT-6 Astra integration without making that model
a dependency of the first-iteration curation product.

Prototype spatial contract: meters, right handed, Z up, XY stage plane. API and
MuJoCo coordinates use this basis; Three.js sets camera.up to (0,0,1).
Physics is authoritative; rendering does not move robots.

Prototype service ports: Python simulation 8001, Node gateway 8787, Vite 5173
with /api and /ws proxying to the gateway. Preserve contracts/index.ts and
existing route compatibility when integrating separately authorized work.

The prototype's real G1 policy runs at 50 Hz and MuJoCo physics at 500 Hz.
Retain a shared physics clock with independent recurrent state per robot and
branch. Generated coordination code must never execute unsandboxed on the host,
and runtime model output cannot modify the independent evaluator.

Existing desktop browser QA does not establish actual iPhone or physical robot
qualification. Actual device checks require the device and an explicit check.
