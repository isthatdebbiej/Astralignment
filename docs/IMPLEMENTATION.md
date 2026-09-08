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

The calibration UI captures a local still, accepts four normalized floor corners and manually measured width/depth, asks for confirmation and posts a bounded calibration object. The gateway validates a convex quadrilateral and stores one in-memory record, applying the proposed scene layout before accepting it. `web/src/camera/homography.ts` computes the projective mapping and inverse: near-left, near-right, far-right and far-left image corners map to the centered XY rectangle. The pure mapping has corner and round-trip tests. Camera movement requires recalibration.

`ObstacleAnnotation.tsx` uses two human-selected ground corners and a separately confirmed height to create an axis-aligned MuJoCo collision box. Moving a prop replaces its same-ID box; explicit removal removes that simulated object. Every accepted edit resets the scene and advances its epoch, invalidating old checkpoints. The simulator atomically rejects stale expected epochs. Actual model geometry and body height were verified through a browser-to-physics test.

An optional, explicit **Ask Astra** action sends only the selected still to `gateway/observe.ts`. Astra can propose normalized ground corners with uncertainty; it cannot infer trusted height or apply geometry. The user must review and confirm. This model path is implemented but has not completed a real API request because the configured account lacks credits. Continuous video is not sent to the model. This is human-confirmed planar grounding, not automatic reconstruction of people or arbitrary 3D physics from video.

## Evidence and remaining gates

Focused camera, auth, observation-schema and sandbox tests pass, as does TypeScript checking. Desktop Chrome tests verify real two-tab WebRTC using a clearly labeled synthetic canvas, changing decoded pixels, explicit stop, and human-confirmed obstacle add/move/remove through real physics. The tests never request a physical camera or microphone. These results do not establish actual iPhone media behavior. iPhone Safari over HTTPS, permission denial, lock/background behavior, cellular/TURN and deployment remain explicit QA gates. See `VERIFICATION.md` for exact commands and reported results.

Physics, end-to-end repair and held-out pass counts must come from their actual recorded runs. A built-in reservation coordinator is a labeled reference, never a fabricated Astra repair. A counterexample is an actual evaluator failure from a recorded scene/checkpoint. A repaired source hash passing that scene establishes only that scene result; held-out runs must reuse the frozen source and publish failures as well as successes.

DimOS is a gated Ubuntu integration, not installed or verified by these files. The local simulation has no Mori runtime dependency; selected copied upstream assets and adapter equations are attributed in `sim/ATTRIBUTION.md`. Gateway-to-physics execution is verified with an explicitly human-authored fixture, not a fabricated model response. Live Astra repair and source-frozen held-out results require funded API access.
