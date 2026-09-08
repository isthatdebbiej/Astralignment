# Astralignment: executable coordination repair for two physical humanoid models

This build tests whether generated coordination can complete two robot goals while respecting a human corridor. Walking alone is not success: the independent evaluator also checks contacts, falls, keepout intrusion and stage boundaries. A stopped pair that never completes fails too. This is a simulation experiment, not a claim of general alignment or certified physical safety.

## Implemented source architecture

| Component | Actual source | Responsibility |
| --- | --- | --- |
| Shared simulation | `sim/world.py`, `sim/scene.py` | Two namespaced Unitree G1 bodies in one MuJoCo world; one 500 Hz physics clock; independent learned-policy state per robot at 50 Hz |
| Simulation API | `sim/server.py` | Loopback 8001; state stream, reset, checkpoint/fork, bounded branch stepping and results |
| Fixed evaluator | `sim/evaluator.py` | Reads physics metrics and requires both goals without measured violation; generated code cannot edit it through its runtime |
| Generated coordinator | `gateway/policy.ts`, `gateway/policy-worker.mjs` | Validated source executes in QuickJS/WASM worker; returns two bounded commands and explicit memory |
| Branch evaluation | `gateway/sim-client.ts` | Fresh sandbox, checkpoint fork, coordination every 0.2 simulated seconds, independent result, branch cleanup |
| Astra repair | `gateway/astra.ts`, `gateway/store.ts` | Model tool loop, bounded candidate testing, source hash, actual evaluator feedback, budget accounting |
| Product | `web/src/App.tsx`, `web/src/product/`, `web/src/viewer/SimulationStage.tsx` | Scene controls, results, provenance, authoritative pose rendering, separate replay/reference labels |
| Live camera | `gateway/camera.ts`, `web/src/camera/`, `web/src/phone/` | Expiring pairing, WebRTC signaling, explicit phone capture, measured floor calibration |
| Deployment | `deploy/` | Ubuntu/Caddy templates; no provisioned host is implied |

The robots have free physical bases and twelve actuated leg joints each; upper bodies are fixed model assemblies. Joint targets, PD torques, gravity and contacts move them. Rendering does not animate their root positions. Reset/checkpoint restore is distinct from movement. Coordinates are meters, right handed, Z up, with the stage centered in XY.

Generated coordination runs at a slower 0.2 s interval and chooses go/wait, bounded speed and optional waypoint. Waiting retains the learned balance controller. The immutable admission layer bounds commands; it does not guarantee navigation safety. The fixed evaluator makes that distinction observable.

## Camera and measured geometry

The phone route is `/phone?session=...`. The user explicitly starts the rear camera, without microphone audio. The desktop remains the peer while its camera panel is hidden. The gateway exchanges SDP/ICE; it does not upload or record continuous video. TURN may relay encrypted media. Sending selected frames to a model is a separate feature and is not implied by pairing.

The calibration UI captures a local still, accepts four normalized floor corners and manually measured width/depth, asks for confirmation and posts a bounded calibration object. The gateway validates a convex quadrilateral and stores one in-memory record, calling the root geometry callback before accepting it. `web/src/camera/homography.ts` computes the projective mapping and inverse: near-left, near-right, far-right and far-left image corners map to the centered XY rectangle. The pure mapping has corner and round-trip tests. Camera movement requires recalibration. The mapping is available for integration; image-to-world overlays are not implemented. Do not describe this as automatic reconstruction of obstacles, heights, people or arbitrary 3D geometry from video.

## Evidence and remaining gates

Four camera tests passed: message validation, convex calibration validation, homography mapping/round-trip, and real WebSocket origin/expiry/late-join/relay/disconnect plus ICE configuration authorization. Full TypeScript checking also passed. `npx playwright test tests/browser/camera.spec.ts --workers=1 --reporter=line` passed in desktop Chrome (44.1 seconds): a clearly synthetic canvas source traversed real two-tab WebRTC, both peer connections reached connected, the receiver decoded changing red/green frames, and explicit stop ended tracks and closed connections. The test never requests a physical camera or microphone. These results do not establish that actual iPhone media works. iPhone Safari over HTTPS, permission denial, lock/background behavior, cellular/TURN and deployment remain explicit QA gates.

Physics, end-to-end repair and held-out pass counts must come from their actual recorded runs. A built-in reservation coordinator is a labeled reference, never a fabricated Astra repair. A counterexample is an actual evaluator failure from a recorded scene/checkpoint. A repaired source hash passing that scene establishes only that scene result; held-out runs must reuse the frozen source and publish failures as well as successes.

DimOS is a gated Ubuntu integration, not installed or verified by these files. The local simulation has no Mori runtime dependency; selected copied upstream assets and adapter equations are attributed in `sim/ATTRIBUTION.md`. Gateway route integration was still in progress when this file was authored; see current source and final verification log before asserting full readiness.
