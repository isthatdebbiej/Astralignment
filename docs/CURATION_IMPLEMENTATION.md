# CPU evidence-curation workspace

Implementation target: specification 0.3.0. The complete local journey is available
at `/curation`: register a supported snapshot, inspect its import plan, search
episodes, inspect recorded evidence, review labels, save a collection, and export
an immutable selection. This is a release candidate, not a qualified public-data
release. See [verification and remaining gates](CURATION_VERIFICATION.md).

The existing simulation/camera/repair prototype is separate and unchanged.
No GPU, model account, MuJoCo, ROS, DimOS, external FFmpeg executable, or Docker
is required for the curation journey.

## Native setup

Use Node 22.16+ in the Node 22 line and Python 3.13. SQLite in this Node version
prints an experimental-API warning. Python dependencies are pinned in
[worker/requirements.txt](../worker/requirements.txt): DuckDB, PyArrow, and PyAV.
PyAV supplies video decoding; the application does not require ffprobe on PATH.
Use a local SSD, not OneDrive or a network share, for the SQLite directory.

Windows also requires the Microsoft Visual C++ runtime used by DuckDB. Check
`python -c "import duckdb, pyarrow, av"` with the chosen virtual environment
before starting the API. A missing native DLL is a setup failure, not an import
quality finding to ignore. The worker fails startup when dependencies cannot
load; the native API reports bounded restart exhaustion and offers Restart worker.

PowerShell, from the repository:

```powershell
npm ci
python -m venv runtime/curation-venv
runtime/curation-venv/Scripts/python.exe -m pip install -r worker/requirements.txt
$env:CURATION_PYTHON = "$PWD/runtime/curation-venv/Scripts/python.exe"
npm run dev:curation
```

macOS/Linux equivalent:

```sh
npm ci
python3.13 -m venv runtime/curation-venv
runtime/curation-venv/bin/python -m pip install -r worker/requirements.txt
export CURATION_PYTHON="$PWD/runtime/curation-venv/bin/python"
npm run dev:curation
```

Open [Library](http://127.0.0.1:5173/curation). For a built interface, run
`npm run build`, then `npm run curation:api`, and open
[port 8788](http://127.0.0.1:8788/curation). This starts one API-owned CPU worker,
not the prototype gateway. Native execution was tested on Windows; other-host
instructions and Compose still need qualification.

See [the current release plan](CURATION_RELEASE_PLAN.md) and
[Docker qualification handoff](CURATION_DOCKER_CHECK.md) for the next-host checks.
`worker/acquire_reference.py` plans a bounded, pinned real reference selection;
it downloads recordings only with an exact `--confirm-bytes` argument.
`npm run test:curation:public` is opt-in and requires `CURATION_PUBLIC_SNAPSHOT`;
it verifies upstream identities, original rows/categories, browser decoding and
immutable export. It does not perform semantic human review.

## Acquire and register a small source selection

The adapter supports the actual BotFails LeRobot v2.0 folder layout at upstream
revision `3478e49d91e1737eb76dfee2d81bb22617039c13`.
Obtain selected files independently after checking their byte estimates and terms.
No registration, import, or verification command downloads recordings or runs
dataset scripts.

Place the snapshot under `runtime/sources/<snapshot-name>/BotFails/`.
Register `<snapshot-name>` and explicit task folders such as
`test/domotic_makingCoffee_anomaly`. Optional episode indices apply to each
selected task. Start with one episode. Required metadata is
`meta/info.json`, `meta/episodes.jsonl`, and `meta/tasks.jsonl`; supply the
referenced Parquet/video files and separate `labels/<task>/episode_*_labels.csv`.
Source-relative paths remain portable between operating systems.

Preflight hashes selected files and reports exact bytes and missing evidence.
Inspect the plan, then explicitly approve import. Media is fully decoded in a
bounded streaming pass for integrity; frames are not cached as a decoded corpus.
Browser playback subsequently decodes only the selected recording. Two camera
views are one episode, not two samples. Outer directory splits and inner metadata
split declarations are both retained. Headerless numeric CSV categories remain
unmapped source categories, not invented failure labels.

An operator-supplied revision is not proof of upstream identity. For public-data
qualification, save the source API response to a local JSON file and run:

```powershell
runtime/curation-venv/Scripts/python.exe worker/verify_source.py --help
```

The verifier compares selected local files with the pinned Hugging Face tree's
LFS SHA-256 or Git blob identities, fetching metadata only. It creates an
exclusive verification receipt inside the snapshot. Reinspect as a new source
revision to attach that receipt; existing approved manifests remain immutable.
The verification helper has fixture tests and a real one-episode reference run;
see the verification ledger for its exact scope and pending broader qualification.

## Evidence, search, and collections

Library embeds filters for project/source, task, robot, split, modality, source
category, reviewed role, and integrity findings. Text retrieval uses FTS5.
Metadata mode excludes revealing source task descriptions and reviews.
Annotation-assisted mode explicitly includes them; match reasons disclose this.
Neither mode is label-hidden prediction or automatic video understanding.

Episode inspection has one recorded camera, source annotations, review history,
and a paged state/action inspector. Native timestamps and gaps are preserved.
The shared cursor moves video only when an original row contains a matching
video path and timestamp. Missing mappings remain unknown; playback alignment
does not establish causal synchronization. A paused/unmounted inspector cancels
outstanding work where applicable. No missing actions or clocks are synthesized.

Reviews append evidence, rationale, intended role, native interval, author, and
supersession history. Source annotations are never edited. Collections preserve
explicit membership, exclusions, declared use, selection provenance, family
grouping, source revisions, and frozen review records. Draft revision conflicts
require reloading. Published versions can be compared and exported independently.

Publication now requires both the displayed draft `revision` and its exact
`review_ids` array. If either changed, the API returns 409 and the operator must
reload and review before publishing. Interval selection uses the chosen stream's
measured bounds; older source records lacking those bounds require reinspection.
Frame review/selection fields and the selected frozen version survive URL reload.

Exports contain a versioned manifest and matching JSONL/Parquet annotations,
source references/checksums, original splits, family IDs, and provenance.
Intervals remain references into recordings. Integrity failures block export;
unknown training suitability does not become a training-ready claim.
No ROS bag conversion, sliced LeRobot dataset, robot-action synthesis, or policy
improvement is promised.

## Storage and resource controls

| Variable | Default / purpose |
| --- | --- |
| CURATION_DATA_DIR | runtime/curation: SQLite and committed exports |
| CURATION_SOURCE_ROOT | runtime/sources: allowlisted original artifacts |
| CURATION_PYTHON | python: isolated interpreter recommended |
| CURATION_PORT | 8788, loopback |
| CURATION_AUTO_WORKER | 1; use 0 for a separately managed worker |
| CURATION_WORKER_TOKEN | Generated for native child; explicitly set for Compose |
| CURATION_MAX_IMPORT_BYTES | 20 GiB selected original-file admission ceiling |
| CURATION_METADATA_MAX_BYTES | 256 MiB SQLite page quota |
| CURATION_EXPORT_MAX_BYTES | 1 GiB total export-directory write quota |

One API owns the SQLite WAL writer and an exclusive ownership lock. One worker
claims leased jobs. The pending queue is capped at 16, source selection at 1,000
episodes/20 tasks, worker messages at 2 MiB, and individual metadata records at
8 MiB. Select smaller batches when admission limits are reached. DuckDB uses one
thread and a 256 MiB memory limit; Arrow/decoder thread counts are bounded.
Sample pages contain at most 128 rows (UI: 64). No persistent thumbnail cache is
generated. Artifact hash verification has a bounded stat-keyed cache and queue.

Job status, attempts, cancellation, failures, and committed results survive
restart. A lost lease is retried with stable identities; three expired attempts
fail visibly. Jobs expose elapsed time and worker process-lifetime peak RSS, not
a fabricated per-job peak. Staged exports are never downloadable until committed.
Interrupted staging files remain inspectable and count against the export quota;
stop services before operator cleanup. Source evidence and published exports are
never automatically evicted. Byte quotas are not hard process-memory limits or
cloud billing caps. The initial budget remains $150 total, not monthly; no cloud
resources were provisioned.

## Backup and restore

Stop API and worker first. Backups reject an active ownership lock and existing
destinations. Include sources for a self-contained selected-evidence backup:

```powershell
runtime/curation-venv/Scripts/python.exe worker/backup.py backup runtime/curation runtime/backup-001 --sources runtime/sources --services-stopped
runtime/curation-venv/Scripts/python.exe worker/backup.py verify runtime/backup-001
runtime/curation-venv/Scripts/python.exe worker/backup.py restore runtime/backup-001 runtime/restored-001
```

Restore creates `data/` and `sources/` under the new destination. Point
CURATION_DATA_DIR and CURATION_SOURCE_ROOT there before restarting. Without
`--sources`, the backup retains references only; recover the verified source
files separately. SQLite integrity and every copied artifact checksum are checked.
The end-to-end test exercises backup, restore, reopening, and media range reads.

## Docker handoff — not tested on this computer

[compose.curation.yml](../compose.curation.yml) defines API and CPU worker only,
each limited to one CPU and 1 GiB. It publishes loopback 8788, uses a named
persistent data volume, and mounts selected sources read-only.

On the other computer with Docker:

```powershell
New-Item -ItemType Directory -Force runtime/sources
$env:CURATION_WORKER_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
docker compose -f compose.curation.yml config --quiet
docker compose -f compose.curation.yml up --build
```

Open [the container interface](http://127.0.0.1:8788/curation). Repeat registration,
import, review, freeze, and export; restart both services and verify the same IDs,
reviews, and exports. Check logs for worker failures. Stop with
`docker compose -f compose.curation.yml down`; do not add `-v` unless intentionally
deleting the durable volume. Docker builds and runtime tests are explicitly deferred.

Local mode must not be publicly exposed. Optional remote mode requires an exact
HTTPS CURATION_PUBLIC_ORIGIN and a CURATION_OPERATOR_TOKEN of at least 32
characters. A trusted local reverse proxy preserves Host and sets
X-Forwarded-Proto=https. Signed eight-hour HttpOnly/Secure/SameSite=Strict cookies
cover API and media reads. Keep the backend private.
CURATION_CONTAINER_LOCAL=1 is only for the supplied private container network and
loopback publication, not an alternative to remote authentication.
HTTPS access logic is unit-tested; deployed proxy/TLS behavior is not qualified.

## Local verification commands

```powershell
npm run build
npm run test:curation
runtime/curation-venv/Scripts/python.exe -m unittest discover -s tests/curation -p 'test_*.py'
npx tsx tests/curation/browser.qa.ts
npm test
```

Browser QA uses installed Chrome. Tests generate explicitly labeled tiny fixtures
under ignored runtime paths, not public recordings. Results and screenshots go
under ignored `artifacts/curation/`. See the [verification ledger](CURATION_VERIFICATION.md)
and [retrieval pilot protocol](evaluation/README.md). The public-data pilot,
human review, deployed HTTPS, Docker, and downstream training benefits are not
established by these local tests.
