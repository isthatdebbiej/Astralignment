# Vultr Docker deployment

The live deployment uses Docker Compose on Ubuntu 24.04 at
`https://astralignment.64.177.14.149.sslip.io`. The hostname uses public automatic
DNS; no purchased domain is required. A trusted Let's Encrypt certificate was
issued and the public endpoint returned HTTP 200 on September 8, 2026.

## Containers and persistence

`compose.yaml` builds separate CPU MuJoCo, Node gateway, and static-web/Caddy
images. Only Caddy publishes web ports. Gateway and simulation ports stay on the
private Docker network. The simulator and gateway run as non-root users with
capabilities dropped. MuJoCo uses the actual CPU TorchScript G1 policy, not a
render-only robot animation. Browser rendering does not require a server GPU.

Gateway budget/artifact state, simulation artifacts, and TLS certificates use
named volumes. `docker compose down` preserves these; do not add `--volumes`
unless intentionally deleting saved state. Secrets belong in
`/etc/astra/gateway.env`, mode 0600, outside the build context and repository.
Never run `docker compose config` or inspect container environment into public
logs: those commands can reveal injected credentials.

DimOS runs separately with one native worker and internal port 8003, exposing
typed LCM observations without taking control at startup. The gateway exposes
operator-authenticated read-only `/api/dimos/health` and `/api/dimos/state`.
The internal command interface is not published on the host. Native observation
and a labeled command/expiry fixture passed on the deployed container. See
`sim/DIMOS.md` for details; do not enable native control during an Astra trial.

The Coturn container relays WebRTC media using expiring credentials. Its shared
secret is stored only in server configuration, never sent to browsers. Open
3478 TCP/UDP and 49160–49200 UDP for this bounded demo relay. Its host-network
configuration binds the public interface; private/loopback relay destinations
are denied. TURN over TCP is supported; TURN-over-TLS is not configured.

```sh
cd /opt/astra
docker compose build
docker compose up -d
docker compose ps
docker compose cp deploy/smoke.py sim:/tmp/astra-smoke.py
docker compose exec -T sim python /tmp/astra-smoke.py
```

The smoke check verified two robots and matching simulation/model episode
identity. Phone hardware, real stage calibration, and cellular connectivity
still require rehearsal. Do not equate healthy containers with completed
camera-overlay or native DimOS verification.

## Legacy non-container templates

The systemd files below remain unused templates; the deployed host uses Docker.
No physical iPhone test has been performed.

Use Ubuntu 24.04, Python 3.12, Node 22 and Caddy. Copy the checked-out project to `/opt/astra`. Install Node dependencies with `npm ci`, run `npm run build`, and install `requirements.txt` in `/opt/astra/.venv`. Create an unprivileged `astra` user/group and writable `/opt/astra/artifacts` and `/opt/astra/runtime` owned by that user. Both directories must exist before systemd starts the supplied hardened services. Runtime contains budget/artifact state and must survive service restarts; never publish it.

Copy `gateway.env.example` to `/etc/astra/gateway.env` with mode 0600; replace the public origin and configure a funded server-side key and strong operator token. Install `astra-sim.service` and `astra-gateway.service` in `/etc/systemd/system/`, validate the units and reload systemd, then enable/start simulation followed by gateway. Their entrypoints are `.venv/bin/python -m sim.server` and `/usr/bin/node --import tsx gateway/index.ts`; verify these executable paths on the chosen host. Simulation binds loopback 8001 and gateway loopback 8787. Replace the hostname in Caddyfile and point your domain DNS to the approved server. Caddy terminates HTTPS and proxies signaling plus API on the same origin. Expose only 80/443 and approved SSH; do not expose simulation or gateway ports directly. Caddy automatically manages TLS for a reachable domain. No provider purchase or provisioning is included.

Phone use requires HTTPS (desktop localhost does not work as an iPhone URL). Open the public desktop page, generate a pairing link, scan it on the phone and explicitly Start camera. Tokens expire after 30 minutes; create a fresh pairing afterwards. Keep the camera fixed and phone awake. Safari backgrounding or locking can interrupt capture.

Configure `CAMERA_ICE_SERVERS` as a JSON array of standard RTCIceServer objects. STUN alone fails behind some carrier/corporate NATs; authorized TURN service is needed for dependable remote streaming. TURN relays encrypted WebRTC packets. Use approved infrastructure and preferably time-limited TURN credentials; never commit actual credentials. With no ICE servers, only directly reachable networks are expected to work. The signaling server relays SDP/ICE only and does not record video. Pairing URLs are bearer credentials, so avoid query logging and analytics on `/phone` and `/ws/camera`.

Before release verify: two physical devices over HTTPS; rear camera selection; permission denial and stop; disconnect/reconnect; expiry; Wi-Fi and cellular/TURN; phone orientation; calibration corner order and physical dimensions. No prerecorded fallback is provided. Floor corners plus measured dimensions establish a planar reference only, not arbitrary physical geometry recovered from video.

The template separates API/WebSocket proxying from the SPA fallback with mutually exclusive handles, following [Caddy's API + SPA guidance](https://caddyserver.com/docs/caddyfile/patterns#single-page-apps-spas). Run `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` and `systemd-analyze verify` on the installed units before starting them; configuration guidance is not proof of a deployed service.
