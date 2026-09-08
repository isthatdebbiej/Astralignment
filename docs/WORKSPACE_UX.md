# Workspace interaction model

The stage is the primary work surface. The default view has no permanent
sidebars, code editor, metrics cards, or expanded timeline.

- **Camera overlay / World:** switch the view of the same simulation. This does
  not reset physics or stop the phone stream.
- **Setup:** a dismissible drawer for the mission, measured stage, and camera
  pairing/calibration. Camera ownership survives hiding the drawer.
- **Code / Evidence / Trace:** one contextual inspector, closed initially. A
  single navigation row selects its contents; no duplicate tab strip.
- **Run / Pause:** persistent execution control. The adjacent action advances
  the experiment: find a counterexample, repair with Astra, or test held-out.
- **More scene actions:** less frequent operations such as randomizing starts,
  running the authored reference, and replaying a repair.
- **Timeline:** folded by default, expanded on demand or when replaying.
- **Runtime:** service details, provenance, and API/budget information.

Disclosure must not conceal errors, stale evidence, camera interruption,
recorded/reference mode, or an active task's cancellation control. Escape closes
the active surface and returns focus to its trigger. Setup traps keyboard focus
while open; hidden surfaces are removed from keyboard interaction.

Desktop acceptance checks cover stage space, panel toggles, keyboard closing,
focus restoration, camera-stream continuity, and nonblank authoritative robot
rendering. Real-phone alignment and mobile interaction are separate checks.
