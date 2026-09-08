# Astralignment

**Make human–robot coordination debuggable.**

The robots know how to walk. Astra writes and tests the code that helps them work together around a human.

Astralignment is a developer workspace for finding coordination failures, inspecting their causes, and evaluating executable repairs. It combines real camera video, two simulated Unitree G1 humanoids, an independent evaluator, and GPT-6 Astra acting as a software engineer.

**The output is not another plan in a chat window. It is coordination code, measured results, and a replay you can inspect.**

[Get started](#get-started) · [What Astra does](#what-astra-does) · [Generated data](#what-data-does-this-produce) · [Architecture](#architecture-and-real-time-challenges)

## The problem: capable agents can still fail as a team

“Reach your destination” is an individual objective. “Both of you finish, without colliding or blocking the person using this space” is a shared objective with constraints.

Two competent agents can choose individually reasonable actions that produce an unacceptable joint outcome: competing for a passage, entering a protected area, or waiting indefinitely for each other. Better locomotion does not, by itself, resolve these coordination requirements.

For this project, **human–agent alignment means translating a person's intent and boundaries into behavior that can be checked against observable outcomes**. The human defines the mission and confirms spatial constraints. Software agents select behavior. Simulated robots reveal its physical consequences.

Astralignment addresses **coordination failures under explicit, human-confirmed constraints**. It does not infer all human preferences or establish general model alignment. An independent-controller baseline failure is not evidence that Astra is deceptive or has a conflicting objective.

### A concrete example

A presenter needs an access corridor through a stage. Two robots must reach different marks without contacting each other or entering that corridor.

The developer marks the corridor, runs the independent baseline, and inspects an actual failure. Astra receives that evidence and writes a revised coordinator. We evaluate the same starting checkpoint again, then different seeded starts with the source held fixed.

Stopping both robots forever does not pass: both goals must be completed.

## Why use it?

- **Robotics developers:** reproduce multi-robot failures in simulation before attempting the corresponding physical experiment.
- **Agent developers:** evaluate executable behavior against consequences, rather than judging whether an explanation sounds plausible.
- **Researchers:** compare coordinators under controlled conditions and collect regression examples.
- **Human operators:** make boundaries explicit and see which instructions have actually been tested.

The value is the connection between **human intent, a concrete failure, a code change, and independent evidence**. A passing scene is a starting point for further testing, not permission to deploy on physical robots.

## What Astra does

The gateway uses `gpt-6-astra` through the OpenAI Responses API with function calling. See the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) for capabilities and account-dependent access.

1. **Inspect:** `inspect_failure` exposes the scene, measured feedback, recent events, and closest-approach robot state.
2. **Write:** Astra generates a complete JavaScript `coordinate(input)` function returning bounded robot actions, optional waypoints, and explicit memory.
3. **Test:** `test_controller` executes that source in an isolated QuickJS/WASM worker against a fork of the actual MuJoCo checkpoint.
4. **Revise:** evaluator output goes back to Astra. The current loop allows up to three distinct candidate tests within six model turns.
5. **Submit:** `submit_controller` freezes the source hash. Replay and held-out tests use that source instead of generating a different policy for every scene.

Astra changes the **coordination layer**. It does not generate high-frequency joint torques, retrain locomotion, directly animate robots, or edit the evaluator. DimOS supplies a separate native messaging interface; it is not required for Astra's sandbox-to-MuJoCo evaluation path.

An optional still-image feature can ask Astra for scene proposals, which require human confirmation. The main repair loop uses structured simulation evidence; it does not continuously upload the camera stream to Astra.

## A real camera view, simulated robots

The camera image remains real video. Three.js draws transparent-background robot meshes over it using authoritative MuJoCo body poses.

An operator identifies four corners of a measured floor rectangle. A planar mapping anchors the stage; a fitted or manually adjusted pinhole-lens estimate projects robots above the floor. Confirmed obstacle annotations become collision boxes.

This is **not video converted into an animated environment**. The current system does not reconstruct arbitrary 3D geometry, track a moving camera, automatically detect people, or provide real-object occlusion. Keep the camera fixed after calibration. Read the [projection assumptions](docs/CAMERA_PROJECTION.md) before interpreting spatial accuracy.

## Architecture and real-time challenges

Live presentation, fast robot control, and slower model reasoning run separately. “Real-time” means an interactive live workspace—not a certified hard-real-time controller.

| Layer | Responsibility | Timing or boundary |
| --- | --- | --- |
| React + Three.js | Live video, robot overlay, setup, code and evidence inspection | Rendering and video independent of model requests |
| MuJoCo + CPU TorchScript | Two G1s in one physical world, with independent recurrent policy state | 500 Hz simulated physics; 50 Hz walking-policy updates |
| Generated coordinator | Go/wait decisions and bounded waypoints | Evaluated every 0.2 simulated seconds; model inference is outside this loop |
| Node gateway + QuickJS/WASM | Model tools, code isolation, validation, budgets, evidence identity | No host filesystem, network, imports, or credentials exposed to generated code |
| Native DimOS | Typed LCM poses/ticks and explicitly enabled velocity commands | Separate worker/container; observation-only by default |
| Caddy + Coturn | HTTPS, signaling, authenticated WebRTC relay | Only web and bounded relay ports are public |

The difficult engineering is making a claimed fix trustworthy:

- **One physical clock:** robots interact in the same world. Configured simulation frequency is not guaranteed wall-clock throughput on every machine.
- **Complete checkpointing:** forks preserve physics integration state, recurrent policy buffers, actions, phase, scheduler, and random state. Resetting visible positions alone is insufficient.
- **Independent evaluation:** contacts, falls, corridor intrusion, stage escape, deadlock, and completion are checked outside generated code. MuJoCo supplies collision geometry; corridor/boundary checks use an approximate 0.45 m pelvis-centered footprint.
- **Evidence identity:** episode UUID, scene epoch, and source hash prevent old results being presented as evidence for a changed world or program. Exact replay has been tested within a matched runtime, not guaranteed across library versions.
- **Bounded execution:** generated code has time/memory limits and validated outputs. Native external commands expire. These are engineering safeguards, not hardware safety certification.
- **Camera continuity:** hiding panels does not stop the stream. Stale video hides the robots instead of implying an old frame is live.

## What data does this produce?

Counterexamples are **generated through simulation**, not retrieved from a public failure dataset. Search tests the current scene, then seeded variations of robot starts/goals while retaining stage geometry. It stops at the first failure; it is not exhaustive adversarial search.

| Data | Current availability |
| --- | --- |
| Scene, seed, trajectories, events, evaluator metrics | Returned by search/evaluation/replay APIs; active histories are bounded in memory |
| Full physics/policy checkpoints | In-memory store, limited to 16; not a durable archive |
| Generated source, hash, explanation, test output, repair evaluation summary | Persisted with budget state in `runtime/state.json`; Docker uses a named volume |
| Full evaluation frames | Returned during runs; intentionally removed from persisted repair summaries |
| Held-out results | Returned for the current test; not automatically collected into a permanent corpus |
| Camera video | Streamed through WebRTC; the application does not record a video archive |

**There is not yet a searchable durable counterexample corpus or an automated training pipeline.** A saved repair summary does not preserve the full checkpoint needed for replay after a simulator restart.

### What could the data be used for?

The immediate use is a **regression suite**: preserve a failure and verify that later coordinators do not reintroduce it. A durable collection could support model comparisons, failure-pattern analysis, and curated failure/repair examples for compatible learning systems.

That requires an archive/export layer: versioned scenes, runtime and policy versions, complete checkpoints or reproducible initialization, trajectories, source hashes, evaluator definitions, and all outcomes—including failures. Dataset splits should separate scenario families, not merely reshuffle nearly identical starts. Camera-derived material needs consent and privacy review before sharing.

The intended contribution is **paired behavioral evidence**, not a pile of videos: what the person required, what failed, what code changed, and what happened when that code was tested again.

## Get started

### Requirements

- Git, Node.js 22+, npm, and Python 3.12.
- A desktop browser with WebGL. No physical robot or server GPU is required for the current CPU-policy simulation.
- A funded server-side OpenAI API key with access to `gpt-6-astra` for generated repairs. The simulator/UI work without one; no mock repair is substituted.
- For camera input: camera permission, a fixed phone mount, measured floor dimensions, and HTTPS. Your computer's localhost is not the phone's localhost.
- For the full hosted stack: Linux with Docker Engine and Compose. The verified Vultr configuration is Ubuntu 24.04, 8 vCPUs, 32 GB RAM—not a measured minimum. Allow disk space for substantial native DimOS dependencies.

### Local development

```sh
git clone https://github.com/isthatdebbiej/Astralignment.git
cd Astralignment
npm ci
```

Create a Python environment and start the simulator.

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m sim.server
```

Linux:

On Ubuntu 24.04, install the Python environment and graphics-library prerequisites first:

```sh
sudo apt-get update
sudo apt-get install python3.12-venv libgl1 libegl1 libglib2.0-0 libgomp1
```

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m sim.server
```

In a second terminal, supply `OPENAI_API_KEY` through your environment or secret manager if using Astra, then run:

```sh
npm run dev
```

Open `http://localhost:5173`. For local loopback use, leave `PUBLIC_ORIGIN` unset and retain `HOST=127.0.0.1`. The gateway reads process environment; it does **not** automatically load `.env`. Never put secrets in `VITE_` variables or commit them.

`.env.example` documents the settings; its public-origin placeholder is for hosted use and must not be copied unchanged into local development. Native DimOS is optional locally and targets Linux; see [DimOS setup](sim/DIMOS.md).

### Your first experiment

1. Choose **World** to begin without a camera, or **Setup → Camera** to pair a phone and confirm floor calibration.
2. Set the mission in **Setup → Mission**. Editing this text alone does not change physical geometry or previous evidence.
3. Run the baseline or **Find counterexample**. Inspect the measured result in **Evidence**.
4. Select **Repair with Astra** when a current counterexample and funded access are available. Inspect the patch in **Code** and tool activity in **Trace**.
5. Replay the repair, then **Test held-out** with the same source. **Timeline** exposes captured frames. Recorded and authored-reference modes are labeled.

Changing the scene invalidates earlier evidence. If model access is unavailable, configure it before continuing; the authored reference is not an Astra repair.

### Docker deployment

Compose runs `sim`, `dimos`, `gateway`, `web`, and `turn` independently. Before using it on another host:

1. Replace `web.environment.ASTRA_HOSTNAME` in `compose.yaml` with your reachable HTTPS hostname.
2. Create `/etc/astra/gateway.env`, mode `0600`, using [the template](deploy/gateway.env.example). Configure the matching `PUBLIC_ORIGIN`, a strong `ASTRA_OPERATOR_TOKEN`, and API key if needed. Choose `ASTRA_BUDGET_USD` deliberately: it is an application-side estimate/cap, not an account-wide billing limit.
3. Configure `/etc/astra/turnserver.conf` for your relay address and authentication secret. Set matching `CAMERA_TURN_SECRET` and `CAMERA_TURN_URLS` in the gateway environment. Browsers receive expiring credentials, not the shared secret. The included full-stack configuration requires this TURN file.
4. Follow [the deployment guide](deploy/README.md) for ports and persistence, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose exec -T dimos python -m sim.dimos_smoke
```

Do not expose internal gateway, simulator, or DimOS command ports. Preserve named volumes. Do not publish environment dumps, pairing URLs, or operator tokens. The supplied hostname and relay address are deployment-specific, not universal defaults.

## Verification

A real Astra-generated coordinator completed both goals in 18.8 simulated seconds with zero violations under the implemented evaluator, replayed exactly across 95 frames, and passed four held-out starts with the source frozen. This is a small measured result, not broad generalization.

Native DimOS observation/control and TURN-relayed video have been exercised on Linux. Desktop overlay tests verify transparent robots over changing synthetic video, authoritative pose advancement, and hiding on disconnect. Physical-phone projection accuracy remains a separate check.

```sh
npm test
npm run build
```

Run simulation tests with the project environment, for example `.venv/bin/python -m pytest tests/sim` on Linux. Browser tests in `tests/browser` require running services; some deliberately change a test scene. Read their setup before using a shared workspace. The [verification ledger](docs/VERIFICATION.md) records results and remaining checks.

## Explore the implementation

- [Technical specification](docs/TECHNICAL_SPEC.md) and [implementation details](docs/IMPLEMENTATION.md)
- [Workspace navigation](docs/WORKSPACE_UX.md) and [camera projection](docs/CAMERA_PROJECTION.md)
- [Locomotion and coordination policies](docs/POLICIES.md)
- [Native DimOS integration](sim/DIMOS.md)
- [Deployment and HTTPS](deploy/README.md)
- [Verification evidence](docs/VERIFICATION.md)

## Attribution

The pretrained G1 policy, model, and meshes originate from Unitree's `unitree_rl_gym`; their BSD-3-Clause license and pinned provenance are retained. Selected locomotion-adapter foundations were adapted from Mori with permission. Astralignment does not import or run Mori and does not claim to have trained the walking policy. See [source and model attribution](sim/ATTRIBUTION.md) for inherited components and new implementation boundaries.
