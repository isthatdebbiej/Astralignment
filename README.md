# Astralignment

**Test whether robot coordination respects the person sharing the space.**

A person asks two robots to cross a stage and leave an access corridor clear. Each robot can walk to its destination. Together, they can still collide, enter the corridor, or wait for each other until neither finishes.

Astralignment reproduces these failures in simulation and gives GPT-6 Astra the evidence needed to write a different coordinator. The new code runs from the same saved starting state. A separate evaluator checks whether both robots finish without violating the specified constraints. The developer can inspect the code, replay the motion, and test the unchanged program on different starts.

The workspace combines two simulated Unitree G1 humanoids, real camera video, and an executable repair loop. The person specifies and confirms the constraints; Astra writes coordination software; MuJoCo exposes its physical consequences. No physical robot is controlled.

The research question is specific: **can model-generated coordination code preserve a human-defined boundary while completing a shared task, and does the repair survive changes to the starting conditions?**

[Get started](#get-started) · [What Astra does](#what-astra-does) · [Generated data](#what-data-does-this-produce) · [Architecture](#architecture-and-real-time-challenges)

## The problem: capable agents can still fail as a team

“Reach your destination” is an individual objective. “Both of you finish, without colliding or blocking the person using this space” is a shared objective with constraints.

Two competent agents can choose individually reasonable actions that produce an unacceptable joint outcome: competing for a passage, entering a protected area, or waiting indefinitely for each other. Better locomotion does not, by itself, resolve these coordination requirements.

For this project, **human–agent alignment means completing the requested task while respecting the person's explicitly represented constraints**. The human defines the mission and confirms spatial constraints. Software agents select behavior. Simulated robots reveal its physical consequences.

There are two distinct places to fail. The specification may omit something the person needs, or the controller may violate a correctly specified requirement. Astralignment currently tests the second. Mission text is supplied to Astra, but arbitrary natural-language requirements are not automatically turned into evaluator rules. A boundary absent from the scene and evaluator cannot be established by a passing result.

Astralignment addresses **coordination failures under explicit, human-confirmed constraints**. It does not infer all human preferences or establish general model alignment. An independent-controller baseline failure is not evidence that Astra is deceptive or has a conflicting objective.

### A concrete example

A presenter needs an access corridor through a stage. Two robots must reach different marks without contacting each other or entering that corridor.

The developer marks the corridor, runs the independent baseline, and inspects an actual failure. Astra receives that evidence and writes a revised coordinator. We evaluate the same starting checkpoint again, then different seeded starts with the source held fixed.

Stopping both robots forever does not pass: both goals must be completed.

### Why this remains useful as models improve

Stronger models may solve more of these scenes on the first attempt. That would reduce the number of repairs needed, not remove the need to check task completion and constraint violations. A new layout, different starting state, or changed requirement is a new test condition. The evaluator gives developers a way to distinguish an actual improvement from a more convincing explanation.

The current two-robot setting is deliberately narrow. It is an instrument for testing coordination, not evidence about deception, hidden objectives, or all forms of human–AI misalignment. More realistic human behavior and incomplete specifications would require new scenarios and evaluation methods.

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

The new **Start spatial tracking** action explicitly asks permission to send selected JPEG camera frames to a perception worker on Modal. It sends at most two frames per second, with one request in flight and no backlog; inference may be much slower. The first request can take up to two minutes while the worker starts. Stopping tracking stops these uploads without stopping the phone's live video.

Automatic projection uses an **estimated metric** floor and camera pose anchored to an initial view, with a limited frame context. It is not full SLAM, a persistent room map, arbitrary 3D reconstruction, automatic human detection, or real-object occlusion. Lost, stale or invalid geometry withholds the robot projection instead of extrapolating a pose. Reacquiring a substantially different view may require restarting spatial tracking. The real video remains unchanged beneath the virtual robots.

Advanced manual calibration remains available: identify four corners of a measured floor rectangle and adjust the estimated pinhole lens. Confirmed obstacle annotations become collision boxes. Keep the camera fixed in this manual mode; read the [projection assumptions](docs/CAMERA_PROJECTION.md) before interpreting spatial accuracy. The automatic worker integration is implemented in source; its deployment and end-to-end desktop/iPhone verification remain pending until separately reported. Earlier synthetic fixed-camera overlay tests do not verify automatic handheld tracking.

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
| Scene, seed, trajectories, events, evaluator metrics | New baseline, replay and held-out evaluations are written to the experiment archive with their full returned trajectory arrays |
| Full physics/policy checkpoints | The live simulator still keeps at most 16 checkpoint handles; new baseline records also retain the returned checkpoint payload and state hash |
| Generated source and candidates | Repair start, tool calls/results, tested candidates, final submissions and errors are archived, including available source/hash, explanation and actual evaluation evidence |
| Compact repair summaries and budget state | Still stored separately in `runtime/state.json`; these summaries are not the full archive |
| Provenance | Experiment records include content SHA-256, payload size, trajectory frame count and available source/model provenance hashes |
| Camera video and image pixels | Excluded from experiment records; WebRTC video is not recorded, and selected perception uploads are not an archive of camera footage |

The implemented archive is stored under `runtime/experiments` and exposed in **Evidence → Experiment archive**. Expand a record to inspect its identity/hash and download authenticated JSON or MCAP. The same-origin APIs are `GET /api/experiments`, `GET /api/experiments/:id.json` and `GET /api/experiments/:id.mcap`.

MCAP exports use custom JSON-schema channels `/astralignment/experiment` and `/astralignment/trajectory`. They preserve full trajectory arrays as indexed messages alongside experiment metadata; they are **not ROS messages or a ROS-compatible bag profile**. Timestamps use relative simulation time where available, otherwise sequence order—not camera wall-clock recording times.

Default limits are **128 MiB per record, 2 GiB for the archive and 2,000 records**. Limit failures are explicit; records and frames are not silently truncated or evicted to fit. This is local durable storage, not an off-host backup. There is no automatic recovery of historical runs that were never recorded, and exporting a checkpoint does not by itself implement cross-restart checkpoint import or guarantee replay across changed runtime versions. Archive deployment and export verification must be reported separately from implementation.

### How the data can improve Astra's behavior

**Today, feedback improves the candidate program within a repair session. It does not update Astra's model weights.** After each test, Astra receives the measured outcome, violation events, completion metrics, and selected robot states. It can revise its code using that feedback. The current loop is bounded to three distinct candidate tests; improvement is not guaranteed. Earlier repair artifacts are not automatically retrieved into later sessions.

A useful example links a requirement to a consequence: the corridor was reserved; a candidate entered it at a particular simulated time; a revised candidate changed its routing or yielding decisions; a repeat evaluation measured whether the violation disappeared and both robots still finished. The explanation alone is not the label—the executed result is.

| Use | How it could change behavior | Implementation status |
| --- | --- | --- |
| Feedback during repair | Let Astra revise a coordinator after observing an actual failure rather than guessing whether its first program works | Implemented |
| Regression evaluation | Detect whether a new model, prompt, or tool interface reintroduces previously observed failures | Individual replay, held-out tests and durable experiment/export records implemented; automated corpus-wide regression runner not implemented |
| Retrieval of previous failures | Supply relevant, verified examples before Astra writes a new coordinator | Not implemented; archive listing/download is not semantic retrieval or automatic prompt augmentation |
| Training examples | Provide requirement–program–outcome records, or controlled comparisons between failed and successful candidates, for a separately authorized training process | Not implemented; no model-weight update or training integration |

For researchers, the persisted unit is an **experiment record**, not a camera clip. Linked repair records capture the submitted mission and failure context, tool arguments/results, candidate source/hash and available evaluation outcomes; baseline records preserve the scene, complete returned starting checkpoint and measured trajectory. Both failures and successes matter. Records capture the implemented workflow from this point onward; they do not reconstruct unrecorded earlier revisions or guarantee that every desired research label is present.

### What would count as improvement?

A stronger coordinator should complete more tasks **without increasing violations**. A useful study would report first-attempt success, success within a fixed repair budget, violations by type, completion time, and model cost across a declared test set. A controller that reduces collisions by never moving must fail the completion criterion.

To test whether accumulated examples help Astra, compare the same model and tool budget with and without those examples. Keep evaluation scenes out of retrieval and training. Split by layout and constraint family, not just nearby random seeds, and retain unsuccessful repairs in the results. Four held-out starts in one geometry do not establish transfer to other environments.

The archive/export layer supplies records for such a corpus, but reproducibility checks, dataset splits, label review and study design still require deliberate work. An evaluator can consistently reward the wrong specification. No automatic retrieval into later repairs, model-weight training, corpus publication or off-host backup is performed by the current application.

The intended contribution is a testable connection between **what the person required, what the controller did, what Astra changed, and whether the change held up**. That can support narrower, measurable reductions in coordination failures. It cannot, on its own, establish that Astra understands every human preference or is generally aligned.

## Get started

### Requirements

- Git, Node.js 22+, npm, and Python 3.12.
- A desktop browser with WebGL. No physical robot or server GPU is required for the current CPU-policy simulation.
- A funded server-side OpenAI API key with access to `gpt-6-astra` for generated repairs. The simulator/UI work without one; no mock repair is substituted.
- For camera input: camera permission and HTTPS. Advanced manual calibration needs a fixed mount and measured floor dimensions; automatic spatial tracking additionally requires explicit selected-frame sharing consent and a configured Modal worker. Your computer's localhost is not the phone's localhost.
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

Astralignment is a standalone project. The pretrained G1 policy, model, and meshes originate from Unitree's `unitree_rl_gym`; their BSD-3-Clause license and pinned provenance are retained. Astralignment does not claim to have trained the walking policy. See [source and model attribution](sim/ATTRIBUTION.md) for inherited components and new implementation boundaries.
