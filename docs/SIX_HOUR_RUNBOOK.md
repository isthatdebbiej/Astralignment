# Six-hour build and verification runbook

T0 is 2026-09-08 18:22 UTC. The six-hour deadline is 2026-09-09 00:22 UTC. These are planned time boxes, not assertions that a milestone passed at that time.

| Window | UTC | Work and exit evidence |
| --- | --- | --- |
| T+0–1h | 18:22–19:22 | High-effort physics lane establishes two real G1 models, pinned policy and shared clock; high-effort product lane builds the workbench; high-effort root lane implements contracts/runtime; low-effort camera lane adds pairing/deploy templates |
| T+1–2h | 19:22–20:22 | Integrate simulation API, authoritative rendering, checkpoint branches, camera signaling; record unit/type checks |
| T+2–3h | 20:22–21:22 | Obtain an actual independent-controller failure and a same-checkpoint reference comparison; fix physics or contracts before model runs |
| T+3–4h | 21:22–22:22 | Run bounded Astra repair; inspect executable source, hash and independent feedback; no generated success substitute |
| T+4–5h | 22:22–23:22 | Frozen-source held-out scenes; desktop media and UI QA; deploy only to an approved host with DNS/HTTPS |
| T+5–6h | 23:22–00:22 | Real-device camera gate if device available; regression, final evidence, limitations and demo rehearsal |

## Local start

From the repository root, create/activate a Python 3.12 virtual environment and install `requirements.txt`. Install Node 22 dependencies with `npm ci` once a lockfile exists. Start the simulation in one terminal:

```sh
python -m sim.server
```

Start gateway and Vite in a second terminal:

```sh
npm run dev
```

The simulation binds 127.0.0.1:8001, gateway uses 8787 and Vite uses 5173 with `/api` and `/ws` proxies. Local commands require the gateway entrypoint to be present; do not mistake a compiling frontend for a running system. Run `npm run typecheck`, `npm test` and `python -m pytest tests/sim` and retain actual output. `npm run build` produces root `dist/`.

## Public access gate

Use `deploy/Caddyfile` and the environment template only after the host is authorized. Set exact `PUBLIC_ORIGIN=https://your-host` and a private strong `ASTRA_OPERATOR_TOKEN`. The operator unlock route exchanges that token for an HttpOnly, same-site cookie; same-origin browser fetches then work. Never commit secret values. Bind internal services to loopback; expose HTTPS through Caddy, not raw simulation.

An iPhone must reach an HTTPS hostname; desktop localhost is not a phone address. Configure authorized STUN/TURN infrastructure; STUN alone fails some networks. Verify cellular and Wi-Fi behavior and explicitly stop the phone camera. No host, TURN purchase or actual device success is implied by the templates.

If DimOS installation is attempted, gate it on an approved Ubuntu environment and record its actual dependency/import/health results. Keep its unavailable state explicit. Do not spend the six-hour budget claiming a new locomotion training run or unverified ASAP motion tracking; the pinned pretrained policy provides the locomotion baseline while the experiment changes coordination.

Stop release promotion when a result is stale after a scene edit, a service is unavailable, generated source fails admission, held-out evaluation fails, or actual evidence is missing. Preserve the failure and describe its scope rather than changing evaluator criteria to pass it.
