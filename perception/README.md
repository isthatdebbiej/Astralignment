# Automatic learned camera geometry

This isolated service estimates depth, camera pose and a floor plane from
JPEG frames. It never changes robot commands, MuJoCo state, goals or obstacles.
There is no manual floor-click path and no fixed-camera fallback projection.

## Real models and provenance

- [Official Depth Anything 3 source](https://github.com/ByteDance-Seed/Depth-Anything-3/tree/3d835ec1a5802d64a8b8b15f817a1ab54809bfe4), pinned revision in `provenance.py`.
- [DA3-BASE model card](https://huggingface.co/depth-anything/DA3-BASE): 0.12B any-view depth and camera-pose model, Apache-2.0.
- [DA3METRIC-LARGE model card](https://huggingface.co/depth-anything/DA3METRIC-LARGE): 0.35B canonical metric depth, Apache-2.0.

Both pretrained revisions are pinned. No user-provided model name, source,
checkpoint, file path or remote image URL is accepted by the HTTP service.
We import the upstream library without changing its source. Its original
notices remain installed. This project authors the admission, bounded session,
floor fitting, geometric verification, projection and service glue; it does
not claim to have trained either network.

The official `apply_metric_scaling` rule is implemented explicitly:
`metric_depth = canonical_depth * mean(fx, fy) / 300`, with focal lengths in
the **processed image's pixels**, estimated by the any-view model. Raw
canonical metric output is not already metres. Separate BASE and Metric
models are used, not the noncommercial Giant/Nested pretrained weights.

## Geometry and honest limits

The first frame is retained as anchor. Each inference contains that same
anchor, up to two accepted context frames, and the new frame: at most four
images at 504-pixel longest side. The metric network processes only the new
frame; its initial anchor depth is retained. A robust ratio aligns each
new relative-depth/pose batch to that original estimated metric anchor.

Floor RANSAC samples confident, nonsky lower-image depth pixels. It requires
a broad planar patch, plausible estimated camera height, and an upright or
oblique handheld-camera prior. The floor normal defines Z-up; camera-right
projected onto the plane defines stage X; the right-handed remaining axis
defines Y. The median supported floor point is the stage centre. Requested
8x6-metre stage dimensions are **virtual extents**, not evidence that an
8x6-metre empty physical floor exists. Robots are not shrunk to fit the image.

The first frame returns `searching` with no projection. Subsequent pose
estimates must pass independent ORB match reprojection, metric-consistency,
proper-rotation, finite-intrinsic and bounded-motion checks. The retained
stage frame never follows a newly estimated floor centroid. A failed check
returns `searching` or `lost`, and `world_to_clip:null`, not a stale pose.

`tracking` means these geometric checks passed. It is **not measured
calibration, a SLAM guarantee, floor semantic recognition, an IMU/gravity
measurement, collision evidence or a safety guarantee**. Monocular scale
and focal length remain learned estimates. A broad tabletop can be mistaken
for floor; reflective/textureless floors, occlusion, rolling shutter, fast
motion, zoom or large camera rotations may cause loss. No robot-room depth
occlusion is claimed; the PNG is a diagnostic depth palette, not an occlusion
buffer. Actual iPhone/live-camera accuracy requires device testing.

`world_to_clip` is a 16-value **column-major** canonical-stage-to-WebGL clip
matrix. It incorporates OpenCV X-right/Y-down/Z-forward camera coordinates,
estimated intrinsics, perspective division and WebGL depth, so consumers
must not apply another camera transform or flip its rows. Capture dimensions
and timestamps identify the image it belongs to; no pose smoothing hides
camera latency. Use projection only on its matching captured image.

## HTTP and sessions

CPU endpoint routes: authenticated `GET /health`, `POST /infer`. Authorization
is `Bearer PERCEPTION_TOKEN`, a root-provisioned secret with at least 32
characters. Authentication and bounded JPEG decoding happen **before** any
GPU call. Images are never written to disk or included in logs.

Input matches `PerceptionFrame` plus `stage_width` and `stage_depth` supplied
by the gateway. Session IDs are UUIDs. Start every new session with
`frame_id:0`, then strictly increasing IDs and capture timestamps. Frames
must have matching declared dimensions, 64..1920 pixels per axis, at most
2.5MP and a JPEG data URL no larger than 4MB encoded. Normalize EXIF rotation
before sending. Orientation, resolution or stage changes require a new UUID.

The GPU worker holds at most eight sessions in RAM, expiring after 120 seconds
without activity. GPU idle scale-down after 60 seconds can discard anchors
earlier. Unknown sessions at frame ID >0 return `lost`; the client must begin
a new UUID/frame0 session. A cold worker never silently reanchors a running
session. Stop sending frames when capture stops; nothing schedules polling.

## Modal deployment (operator only)

Root provisions Modal secret `astralignment-perception` containing
`PERCEPTION_TOKEN`, then deploys `perception/modal_app.py`. Never paste the
token into source, command output, browser JavaScript or a public URL.

The CPU ASGI facade invokes a private GPU method. Defaults: one L40S GPU
container maximum, zero warm containers, no buffer, 60-second idle window,
120-second call timeout, four CPU cores and 16GiB RAM. Set `PERCEPTION_GPU=L4`
at deployment for the lower-cost alternative. CPU auth endpoint has its own
single-container limit. Model files are cached in the image build; that build
also verifies the actual DA3 import graph. Optional gsplat and xformers are
not installed: no Gaussian rendering is requested, and this pinned BASE/
Metric path uses PyTorch scaled-dot-product attention.

Container limits are **not a hard dollar budget or a timed shutdown**.
The root operator must enforce the user's spending/time limit and stop the
app at the end. No deployment, credentials or paid inference are created by
importing project geometry modules or running the local fixture tests.

## Verification

`python -m pytest perception/test_geometry.py perception/test_engine.py -q`
tests synthetic noisy floors, no-floor rejection, focal scaling, real matrix
math, wrong-pose rejection, bounded anchor/session state and auth-before-GPU.
These fixtures are explicitly not trained-model accuracy evidence.

After an authorized deployment, set `PERCEPTION_URL` and `PERCEPTION_TOKEN`
privately and run `python -m perception.smoke path/to/approved-floor.jpg`.
It makes two real inference calls on that supplied still and prints only
status/geometry diagnostics. Supplying up to four sequential camera JPEGs
tests their actual model-estimated poses. This does not substitute for live
device QA, and `searching` is a valid failure to establish geometry, not a pass
for overlay alignment.
