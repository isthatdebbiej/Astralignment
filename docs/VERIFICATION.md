# Verification evidence and open gates

For current funded API and Docker results, see **September 8 deployment update**
at the end. Earlier entries are retained as a chronological engineering record.

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
# September 8 deployment update

This update supersedes earlier API-funding and deployment-blocked entries above.

- Real funded `gpt-6-astra` repair ID `e45b913f-f708-4872-9b7b-a35ad1f13306`.
- Frozen source SHA-256 `3aacc05bdaf0ab3bed0fd9bc81b51650e89f395b7dfdc73c1af9be1754d500a3`.
- Both goals completed in 18.8 simulated seconds; minimum separation 1.7676195578 m;
  zero evaluated contact, human-zone, boundary, fall, and deadlock violations.
- Exact replay matched 95 frames. Four held-out seeds passed without further
  source changes or model calls: 104736, 209465, 314194, 418923.
- Total local estimated API spend including probe: $0.525265. This is an
  application-side token estimate, not a billing receipt.
- Vultr Ubuntu 24.04: Docker Compose installed; separate CPU MuJoCo, gateway,
  Caddy/static-web containers running. Let's Encrypt issued a trusted certificate
  for `astralignment.64.177.14.149.sslip.io`; public HTTPS returned 200.
- Unauthenticated API returned 401; operator-authenticated access succeeded.
- Container smoke verified healthy simulator, two robots, matching model/state
  episode UUID and scene epoch.
- Current gateway/projection test run: 22 passed, zero failed.
- Remote TURN test: `npx playwright test tests/browser/turn.spec.ts --workers=1
  --reporter=line`, passed in 7.2 seconds. Both selected ICE candidates were
  relays; decoded synthetic 320×240 video changed red to green, and a data channel
  delivered payload. No real camera, API call, or credential-bearing trace used.
- Overlay desktop tests passed locally (15.4 s) and on deployed HTTPS (15.1 s):
  `tests/browser/overlay.spec.ts`. Both rendered 54/54 robot mesh instances over a
  separate changing WebRTC video element; canvas had opaque robot pixels and a
  transparent background. Authoritative physics poses advanced, and disconnect
  cleared robot pixels. Screenshots were inspected. This is synthetic camera QA,
  not evidence of accurate physical-phone calibration.
- Still open: physical iPhone alignment and server-side API access. Native DimOS
  validation is tracked independently below as its integration checks complete.
- Native DimOS observation and control smoke passed on Vultr. One real worker
  receives typed LCM poses and ticks. A clearly labeled trusted control fixture
  delivered 30 native commands and moved robot A 0.425453416 m in authoritative
  physics; commands expired to zero, then control was disabled and world paused.
  The native codec test preserves simulation timestamp zero. This fixture is
  not an Astra-generated policy. All five Compose services were running;
  simulation and DimOS reported healthy.
- Clean navigation: local desktop test passed in 10.0 s; deployed HTTPS test
  passed in 9.0 s. Default sidebars/inspector/timeline are hidden; stage width
  exceeds 90% and height exceeds 65% of the 1512×982 viewport. Setup Escape and
  focus restoration, inspector switching, timeline toggling, and World/Camera
  switching passed with no page errors.
- Final clean-layout overlay regression passed on HTTPS in 18.1 s. The same
  receiver tracks remained live across all view/panel toggles. After physics
  advanced, both robots were visibly rendered in the reviewed screenshot;
  post-run alpha/readiness checks prevent an earlier screenshot timing race.
  Scene and previous calibration were restored. Synthetic camera only.
