# Local GPU depth worker (no Docker)

This is an isolated Depth Anything V2 Small worker, not yet a camera-tracking or
live-overlay integration. It returns relative inverse depth, **not meters**.
It never changes calibration, simulator geometry, or the phone connection.

All paths below are on D:. GPU drivers are system-installed and are not changed.
The separate environment leaves the existing `.venv` simulator untouched.

## Install

Run from `D:\Projects\Astra` in PowerShell. Requires `uv` and Git.

```powershell
$env:UV_CACHE_DIR='D:\Projects\Astra\.depth-cache\uv'
$env:UV_PYTHON_INSTALL_DIR='D:\Projects\Astra\.depth-cache\python'
uv venv --python 3.12 .venv-depth
uv pip install --python .venv-depth\Scripts\python.exe torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu118
uv pip install --python .venv-depth\Scripts\python.exe -r depth_local\requirements.txt
git clone https://github.com/DepthAnything/Depth-Anything-V2.git vendor/depth-anything-v2
git -C vendor/depth-anything-v2 checkout a561b849ebae10a6f5ef49e26c83cbbcd36c71bf
New-Item -ItemType Directory -Force models/depth
curl.exe -fL -o models/depth/depth_anything_v2_vits.pth https://huggingface.co/depth-anything/Depth-Anything-V2-Small/resolve/main/depth_anything_v2_vits.pth
```

Source and Small weights: [official upstream](https://github.com/DepthAnything/Depth-Anything-V2).
Preserve the upstream license. Source, weights, caches, and environment are ignored
by Git, rather than copied into the application repository. The CUDA build is
pinned for the installed driver; no runtime GPU availability is assumed without
an actual inference test. Do not load arbitrary untrusted checkpoints.

## Benchmark

```powershell
.venv-depth\Scripts\python.exe depth_local\run.py --image path\to\image.jpg --size 266 --runs 5
```

Writes `artifacts/depth/benchmark.json`, raw `relative-depth.npy`, and a
per-image-normalized preview PNG. Preview intensity is not comparable metric
distance across frames. Timing excludes image decoding, transport, and display.
The runner fails if CUDA is unavailable; it does not silently benchmark CPU.

## Serve

```powershell
.venv-depth\Scripts\python.exe -m uvicorn depth_local.server:app --host 127.0.0.1 --port 8004
```

`GET /health` reports GPU/model readiness. `POST /depth` accepts multipart `file`
(up to 5 MB and 8 megapixels) and returns a NumPy float array with an inference-time
header. Requests serialize on the GPU; overlapping requests get HTTP 429.
There is no CORS or public listener. Do not bind this unauthenticated worker to
`0.0.0.0` or expose its port through a public proxy.

For a private remote-host connection, keep an SSH reverse tunnel running:

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:18004:127.0.0.1:8004 root@64.177.14.149
```

Vultr's host can then reach `http://127.0.0.1:18004/health`. This does not make the
worker reachable from the public website or Docker gateway automatically. The
end-to-end video/pose transport and application integration are separate work.
The PC and tunnel must remain awake/running. Closing SSH removes the forwarding.

## Local verification — 2026-09-08

GTX 1650 (4 GB), unchanged NVIDIA 462.30 driver, Python 3.12.10 and PyTorch
2.6.0+cu118: an actual CUDA tensor operation and official Small-model inference
passed. At input size 266, five warm runs on upstream `demo01.jpg` had median
91.6 ms (80.7–92.0 ms). First inference was 79.2 seconds on this run; startup is
not suitable for an unprepared live demo. Peak PyTorch allocated memory was
153.3 MiB, excluding driver/context, other apps, and reserved memory. These are
one-image model timings, not full video throughput, metric accuracy, or tracking
validation. Detailed outputs remain in ignored `artifacts/depth`.

Vultr host → loopback SSH reverse tunnel → local GPU `/depth` returned HTTP 200
on two requests. The server's first inference was 124.9 seconds; the second was
355.4 ms, excluding transfer. The 2048×1362 float-array response is about 11.2 MB,
so this diagnostic API is not bandwidth-optimized for streaming. Lower-resolution
output/compression and timestamped pose alignment are required before live use.

The Modal CLI is also installed in `.venv-depth`. An existing authenticated
`isthatdebbiej` profile was verified through read-only CLI requests. No Modal GPU
workload was deployed as part of this local benchmark; no payment method was
added. Never commit the Modal credential configuration.
