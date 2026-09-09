# Frozen retrieval pilot

This is a small technical pilot, not proof of customer demand, generalization,
training benefit, or alignment improvement. Use a verified public source
selection, not the synthetic regression fixture.

The user will review the 20 questions and relevance judgments after the Docker
qualification check. The already verified single coffee episode is a technical
reference, not an adequate diverse pilot corpus. Agree on the broader bounded
selection first; leave the template unreviewed until actual inspection occurs.

1. Import the chosen source selection and finish any planned source/reviewer
   annotations before freezing the corpus. Record source revisions and terms.
2. Start the local API and prepare a new template:

   ```powershell
   runtime/curation-venv/Scripts/python.exe worker/evaluate_retrieval.py --prepare runtime/pilot-review.json
   ```

3. A human writes and reviews 20 distinct questions against original evidence.
   For each question record its ID, query, relevant episode IDs, and evidence
   objects containing episode_id and artifact_id. Optional interval objects use
   stream_id, start, end, and unit (frames or seconds), with exclusive end.
   Negative questions still require inspected evidence and a documented rationale.
4. Set manually_reviewed only after actual review. Record reviewer and frozen_at.
   Preserve the generated corpus_fingerprint and source_revisions. Save the
   frozen pilot with the experiment's provenance; do not change relevance labels
   after seeing ranked results.
5. Score both modes:

   ```powershell
   runtime/curation-venv/Scripts/python.exe worker/evaluate_retrieval.py runtime/pilot-review.json
   ```

The runner refuses changed corpus identity, unreviewed questions, missing
supporting artifacts, and invalid evidence intervals. It counterbalances query
mode order and reports per-question precision/recall at 10 and query wall time.
It does not manufacture reviewer effort. Record actually observed review_seconds
for metadata and annotations separately, including the measurement procedure and
unsuccessful searches. Missing effort remains null, not zero.

Metadata mode searches task identifier, robot and split; names themselves can
reveal outcomes, so it is not a label-hidden predictor. Annotation-assisted mode
also uses source text, labels and review history. Do not insert this pilot's
withheld scoring judgments into searchable reviews and then call that prediction.
A later label-hidden experiment needs a separately frozen feature contract and
held-out data. Report uncertainty and per-question failures; twenty questions
cannot establish broad retrieval or customer value.

PILOT_TEMPLATE.json is intentionally unreviewed. The application cannot replace
the human review required by the specification.
