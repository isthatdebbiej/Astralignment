# Curation release completion plan

Active contract: specification 0.3.0. This plan records the follow-up to the 2026-09-09 implementation audit. Application release remains a candidate until the target-host and human evidence gates pass.

## Implemented in this follow-up

- Publication checks the draft revision and exact set of reviewed revision IDs inside the transaction. Changes in another tab require reloading before freeze.
- Executed query state drives result provenance, disclosure, sorting, pagination and URLs; unsent edits remain separate.
- GET episode filters share the POST search contract and reject unsupported query parameters.
- Stream-specific measured frame/duration bounds gate intervals. Old sources lacking measured bounds must be reinspected. Published old versions stay immutable.
- Native workers have bounded backoff/restart, explicit retry after exhaustion, health visibility, and a parent pipe so terminating the API does not orphan the worker. Lease reconciliation also runs without worker requests.
- Import UI shows published/incomplete counts, progress and last update, selected byte/staging estimates, available space and limits. Search discloses indexed scope and offers sorting.
- Interval form state and selected frozen versions have URLs. Inspection shows reviewer intervals, per-stream bounds and focus restoration. Collapsing an active sample inspector cancels its job.
- Export retry budget accounts for overwritten staging files; flush failures close handles and leave committed artifacts intact.
- Added process termination, restart, stale-publication/review, interval, filter, acquisition, disk-full injection and browser provenance tests.
- Added bounded reference acquisition, opt-in real-source qualification and read-only native/Docker restart smoke tools. Added API Compose health/startup dependency and consistent resource quota configuration.

## Executed evidence

See `docs/CURATION_VERIFICATION.md` for fresh test results and the real BotFails selection. Tests use labeled fixtures unless explicitly described as the public reference run. No reviewer judgments were synthesized. No Docker services were run on the implementation host.

## Next gates and owners

| Gate | Next action / owner | Status |
| --- | --- | --- |
| Native implementation regressions | Run build, curation/Python/prototype tests and Chrome journey | Executed locally; ledger records results |
| Real-source correctness | One pinned coffee episode, original rows/categories and hashes matched, immutable export checked | Executed; narrow reference only |
| Docker runtime/persistence | User and agent follow `CURATION_DOCKER_CHECK.md` on the Docker computer | Next |
| Human retrieval pilot | User reviews 20 questions and relevance labels after Docker testing | Awaiting actual human review |
| Representative performance | Choose a larger bounded corpus; declare latency/memory/storage acceptance budgets; measure cold/warm and under-load behavior on the release host | Pending; one episode is not corpus-scale evidence |
| Broader faults/platforms | Actual isolated volume exhaustion, interrupted staging/commit matrix, macOS/Linux and deployed HTTPS | Pending target environments |

The checked-in helper reports first access separately from a true cold-cache measurement. Do not treat fixture speed, a single reference recording, injected ENOSPC, or unit-tested access logic as the remaining release gates passing.
