# Curation verification ledger

Target: specification 0.3.0 implementation candidate. Local test date: 2026-09-09.
This ledger does not qualify a public-data release or report training benefit.

## Executed locally

Host: Windows x64, Intel Core i5-9300H CPU @ 2.40 GHz, Node 22.16.0,
Python 3.13.1. Worker: DuckDB 1.4.0, PyArrow 21.0.0, PyAV 16.0.1.
No GPU, model calls, cloud provision, or Docker execution.

- Production TypeScript/Vite build.
- Five curation TypeScript tests: HTTPS/local access boundaries; API identity,
  review/version/search/lease rules; artifact mutation rejection; exclusive
  SQLite writer and quota recovery; real-media CPU end-to-end workflow.
- Five Python tests: adapter/export behavior plus quota, backup integrity,
  upstream metadata verification with a stub, and real decoder cancellation.
- Browser Chrome journey: both system themes, keyboard activation, registration,
  real fixture import, video decode, original video-reference seeking, review,
  interval selection, freeze/export, manifest equality, reload, explicit theme
  persistence, and no page errors. Screenshots inspected locally.
- Existing 39-test prototype regression suite.

Fixtures are deliberately tiny and labeled synthetic. The end-to-end fixture
has one logical episode, two three-frame H.264 camera views, original Parquet
rows with a timestamp gap, and separate CSV annotations. It tests actual codecs,
file formats, processes, API calls, persistence, range reads, export, cold
backup, restore, and reopening. It is not a BotFails recording.

One measured fixture run (not a throughput benchmark):

| Measurement | Observed |
| --- | ---: |
| Selected original bytes | 7,406 |
| Preflight + import wall time | 14.03 s |
| First sample preview job | 3.22 s |
| Warm query p50 / p95, 20 requests | 3.67 / 5.95 ms |
| Worker process-lifetime peak RSS | 74,125,312 bytes |

Startup, polling, host contention, and tiny inputs affect these measurements.
They do not establish large-corpus latency or hard real-time behavior.
Reruns write current measurements to ignored artifacts/curation/e2e-report.json.
Browser screenshots are under the same ignored directory. Original/derived
storage and larger-data performance still need measurement on the release host.

## Pending qualification

- A real pinned BotFails selection imported and independently matched to upstream
  content identities. The verifier implementation was tested with metadata stubs,
  not a claimed public-corpus run.
- Twenty actual human-reviewed retrieval questions and evidence references,
  frozen before scoring. The runner/template are implemented; no human judgments
  or effort measurements were fabricated.
- Docker build/runtime/restart testing on the other computer, explicitly deferred
  at the user's request. Compose configuration is supplied, not certified.
- Native macOS/Linux and deployed reverse-proxy HTTPS qualification.
- Representative-data resource tests and broader OS-kill/disk-full fault coverage.
  Existing stale-lease, quota, cancellation, restart and restore tests are not an
  exhaustive process-failure matrix.

No policy training was run. No customer adoption, generalization, alignment
improvement, or downstream policy benefit is asserted. Later utility validation
must compare base data, equal-sized random additions, and curated additions with
matched training budgets and held-out interaction tests; report completion and
response to human correction separately.

See [setup and handoff](CURATION_IMPLEMENTATION.md) and
[human retrieval pilot protocol](evaluation/README.md).
