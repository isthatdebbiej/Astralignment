# Policy provenance and execution boundaries

## Learned locomotion

The vendored source is [Unitree Robotics unitree_rl_gym at commit 276801e46c5d433564f24658bac64f254b7d2d4b](https://github.com/unitreerobotics/unitree_rl_gym/tree/276801e46c5d433564f24658bac64f254b7d2d4b). Its documented MuJoCo path supports pretrained G1 inference. This checkout preserves the upstream license and records each vendored file in `sim/models/unitree_g1/provenance.json`.

| Artifact | Upstream path | Recorded SHA-256 |
| --- | --- | --- |
| TorchScript walking policy | `deploy/pre_train/g1/motion.pt` | `cf668f75b90d1abf73d2b87612a6e76bccc61ff7e083b63582d3f6aaa3c1759d` |
| G1 physical model | `resources/robots/g1_description/g1_12dof.xml` | `747ede40aa726b7352bae8353e95d0d0f908cec2257a27cbd78bc6e5a2d5a314` |
| Policy configuration | `deploy/deploy_mujoco/configs/g1.yaml` | `73044e7d355c61915695c16d6e09eb3efef46eec1e3d708fd3eb9157dfe3bbbb` |

These are the manifest's recorded hashes; runtime additionally hashes the policy and model. Selected files were copied through the authorized local Mori checkout; `sim/ATTRIBUTION.md` records adapter provenance. There are no Mori imports. Each robot/branch owns independent recurrent state. The 50 Hz policy outputs joint targets; MuJoCo runs at 500 Hz.

The six-hour scope reuses this pretrained locomotion baseline. Training a new walking policy would introduce training, export and validation work unrelated to the coordination claim. ASAP motion tracking would change the motion objective and introduce a separate integration/validation path; it is not implemented or claimed here. Neither is a fallback explanation for animated meshes or wheeled substitutes.

## Generated coordination

The runtime requests plain JavaScript `coordinate(input)` and invokes it every 0.2 simulated seconds. Source is limited to 40,000 characters, input to 100,000 serialized characters and persistent returned memory to 8,000 serialized characters. Output must contain exactly one valid command for each G1. Speed is at most 0.55 m/s; admitted waypoints remain inside the stage.

`policy-worker.mjs` creates a fresh QuickJS runtime/context for each call, exposes no filesystem/network/process/module-loader host functions, disables Date and nondeterministic Math.random, limits QuickJS memory to 8 MiB and stack to 256 KiB, interrupts after about 80 ms and limits serialized output to 16,000 characters. The Node worker has separate resource limits and a one-second host timeout. These limits reduce untrusted-source risk; they are not a claim that the entire deployment is formally secure.

Source and explicit memory may change during repair. The model cannot modify `sim/evaluator.py` through this runtime. The evaluator requires both goals and rejects measured contacts, falls, keepout/boundary violations and timeout. The horizontal 0.45 m pelvis envelope used for keepout clearance approximates personal clearance; it is not a proof that all articulated geometry fits inside that disc, especially during a fall. Physical contacts are separately checked by MuJoCo.

`independent` and `reservation` are built-in comparison modes. `reservation` is an authored conservative reference. `external` receives admitted generated commands. Only actual source-hashed candidate runs may be labeled Astra repair. Freeze source for held-out evaluation, invalidate prior scene-specific claims after geometry edits and retain unsuccessful results.

## Access and camera

Public operator API access uses `ASTRA_OPERATOR_TOKEN` to obtain an HttpOnly cookie, with `PUBLIC_ORIGIN` enforcing the browser origin. Phone signaling uses a random 192-bit pairing token bound to the initiating origin, expires in 30 minutes and accepts only bounded signaling messages. Pairing links are private bearer credentials. Never log or publish them. Actual video starts only after phone consent and stops explicitly; no microphone audio is requested.

The ICE configuration endpoint requires an unexpired pair token in the Authorization bearer header and a matching browser Origin or Referer origin. Tests reject missing tokens, wrong origins and expired sessions. Paired browsers necessarily receive configured TURN credentials; use short-lived credentials where supported and avoid static long-lived relay credentials. Caddy/HTTPS, TURN behavior and an actual iPhone check are release gates. The current files do not certify those deployment gates as passed.
