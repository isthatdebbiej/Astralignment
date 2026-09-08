# Astralignment — Fork & Teach Live

A six-hour hackathon build: stream a measured stage from an iPhone, place two Unitree G1 humanoids in a shared MuJoCo world, and use GPT-6 Astra to inspect and repair their coordination.

Two real pretrained-policy G1s share one MuJoCo world. A developer workbench captures failures, freezes physics and recurrent-policy state, and evaluates executable coordination repairs. No real-world robot control or general alignment guarantee is claimed.

## Run locally

Requirements: Node 22+, Python 3.12, and a funded OpenAI API key for runtime Astra. The simulation and workbench work without an API key; generated repairs do not have a mock fallback.

```powershell
npm ci
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe -m sim.server
```

In another terminal, set server-side `OPENAI_API_KEY` securely and run `npm run dev`. Open `http://localhost:5173`. Never use `VITE_` variables for secrets. `npm run build` creates `dist/`; `npm start` serves it through the gateway. The gateway reads process environment, not `.env` automatically.

## What is real

- Unitree G1 TorchScript locomotion at 50 Hz; both robots integrated together at 500 Hz.
- Frozen MuJoCo integration state plus independent LSTM buffers, actions, phase, scheduler and RNG.
- Independent baseline search, real contacts and fixed evaluator; an authored reservation reference is explicitly labeled.
- Astra writes executable JavaScript coordination. A separate QuickJS/WASM worker exposes no host filesystem, network, imports or credentials. Commands are bounded outside the generated code.
- Continuous phone WebRTC capture, expiring QR pairing, measured planar calibration and tested projective mapping. Human-confirmed annotations create real collision boxes; optional Astra still-image suggestions require review. HTTPS and actual-device verification are required remotely.
- Real-source replay and held-out seeded scenes; changing scene epochs invalidates old evidence.

## Current verification and gates

Production build, desktop workbench QA, synthetic two-browser camera/annotation tests, and real two-humanoid physics tests have passed during implementation. A labeled human-authored coordination fixture completed both goals with zero measured violations and exactly replayed 76 frames through the actual sandbox-to-MuJoCo path. This is not an Astra-generated result. See the verification ledger for commands, scope and remaining gates.

The configured API account returned **429: no credits remaining** on the initial access probe. Runtime repair generation remains unverified until a funded key is available. Browser/device and deployment checks are reported separately; no phone or Vultr deployment is implied by a successful build.

## Documentation

- [Complete technical specification](docs/TECHNICAL_SPEC.md)
- [Implemented architecture](docs/IMPLEMENTATION.md)
- [Verification evidence and open gates](docs/VERIFICATION.md)
- [Six-hour runbook](docs/SIX_HOUR_RUNBOOK.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Policy choices](docs/POLICIES.md)
- [Ubuntu / HTTPS deployment](deploy/README.md)
- [Unitree attribution](sim/ATTRIBUTION.md)

This is a reproducible human–robot coordination failure/repair workbench, not a claim that a six-hour demo solves alignment, reconstructs arbitrary video physics, or trains new locomotion.

## Build ownership

- Root: contracts, Node gateway, Astra integration, evidence, integration, Git.
- Physics agent (high): `sim/`, `tests/sim/`, `requirements.txt`, copied Unitree assets.
- Product agent (high): `web/src/product/`, `web/src/viewer/`, `web/src/App.tsx`, `web/src/styles.css`.
- Camera agent (low): `web/src/camera/`, `web/src/phone/`, `gateway/camera.ts`, `deploy/` templates.

The local project is self-contained. Selected prior foundations may be copied, but never import or run Mori as a dependency.
