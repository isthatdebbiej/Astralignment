# Curation verification ledger

Target: specification 0.3.0 implementation candidate. Local test date: 2026-09-09.
This ledger does not qualify a public-data release or report training benefit.

## Docker qualification on Windows, 2026-09-09

Docker Desktop 4.90.0, Linux engine 29.7.2 and Compose 5.5.1 built and ran
both CPU-only services. The pinned real BotFails episode below imported in
8.64 seconds with 1,045 frames, two camera views and no integrity findings.
Upstream verification, 64-row state/action preview, HTTP byte ranges, Chrome
decoding of both cameras, collection freeze and annotation-preserving export
passed. This is one real recording, not a corpus-scale benchmark.

The first restart exposed a stale PID lock: npm did not forward termination
to the API, and a reused container PID was mistaken for the previous owner.
The image now starts Node directly. Linux locks include process start time and
boot identity to distinguish PID reuse after forced termination. Both Linux
store regression tests passed, including live-owner exclusion and PID reuse.
After the fix, normal service restart and forced API restart preserved the
source, episode, collection, frozen version and checksums of all three export
artifacts. The legacy stale lock was removed only after both services stopped;
the persistent data volume was retained.

The app is published only on 127.0.0.1:8788. Human relevance review remains
pending; an unreviewed 20-question template was prepared against this corpus.

## Follow-up qualification on the second Windows host

Date: 2026-09-09. Windows x64, Intel Core i7-1265U, Node 22.16.0,
Python 3.13.15, DuckDB 1.4.0, PyArrow 21.0.0 and PyAV 16.0.1.
The initial DuckDB DLL import failure was resolved with a local Microsoft C++
runtime; no application dependency versions were changed.

Fresh checks passed: production build; 10 curation TypeScript tests; 9 Python
tests; all 39 prototype TypeScript regressions; expanded Chrome journey.
New coverage includes stale draft/review publication, GET filters, measured
stream interval bounds, unsubmitted-query provenance, actual interval review,
version reload, focus return, native worker restart exhaustion/retry, termination
of the actual native API without an orphan worker, persisted collection recovery,
OS-killed metadata-writer recovery and the read-only restart smoke checker.
Python tests also cover acquisition confirmation/content identities, staging
quota reuse and injected ENOSPC on flush. ENOSPC injection is not a real full-volume
or power-loss test.

A real pinned BotFails selection passed opt-in qualification:
`test/domotic_makingCoffee_anomaly`, episode 0, revision
`3478e49d91e1737eb76dfee2d81bb22617039c13`. Seven original files,
25,557,340 bytes; 25,560,593 bytes including the verification receipt.
Upstream Git/LFS identities matched. Import produced one logical episode,
two camera views, 1,045 frames and no integrity findings. Original Parquet
sample rows and CSV categories matched imported evidence; both real AV1
videos decoded in Chrome. The frozen manifest/export matched the selection.
No semantic human review was performed or invented.

The final run measured 6.90 s import, 2.07 s first preview, warm-query p50/p95
3.52/4.88 ms, process-lifetime worker peak RSS 75,268,096 bytes, and 408,217
derived-directory bytes during the run. See the checked-in
[reference report](evaluation/public-reference-2026-09-09.json).
This is one recording, not representative corpus scale; OS caches were not
flushed. The consumed source test episode is development qualification evidence,
not unseen-task evaluation. Its original split remains preserved.

Next: [release plan](CURATION_RELEASE_PLAN.md) and
[Docker handoff](CURATION_DOCKER_CHECK.md). The user will perform human pilot
review after Docker testing. Native macOS/Linux and deployed HTTPS were not run.

## Earlier implementation checks on the first Windows host

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

- Broader public-data selection and representative-corpus performance. The
  single pinned episode described above is now checked; it does not qualify the
  entire dataset or all modalities/task families.
- Twenty actual human-reviewed retrieval questions and evidence references,
  frozen before scoring. The runner/template are implemented; no human judgments
  or effort measurements were fabricated.
- Docker build/runtime/restart qualification passed above; broader failure and
  representative-data coverage remains pending.
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
