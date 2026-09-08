# Live workflow check — 2026-09-08

Verified on the Vultr deployment with real MuJoCo and GPT-6 Astra, not mocked responses.

- Counterexample search: seed 7, first trial failed with inter-robot contact; 835 contact ticks, both goals reached, 52 returned frames.
- Repair `aaef9931-9194-4354-bbee-65ca8354cb84`: passed, both goals reached in 18.8 simulated seconds, zero measured contacts/zone violations/falls; 95 frames. Estimated API cost $0.478751.
- A subsequent repair, `97e047cf-a516-4aaa-ab26-0150eeebb472`, also passed. Its replay completed in 19.2 simulated seconds with zero measured violations and 97 frames.
- Held-out tests of the subsequent repair: seeds 104736 and 418923 passed; 209465 and 314194 failed to finish both goals within the horizon. Result: 2/4, not a generalization claim.
- Desktop Chrome after the frontend update: repair button enabled after fresh page load; Replay repair returned HTTP 200; World canvas present; no page exceptions. Camera input was not opened or replaced by this browser test.

## Corrections

Search previously loaded the final frame and paused. It now plays its returned trajectory from frame zero. Repair previously saved the result without displaying its motion; it now plays the evaluated trajectory, subject to source and origin checks.

Counterexample hydration now retries when world identity becomes available and restores valid server evidence after reload. The deployed frontend uses the existing event-history fallback; the new `/api/search/current` server route is prepared in source but was not activated in this check, to avoid restarting the gateway and losing the live checkpoint/camera pairing.

The production build and focused playback guard test passed. Frontend assets were published without restarting services.

These checks cover coordination-code counterfactuals: different executable policies evaluated from a frozen physics checkpoint. Object-handoff assurances and counterfactual human support-removal actions remain unimplemented.
