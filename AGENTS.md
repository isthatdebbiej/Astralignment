# Astralignment implementation rules

Six-hour build, not ten. Preserve two G1 humanoids and continuous camera input. Do not silently substitute animated meshes, wheeled bases, or recorded footage for working features.

Use GPT-6 Astra. Effort is assigned per lane. Work only in your assigned subsystem; root owns shared contracts, dependency manifests except requirements.txt, integration, commits and pushes. Do not commit independently.

Use apply_patch for code edits. Never read or commit secrets. Follow sandbox approvals. Copy relevant Mori code/assets if useful, preserve source attribution, but remove Mori imports and never run Mori as a dependency.

Shared spatial contract: meters, right handed, Z up, XY stage plane. API coordinates and MuJoCo use this basis. Three.js sets camera.up to (0,0,1) rather than scattering basis conversions. Physics is authoritative; rendering does not move robots.

Python simulation service: port 8001. Node gateway: port 8787. Vite frontend: port 5173, proxy /api and /ws to gateway. Root will provide shared TypeScript contracts in contracts/index.ts. Build against those interfaces and send proposed changes to root.

Real G1 policy at 50 Hz, MuJoCo physics at 500 Hz. One shared physics clock; independent recurrent policy state per robot and per branch. Generated coordination code must never execute unsandboxed on the host. Independent evaluator cannot be modified by runtime Astra.

Show real live/reference/error modes and source/model provenance. No fake telemetry, fabricated pass rates, or prerecorded outputs presented as fresh. Seeded fixtures are permitted only when explicitly labeled fixture/reference.

Run focused tests. Desktop browser QA was approved by user; actual iPhone QA requires the user's device and a separate check. Do not claim tests ran when they did not.
