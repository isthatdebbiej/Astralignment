# Ubuntu 24.04 deployment template

Templates only: no host has been provisioned and no iPhone test has been performed.

Use Ubuntu 24.04, Python 3.12, Node 22 and Caddy. Install the project dependencies using its lockfile, build the Vite frontend, and install Python dependencies in a project virtual environment. Create an unprivileged `astra` user and `/opt/astra/artifacts`. Copy the checked-out project to `/opt/astra`. Run simulation on loopback port 8001 and the gateway on loopback 8787. Confirm the actual gateway entrypoint and simulation launch command before installing service units.

Copy `gateway.env.example` to `/etc/astra/gateway.env` with mode 0600; replace the public origin. Install the gateway service in `/etc/systemd/system/`. Replace the hostname in Caddyfile and point your domain DNS to the approved server. Caddy terminates HTTPS and proxies signaling plus API on the same origin. Expose only 80/443 and approved SSH; do not expose simulation or gateway ports directly. Caddy automatically manages TLS for a reachable domain. No provider purchase or provisioning is included.

Phone use requires HTTPS (desktop localhost does not work as an iPhone URL). Open the public desktop page, generate a pairing link, scan it on the phone and explicitly Start camera. Tokens expire after 30 minutes; create a fresh pairing afterwards. Keep the camera fixed and phone awake. Safari backgrounding or locking can interrupt capture.

Configure `CAMERA_ICE_SERVERS` as a JSON array of standard RTCIceServer objects. STUN alone fails behind some carrier/corporate NATs; authorized TURN service is needed for dependable remote streaming. TURN relays encrypted WebRTC packets. Use approved infrastructure and preferably time-limited TURN credentials; never commit actual credentials. With no ICE servers, only directly reachable networks are expected to work. The signaling server relays SDP/ICE only and does not record video. Pairing URLs are bearer credentials, so avoid query logging and analytics on `/phone` and `/ws/camera`.

Before release verify: two physical devices over HTTPS; rear camera selection; permission denial and stop; disconnect/reconnect; expiry; Wi-Fi and cellular/TURN; phone orientation; calibration corner order and physical dimensions. No prerecorded fallback is provided. Floor corners plus measured dimensions establish a planar reference only, not arbitrary physical geometry recovered from video.
