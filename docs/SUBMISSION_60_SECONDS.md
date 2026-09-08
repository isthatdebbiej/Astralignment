# One-minute submission cut

Record the actual application. Do not submit synthetic QA footage as live stage
video or present a prior repair as a fresh model call.

## Before recording

1. Open the deployed HTTPS workspace and unlock with the private operator token.
2. Fix the phone in place, preferably landscape and on power. Pair and start its
   rear camera. Keep the phone awake; do not zoom or move it after calibration.
3. Mark a measured rectangular floor patch; enter its real width and depth.
   Check the robot feet against the floor. Adjust the estimated lens if needed.
4. Confirm the presenter corridor and any collision boxes. They are authored
   safety geometry, not automatically recovered from the video.
5. Verify funded Astra access, run the intended scene once, and confirm replay.
   Keep a completed measured run available, visibly identified as recorded if used.

## Shot sequence

| Time | Screen action | Narration |
|---|---|---|
| 0–10 s | Real stage camera with two simulated G1s | “This is the stage right now. The people and room are real video; these two robots run learned locomotion in MuJoCo.” |
| 10–22 s | Run independent coordination; inspect actual failure | “Each robot can walk. Together, their plans conflict with each other and the human corridor.” |
| 22–38 s | Fork with Astra; show generated coordinator and evaluator response | “Astra inspects the frozen failure and writes a new coordinator. It cannot change physics or the scoring rules.” |
| 38–50 s | Replay repaired source; show both goals and measured violations | “We replay the same starting state. Completion matters: stopping both robots does not pass.” |
| 50–60 s | Held-out results and live camera | “Now we test the same code on unseen starts. Astralignment turns a human instruction into an executable, falsifiable robotics experiment.” |

Generation can take longer than the video. Use an obvious editorial cut or a
clearly marked prior run; do not accelerate it invisibly or invent latency.
Replace narration about success with the observed outcome if any test fails.

## Submission checklist

- Public repository and new hackathon contribution clearly identified.
- Disclose pretrained Unitree policy/meshes and reused adapter foundations with
  their attribution; do not claim new locomotion training or a new model.
- Show Astra both in development and in the product's executable repair loop.
- Link the one-minute video and repository. Do not publish operator, API, pairing,
  SSH, or TURN credentials, raw venue guide, or secret-bearing terminal output.
- Claim coordination testing and repair in simulation, not solved alignment or
  physical robot safety. A live video overlay is not a reconstructed 3D world.
