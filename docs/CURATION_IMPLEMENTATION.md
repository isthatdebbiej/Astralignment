# Local curation preview

Status: partial implementation of planned specification 0.3.0, not a qualified release.
The existing prototype remains at its original routes. Curation lives at
`/curation` and has a separate API process on loopback port 8788.

## What runs

- Library and Collections, contextual episode inspection, browser-selected light
  and dark themes, keyboard-operable native controls and collapsible evidence.
- Locally supplied BotFails v2 task folders: explicit registration, byte/hash
  preflight, explicit import, one logical episode containing its camera views.
- SQLite WAL persistence for sources, episodes, review history, drafts, immutable
  collection versions and leased jobs. Only the API writes SQLite.
- Metadata-only and explicitly annotation-assisted FTS search. Source task text
  can disclose anomalies and is deliberately excluded from metadata-only search.
- Original frame-label runs from the separate headerless CSV files. Numeric
  categories are preserved, not guessed into a success/failure taxonomy.
- Episode or frame-interval reviews with artifact evidence and a rationale.
- Versioned selection manifests, JSONL and real Parquet annotation exports.
  Intervals are references; no media is copied or sliced. Integrity findings and
  changed checksums block export. Original annotation scopes remain explicit.
- Cancel/retry and 60-second stale-lease recovery; retries recheck files and reuse
  stable episode identities. File transfer resumption is not claimed.

## Local setup

Use Node 22.16 or newer in the Node 22 line, Python 3.13, and FFmpeg's
`ffprobe` on PATH. Without ffprobe, video integrity remains a finding and export
is blocked. No ROS, MuJoCo, GPU or model key is required.

From the repository in PowerShell:

```powershell
npm ci
python -m venv runtime/curation-venv
runtime/curation-venv/Scripts/python.exe -m pip install -r worker/requirements.txt
$env:CURATION_PYTHON = "$PWD/runtime/curation-venv/Scripts/python.exe"
npm run dev:curation
```

Open [the local curation interface](http://127.0.0.1:5173/curation).
For a built interface, run `npm run build`, then `npm run curation:api`, and
open [the API-served interface](http://127.0.0.1:8788/curation).
The curation startup does not start the simulation gateway. Run the existing
prototype separately when needed.

Place an independently acquired, pinned snapshot under
`runtime/sources/<snapshot-name>/BotFails/`. In registration enter
`<snapshot-name>` and specific task folders, for example
`test/domotic_makingCoffee_anomaly`. Required task metadata includes
`meta/info.json`, `meta/episodes.jsonl`, and `meta/tasks.jsonl`; include the
referenced Parquet/video files and separate `BotFails/labels/<task>/` CSV files.
The adapter does not download files or execute dataset scripts.

The default upstream revision is
`3478e49d91e1737eb76dfee2d81bb22617039c13`. Registration records this as
operator-supplied; local checksums alone do not prove the files came from that
upstream commit. Pinning against an independently verified upstream file manifest
is still required before reference-dataset qualification.

Inspect Sources for estimates/findings, approve the exact bytes, then import.
Refresh Library search when the job completes. Create a collection, select
episodes, review evidence, freeze a version and export. Downloads are in Jobs.
Collection editing supports choosing a destination, episode/frame-interval
selections, metadata edits, removals, exclusions with reasons, review provenance
and frozen versions. The state/action inspector reads up to 64 original rows per
page through the CPU worker. Its row cursor does not imply synchronized cameras.

Configuration:

| Variable | Default / purpose |
| --- | --- |
| CURATION_DATA_DIR | runtime/curation; local durable SQLite and exports |
| CURATION_SOURCE_ROOT | runtime/sources; allowlisted source files |
| CURATION_PYTHON | python; isolated worker interpreter recommended |
| CURATION_PORT | 8788 |
| CURATION_AUTO_WORKER | 1; set 0 for separately managed worker |
| CURATION_WORKER_TOKEN | Generated in memory for the native child worker |
| CURATION_MAX_IMPORT_BYTES | 20 GiB selected input admission limit |

This byte limit is not a disk quota or cloud billing cap. Keep data on local
storage, not OneDrive or a network filesystem. Preflight hashes selected files
and checks free space; large inputs are deliberately not optimized yet.

## Docker Compose

A separate two-service CPU definition is in
[compose.curation.yml](../compose.curation.yml). Docker was not available on the
implementation host, so this configuration has not been built or smoke-tested.

Create the source folder and set a random internal worker token before starting:

```powershell
New-Item -ItemType Directory -Force runtime/sources
$env:CURATION_WORKER_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
docker compose -f compose.curation.yml up --build
```

Open [the local container interface](http://127.0.0.1:8788/curation). The API and
worker share a named data volume; sources are mounted read-only. Each service is
limited to one CPU and 1 GiB. Stop with `docker compose -f compose.curation.yml down`.
Do not add `-v` unless intentionally deleting persisted data.

This preview is **local-only**. Do not bind the port publicly or use
`CURATION_CONTAINER_LOCAL=1` outside the supplied loopback-published container
configuration. Optional HTTPS/operator authentication is implemented but has not
been qualified on a deployed HTTPS host. Set CURATION_PUBLIC_ORIGIN to the exact
HTTPS origin (no trailing slash) and CURATION_OPERATOR_TOKEN to a random secret
of at least 32 characters. A local reverse proxy must preserve Host and set
X-Forwarded-Proto to https; do not expose the backend directly. Login issues an
eight-hour HttpOnly, Secure, SameSite=Strict cookie covering API and media reads.
Keep proxy/backend access private; container-local mode trusts its private network.
Cloud instances still incur charges until stopped/deleted through the provider;
the application does not manage that lifecycle. Nothing has been provisioned.

For a cold backup, stop both services and copy the entire data directory/volume
together with the read-only snapshot or its verified recoverable source copy.
Restore both to the same logical roots before restart. Automated backup/restore
qualification is pending.

## Checks performed and remaining gates

Executed locally on Windows with Node 22.16 and Python 3.13:

- TypeScript and production build.
- Existing 39-test prototype suite.
- Curation API fixture: search-field isolation, invalid interval/evidence
  rejection, stale collection revision rejection, immutable version snapshots,
  review supersession, worker authentication/leases, cancellation and DB reopen.
- Python/DuckDB fixture: grouped views, preserved split metadata, CSV frame runs,
  corrupt-media findings, JSONL/Parquet selection exports and checksum rejection.
- Headless Chrome: both themes, keyboard activation, collection persistence after
  reload, empty-version rejection and no page errors. These are fixture checks,
  not physical-device or real-video playback qualification.

Run:

```powershell
npm run test:curation
runtime/curation-venv/Scripts/python.exe tests/curation/test_worker.py
npm run build
npx tsx tests/curation/browser.qa.ts
npm test
```

Still required before claiming specification 0.3.0 acceptance:

- Pinned public BotFails import and independently verified source identity.
- A shared timeline with verified mappings where available. Paged state/action
  sample inspection preserves original timestamps without interpolation;
  camera views play independently, explicitly without cross-clock guarantees.
- Browser presentation of cross-version comparisons and pagination controls for
  every metadata resource. APIs now support version diffs, bounded source/job/
  collection listings, and source, task, split, robot, modality, source-label,
  current review-role and integrity filters.
- Byte quotas during writes, append-only source revision enforcement and broader
  restart/fault-injection coverage. Worker completion variants now have schemas;
  stale-lease recovery retains attempt events and rejects late results.
- Full media decode validation; ffprobe is a container/stream probe, not proof
  that every frame decodes.
- Deployed HTTPS qualification, Docker smoke test and tested restore.
- Named-host import/memory/storage/query/preview measurements on actual data.
- The frozen 20-question manually reviewed retrieval pilot.

[The evaluation runner](../worker/evaluate_retrieval.py) refuses a pilot without
20 reviewed questions, evidence references, source revisions, reviewer and freeze
date. Supply a JSON object with `source_revisions`, `reviewer`, `frozen_at`,
and `questions`. Each question contains `id`, `query`,
`manually_reviewed: true`, `relevant` episode IDs, `evidence` references and
optional measured `review_seconds` keyed by `metadata` and `annotations`.
It reports both retrieval modes separately and never invents review effort.
The flag is an operator declaration, not independent certification of review.
No reviewed pilot or training benefit has been fabricated.

The full [product](OSS_SPEC.md), [backend](OSS_BACKEND_SPEC.md) and
[frontend](OSS_FRONTEND_SPEC.md) specifications remain planned contracts.
This preview does not demonstrate alignment improvement or policy-training value.
