# Verification evidence and open gates

Build T0: 2026-09-08 18:22 UTC. Six-hour deadline: 2026-09-09 00:22 UTC. Results below describe actual runs, not planned milestones. Later edits require their own checks.

## Confirmed runs

| Scope | Actual result | Command / evidence |
| --- | --- | --- |
| Full physical simulation suite | Final run: 15 passed, 14 dependency-deprecation warnings, 71.56 s; exit 0 at 19:58:07 UTC | `.venv/Scripts/python.exe -m pytest tests/sim -q --tb=short` |
| Model/state identity addition | 1 passed, 3 dependency warnings, 19.35 s at 19:45:37 UTC | `tests/sim/test_service.py::test_service_checkpoint_branch_and_stale_invalidation` |
| Gateway and product consistency tests | Final run: 19 passed, 0 failed, 4.384 s; includes restart UUID, observation identity and hydration races | `npm test` |
| TypeScript and production bundle | Final build passed; 840.96 KB JavaScript / 232.71 KB gzip, 36.83 KB CSS | `npm run build` |
| Sandbox → real MuJoCo integration | 2 passed, 0 failed, 29.8096 s; exit 0 at 19:26:09 UTC | `node --import tsx --test tests/integration/policy-sim.test.ts` |
| Desktop product journey | Final pass after identity fixes: Chrome 1512×982; 54/54 meshes, 321 sampled colors, real physics tick 0→600, zero page/console/network errors | `node web/src/product/desktop-qa.mjs journey`; local `artifacts/qa/desktop-journey.json` and screenshots |
| Desktop WebRTC transport | 1 passed in 44.1 s; real peer connections, changing decoded pixels and explicit stop | `npx playwright test tests/browser/camera.spec.ts --workers=1 --reporter=line` at transport checkpoint |
| Desktop annotation → real physics | Final run on UUID-guarded services passed in approximately 1.2 min: add, move, remove, epoch advance and stale checkpoint rejection | Same browser test command after final origin-identity integration |
| Small measured stage | Real API test passed for 4×3 m, including ≥0.45 m goal/presenter-strip clearance; original scene restored | `node --import tsx --test tests/integration/camera-calibration.test.ts` |
| Runtime Astra access | Initial real access probe rejected with HTTP 429: no credits remaining | One API probe; no successful model repair/vision request |

Simulation warnings concern Starlette/httpx, AnyIO and TorchScript dependency deprecations; they are not silently suppressed. The Vite production build reports a >500 KB chunk advisory. No mobile loading or performance benchmark is claimed. One intermediate unit run failed because an older valid-observation fixture lacked the newly required episode UUID; the fixture was corrected and all 19 tests passed on rerun.

## Physics and executable-source evidence

The integration test uses an explicitly **HUMAN-AUTHORED TEST FIXTURE, NOT ASTRA**. It passes through the same isolated QuickJS source runtime, bounded command admission, branch API and fixed evaluator intended for generated code. From the frozen MuJoCo integration state plus both recurrent-policy states:

- 76 recorded frames replayed exactly, including metrics, robot states and body poses.
- Both goals completed in 15.2 simulated seconds.
- Minimum separation was 1.8195316857963877 m, with zero measured robot/obstacle contact, keepout/boundary entry, falls or deadlock.
- The live world was unchanged by branch evaluation; a stale checkpoint returned 409 cleanly.
- Fixture source SHA-256: `df855e54e0f0be70c3c1e391b5c6994ce86ea55e3edc07255aeec5f2e7771b1c`.
- Frozen-state SHA-256 for this run: `c2947346e6c318f3b66fa9123347b5a4d129cf24456b2dd5c48c0c48ef92935b`.

The test initially exposed an unhandled worker-readiness rejection when a stale checkpoint prevented forking. Sandbox construction now follows successful fork creation; close also settles readiness and clears the timer. A regression test and the integration rerun pass.

An earlier integrated search on the previous default scene found both goals completed alongside **833 contact physics timesteps** (1.666 s total contact occupancy), zero falls, 52 recorded frames and 10.1 simulated seconds. Do not attach those numbers to a later epoch. Current human-left-corridor baseline/reference tests separately establish inter-robot contact under independent control and zero measured violations with the authored reservation reference. Neither baseline nor reference is labeled Astra-generated.

## Camera, geometry and browser evidence

The camera browser test overrides `getUserMedia` with a labeled synthetic canvas before either app page loads. It uses two actual app pages, the phone sender route, authenticated ICE configuration and real `RTCPeerConnection`s. The receiver decodes red pixels and subsequently green pixels; explicit stop ends tracks and closes connections. No physical webcam or microphone is accessed. Pairing traces, videos and screenshots are disabled to avoid retaining bearer links.

The annotation test confirms an 8×6 m planar calibration, creates an actual MuJoCo box with body Z=0.4 m for a confirmed 0.8 m height, observes epoch advance, verifies old-checkpoint fork 409, moves the same ID without duplication, removes it explicitly, and restores the original scene in `finally`. Synthetic calibration metadata remains in the gateway's memory because there is no metadata-only clear API; a real phone demo must freshly calibrate its own measured floor. Browser pointer quantization allows 2 cm world-coordinate tolerance; pure homography tests use tight numerical tolerances. The separate 4×3 m test covers the smaller layout's clearance correction. The presenter strip is an authored proposed keepout requiring human confirmation, not a detected person.

Desktop product QA covers complete robot meshes, nonblank canvas, real run/pause, timeline recorded/live transitions, random spawns, orbit/reset, wireframe, inspector tabs, mounted camera-modal controls and an intentionally disconnected 503 state. Earlier favicon/loading and timeline failures were fixed before the passing run. The final journey ran after source/scene-identity fixes, and root and the product lane visually inspected its screenshot. Local evidence is in `artifacts/qa/desktop-inspect.png`, `desktop-journey-final.png`, `desktop-disconnected.png` and corresponding JSON. Artifacts remain outside Git.

## Security and admission scope

Focused tests cover trusted loopback, foreign origins, spoofed localhost Host, public operator authentication, Secure/HttpOnly/SameSite=Strict cookies, invalid-token throttling, origin-bound pairing expiry, relay/disconnect behavior and authenticated ICE configuration. Test tokens are labeled fixtures, never deployment secrets.

Camera and observation tests cover convex calibration, homography round trips, bounded selected JPEG metadata and untrusted proposal schemas. Generated-code tests execute QuickJS, preserve explicit returned memory, reject host `process`/`require`, interrupt an infinite loop, and reject duplicate or overspeed commands. These are regression checks, not a formal sandbox security proof or real-world safety certification.

## External gates — not completed

- **Funded Astra API:** the initial probe was rejected for no credits. Its provisional $3 reservation was corrected to $0; no other model request was made. No fresh Astra-generated repair, vision proposal or generated-source held-out result has been established. An authored fixture pass cannot substitute for this.
- **Actual iPhone Safari:** HTTPS, permissions, rear camera, orientation, background/lock, reconnect and cellular/TURN need the user's device. Synthetic desktop success is not device proof.
- **Vultr deployment:** service/Caddy templates exist, including writable durable runtime state. The approved host/SSH configuration and HTTPS hostname have not been supplied. No public deployment, DNS/TLS or TURN rollout is claimed.
- **Native DimOS:** the pinned optional adapter and unavailable-state checks exist; Ubuntu installation, LCM streams and runtime heartbeat still require actual verification.
- **Broader QA:** mobile layout, performance profiling, production-device load and visual regression matrices were not run.

Preserve failures and scene/source hashes. Same-scene success is not held-out success. Do not count trials that never ran, change the evaluator to promote a candidate, or present reference/recorded data as fresh model output.
