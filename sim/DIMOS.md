# Optional native DimOS bridge

The simulation works independently of DimOS. The optional bridge is a real
`dimos.core.module.Module` with typed `In`/`Out` streams, native
`LCMTransport`, and `ModuleCoordinator` worker deployment. It publishes the
authoritative live G1 poses and shared physics tick, and can accept bounded
world XY velocity commands. It never steps physics itself.

Target: Ubuntu 22.04/24.04, Python 3.12, **DimOS 0.0.12** in a separate
environment. The Windows build reports this bridge unavailable. No native
DimOS execution has been verified on the Windows development host.

## Installation and launch on Ubuntu

Follow the upstream [Ubuntu system-dependency guide](https://github.com/dimensionalOS/dimos/blob/v0.0.12/docs/installation/ubuntu.md)
for the target machine. Then, from the Astra checkout:

```sh
uv venv .venv-dimos --python 3.12
uv pip install --python .venv-dimos/bin/python -r sim/requirements-dimos.txt
.venv-dimos/bin/python -m sim.dimos_bridge --status
.venv-dimos/bin/python -m sim.dimos_bridge --sim-url http://127.0.0.1:8001
```

The default is observation only. `--allow-control` explicitly selects
external control on the simulation and permits incoming Twist commands.
No physical hardware is connected by this bridge.

| LCM topic | Native message | Meaning |
| --- | --- | --- |
| `/astra/g1_a_pose` | `PoseStamped` | Actual robot A pelvis pose |
| `/astra/g1_b_pose` | `PoseStamped` | Actual robot B pelvis pose |
| `/astra/world_tick` | `Int32` | Actual shared 500 Hz physics tick |
| `/astra/g1_a_command` | `Twist` | World XY velocity for robot A |
| `/astra/g1_b_command` | `Twist` | World XY velocity for robot B |

Poses use `astra/world`, metres, Z up, and actual simulation timestamps.
The bridge converts the API's WXYZ quaternions once to the native
PoseStamped constructor's XYZW orientation. Commands must be finite,
norm <= 0.7 m/s, with zero vertical and angular components. Incoming
commands expire after 0.3 s; the simulation independently enforces its
command lease. Local multicast is intended for a trusted robot network.

`GET /dimos/status` distinguishes local dependency availability from a
recent bridge-reported heartbeat. A heartbeat is integration telemetry,
not a cryptographic attestation. Inactive or missing bridges are never
reported as active. The local simulator endpoint must be reachable from
the Ubuntu environment; a Windows loopback listener is not automatically
reachable from WSL or a remote host.

## Verified upstream API references

Implementation was checked against the pinned v0.0.12 source, not current
main-branch examples:

- [Module and ModuleConfig](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/core/module.py)
- [In, Out and stream subscribe/publish](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/core/stream.py)
- [LCMTransport](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/core/transport.py)
- [ModuleCoordinator lifecycle](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/core/coordination/module_coordinator.py)
- [PoseStamped](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/msgs/geometry_msgs/PoseStamped.py)
- [Twist](https://github.com/dimensionalOS/dimos/blob/v0.0.12/dimos/msgs/geometry_msgs/Twist.py)

Ubuntu verification must prove ModuleCoordinator deployment, receipt of
fresh pose/tick messages on native LCM, and command expiry affecting actual
simulator policy inputs. Importing the bridge or testing helper admission
alone is not evidence of native runtime integration.

## Isolated Docker service

`deploy/Dockerfile.dimos` installs the pinned native package without optional
agent/perception/hardware extras. Its upstream core still requires Open3D,
Pinocchio and Rerun; this is not a tiny image. The service runs unprivileged,
with one real `ModuleCoordinator` Python worker. It needs no Docker socket,
GPU, camera device, API key, host network, or robot hardware. Physics and
TorchScript remain owned by the separate MuJoCo service.

Set `SIM_URL=http://sim:8001`. Internal HTTP listens on port 8003. Do not
publish this unauthenticated operator-control port to the Internet; only
authenticated gateway routes or trusted internal operators may access it.
LCM multicast is confined to the container network namespace with TTL 0.
Keep the root-owned Compose configuration's default observation mode.

| Internal route | Function |
| --- | --- |
| `GET /health` | 200 only after both native pose topics and tick topic are fresh; otherwise 503 |
| `GET /state` | Native LCM receipt counters, per-topic age, actual poses, shared tick and worker status |
| `POST /control {"enabled":true}` | Explicitly select external simulator mode and admit native commands |
| `POST /control {"enabled":false}` | Stop native commands; does not reset or pause the world |
| `POST /commands {"commands":{"g1_a":[0.3,0],"g1_b":[0,0]}}` | Publish native typed Twist messages to the worker; omitted robots stop |

The facade does not read `/state` directly. Its robot poses and tick come
from actual `LCMTransport` subscriptions in a process separate from the
bridge worker. `received_counts` are receipt evidence, not merely publish
counters. HTTP command acceptance means publication; increasing
`bridge.commands_received` demonstrates native receipt by the worker.
Both admission layers require finite XY commands <= 0.7 m/s. The native
receipt lease expires after 0.3 seconds; the simulator has its own 0.3-second
lease. Scene/episode identity changes automatically disable native control.
Pose and tick topics arrive separately: `/state` reports
`atomic_snapshot:false`; use the simulator's state for atomic evaluation.
The pinned convenience `PoseStamped.lcm_decode` replaces a zero timestamp
with wall-clock time through its constructor. The facade therefore uses
the native generated `dimos_lcm.geometry_msgs.PoseStamped` wire decoder
on pose subscriptions and reads the original header stamp directly. Its
small native subclass preserves the convenience wrapper's `msg_name`,
because DimOS appends that name to the actual LCM channel string. This
preserves true simulation time zero without changing upstream code or
inventing a timestamp offset.

Build and run using the root deployment instructions, then execute:

```sh
docker compose exec -T dimos python -m sim.dimos_smoke
```

This default test is observation-only. It requires fresh native messages
from both robots and the shared tick, and checks exact authoritative poses
when the world is paused. For an explicitly authorized disposable/paused
world, the following mutating test publishes Twist commands, checks real
policy-input changes, actual movement, native receipt counters and expiry,
then disables native control and pauses. It does not restore previous poses.

```sh
docker compose exec -T dimos python -m sim.dimos_smoke --exercise-control
```

That control test is a trusted authored integration fixture, not an
Astra-generated policy or a demonstration of safe coordination. Native
runtime success must be reported from actual container output; the Windows
admission tests alone do not verify this path.
