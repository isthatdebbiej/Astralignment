# Simulation source and model attribution

Astralignment is a standalone project, not part of Mori. The references below
record the history of reused components, not a product affiliation or runtime
dependency.

Selected G1 assets were copied from the local Mori checkout's
`sim/models/unitree_g1` with permission, including the original BSD-3-Clause
LICENSE, upstream README, pinned provenance, model XML, STL meshes, policy
configuration and TorchScript policy. The source is Unitree Robotics'
`unitree_rl_gym`, commit `276801e46c5d433564f24658bac64f254b7d2d4b`.

The 47-dimensional observation layout and PD control equations in `world.py`
were adapted from Mori's selected `sim/adapters/g1.py`, which attributes
Unitree's `deploy_mujoco.py`. Shared model composition, namespaced indices,
per-robot recurrent policy ownership, checkpointing, contacts, service, and
reference coordination are Astralignment implementations. Astra does not
import, start, or otherwise depend on Mori.

The G1 model has a free physical base and 12 actuated leg joints. The upper
body is a fixed model assembly. Root position is set only at episode reset
or complete physics checkpoint restore. Ordinary movement is produced by
the walking policy's joint targets, PD motor torques, gravity, and contacts.

`reservation` is a conservative built-in reference coordinator, not an
Astra-generated program and not a certified safety controller. It gives
one robot stage access at a time. `external` accepts bounded expiring
velocity commands; generated code is never executed in this service.

Keepout and stage-boundary checks use a conservative horizontal disc with
0.45 m radius around the pelvis projection. This catches intrusion before
the pelvis point crosses a line and approximates personal clearance. It
is not a proof that every articulated body is contained in that disc,
particularly during a fall. MuJoCo inter-robot and obstacle contact checks
separately use the actual physical collision geometry. Spawn and goal
admission applies the same 0.45 m clearance to keepouts and obstacles.
