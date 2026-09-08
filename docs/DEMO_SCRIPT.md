# Demo: protect the human corridor and still finish the task

1. Open Sources & runtime. Show two Unitree G1 models and the learned locomotion provenance. State that MuJoCo controls every displayed live pose. Identify live, recorded replay and authored reference modes before switching among them.
2. Show the human keepout corridor, robot starts and distinct goals. Explain the measurable requirement: both robots finish without robot/obstacle contact, falls, corridor intrusion or stage escape. Doing nothing does not satisfy completion.
3. Run independent coordination or search for a counterexample. Show the actual failure event, metrics, seed and frozen checkpoint. If no counterexample is found, report that result; do not narrate an invented collision.
4. Optionally compare the built-in reservation reference on that scene. Label it authored reference. It establishes a comparison, not evidence that Astra repaired anything.
5. Request Astra repair only when runtime access and budget are available. Show generated executable coordination source, source hash and the fixed evaluator's real feedback. Explain that the model changes source and returned memory, not the learned walking policy, physics or evaluator.
6. Replay the submitted candidate from the frozen checkpoint. Show both completion and violation metrics. A failed repair remains failed. A passing candidate applies only to this measured scene so far.
7. Run held-out scenes with the same frozen source. Show denominator, seeds and every result that actually ran. Do not present training-scene success as generalization or omit failed trials.
8. Pair a real phone over HTTPS. The user taps Start camera; show continuous video while the simulation controls remain usable. Capture a still and manually identify measured floor corners/dimensions. Confirm geometry changes and stale-result invalidation. Explain that this is a planar floor reference, not automatic 3D reconstruction.
9. Stop the phone camera and close with the observed scope: which scene passed, which held-out cases ran, and what failed or remains untested. If no phone is available, demonstrate the pairing UI as unverified and say the actual device gate remains open.

Suggested closing sentence, filled only with observed values: “The frozen coordinator completed [N] of [M] tested scenes under this evaluator while respecting the measured corridor constraints. [Failures/limitations]. This demonstrates a testable coordination repair loop in simulation; physical robot deployment is outside this result.”
