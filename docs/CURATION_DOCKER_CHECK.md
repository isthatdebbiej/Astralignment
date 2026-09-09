# Docker qualification handoff

This procedure is the next qualification gate. Docker was not executed on the implementation host. Use branch `codex/curation-release-readiness`. The checked-in source includes the native fixes, tests, bounded reference acquisition, and a read-only restart smoke checker.

## 1. Get the branch and start the services

From the repository on the Docker computer:

```powershell
git fetch origin
git switch codex/curation-release-readiness
New-Item -ItemType Directory -Force runtime/sources | Out-Null
$env:CURATION_WORKER_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
docker compose -f compose.curation.yml config --quiet
docker compose -f compose.curation.yml up --build -d
docker compose -f compose.curation.yml ps
python worker/smoke_curation.py
```

The smoke command requires only Python's standard library on the host. It waits up to 60 seconds for the API and worker. Open `http://127.0.0.1:8788/curation`. The API has a health check; worker startup waits for the API. Each container is limited to one CPU and 1 GiB. Import/export quotas are passed consistently to the relevant services. Sources mount read-only; metadata/exports use the named volume.

## 2. Acquire the bounded reference selection

Alternatively copy the already acquired `runtime/sources/botfails-reference` folder from the implementation computer. Recordings are not committed to Git.

For a fresh acquisition, inspect the printed plan and the pinned dataset-card terms:

```powershell
python worker/acquire_reference.py
python worker/acquire_reference.py --confirm-bytes 25557340
```

This selects exactly seven files, one episode, two cameras, and 25,557,340 original bytes at revision `3478e49d91e1737eb76dfee2d81bb22617039c13`. The helper rejects a changed estimate, more than 64 MiB, unexpected file paths, and content-hash mismatches. It never executes dataset scripts. Existing mismatched files are not overwritten; interrupted `.part` files require inspection or a fresh destination. Source card: https://huggingface.co/datasets/kantine/BotFails/blob/3478e49d91e1737eb76dfee2d81bb22617039c13/README.md

In Library, register:

- Snapshot: `botfails-reference`
- Task folder: `test/domotic_makingCoffee_anomaly`
- Episode indices: `0` (required: only this recording was acquired)
- Provenance: public recording
- License reference: the pinned BotFails dataset card (Apache-2.0)

Inspect the manifest before importing. Expect one logical episode and two camera streams, 1,045 frames, and the original outer `test` split. The inner metadata split is retained separately. The chosen test episode has been used for development qualification; do not claim unseen-task evaluation from it.

For an independent receipt, save the source's GET `/api/v1/sources/{id}` JSON to `runtime/source.json`, then run on the host:

```powershell
python worker/verify_source.py runtime/source.json --root runtime/sources
```

Reinspect as a new source revision before importing the verified selection. If the snapshot already has a receipt, do not overwrite it. The plan will include its extra bytes. Acquisition already validates pinned hashes; the receipt makes that provenance visible in the application.

## 3. Complete the application journey

1. Import the selected episode. Check the worker status, progress, last update, published count and findings.
2. Search metadata, then annotation-assisted text. Change text without submitting and verify the displayed result/provenance remains tied to the executed search. Test sorting and pagination.
3. Open the episode, play both cameras individually, inspect original sample rows, and verify unknown video/state mappings remain unknown. Source files may not contain explicit per-row camera timestamp references.
4. Review a bounded frame interval with actual evidence and rationale. Add an interval to a collection. Reload the URL and check scope/start/end/stream restoration.
5. Open the collection in two tabs. Change its draft or episode reviews in one; publication from the stale tab must return a conflict and require reloading/review.
6. Freeze, inspect a selected version, reload its URL, and export. Verify manifest, JSONL and Parquet represent the selected source/review revisions. Download remains unavailable until the job commits.
7. Complete light/dark and keyboard navigation, especially result opening, focus return, interval review, and export. Record any host/browser-specific failures.

## 4. Record and compare persistence across restart

Do not edit sources, reviews or collections between the two smoke snapshots:

```powershell
python worker/smoke_curation.py --record runtime/docker-before.json
docker compose -f compose.curation.yml restart
python worker/smoke_curation.py --compare runtime/docker-before.json
```

The checker verifies worker availability, source identities, episode/review state, collections, frozen versions, and committed export bytes/hashes. The baseline file is created exclusively; use a new filename for another experiment.

For interrupted-job testing, use a separate test Compose project/volume and a small copied source selection. Interrupt worker execution during import/export, restart it, and allow up to 60 seconds for lease recovery. Check attempts and preserved committed data. Avoid writing new records during a baseline comparison unless their differences are intentional. Record failed tests as failures, not a green Docker gate.

```powershell
docker compose -f compose.curation.yml logs --tail 100 api worker
docker compose -f compose.curation.yml down
```

Do not add `-v` when preserving data. Backup/restore uses the documented cold-backup procedure after both services stop; the data volume must be available at the chosen backup path. Native API termination/worker exit and injected disk-full failures were tested locally, but this does not certify real Docker volume exhaustion, host crash durability or power-loss recovery.

## 5. Human pilot after Docker testing

The user will review the retrieval questions and relevance labels after this Docker test. The reference episode above is a format/integrity check, not a sufficient diverse retrieval corpus. Agree on a broader bounded source selection before the pilot; preserve official splits and group whole source families.

After the intended corpus and searchable annotations are finalized:

```powershell
python worker/evaluate_retrieval.py --prepare runtime/pilot-review.json
```

Follow `docs/evaluation/README.md`: write and inspect 20 distinct questions with supporting episode/artifact/interval references; record actual reviewer identity, freeze time and optional measured effort. Do not set `manually_reviewed` automatically. Freeze before scoring and retain negative results. Score with `python worker/evaluate_retrieval.py runtime/pilot-review.json`.

## Remaining host qualification

Record Docker engine/OS/CPU, selected data size, logs, screenshots, import/preview/query timings, memory and original/derived storage. One real episode does not qualify corpus-scale throughput. Cold/warm cache experiments, broader real filesystem-full tests, native macOS/Linux, and deployed reverse-proxy HTTPS remain distinct gates. No policy training or hardware claim follows from this check.
