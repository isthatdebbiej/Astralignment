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
