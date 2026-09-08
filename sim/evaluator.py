"""Independent fixed evaluator. No generated source is accepted or executed."""
from __future__ import annotations

import math

from .world import SharedWorld


def verdict(world: SharedWorld, frames=None):
    metrics = world.public_metrics()
    reasons = []
    for key, label in [("robot_contacts", "inter-robot contact"), ("obstacle_contacts", "obstacle contact"),
                       ("keepout_violations", "keepout entry"), ("boundary_violations", "stage boundary crossing"),
                       ("falls", "fall")]:
        if metrics[key]:
            reasons.append(label)
    if metrics["goals_reached"] < 2:
        reasons.append("both goals not reached within horizon")
    if metrics["deadlock"]:
        reasons.append("completion timeout")
    return {"episode_id": world.episode_id, "scene_epoch": world.scene_epoch, "mode": world.mode,
            "seed": world.scene.seed, "policy_hash": world.policy_hash, "passed": not reasons,
            "metrics": metrics, "frames": frames if frames is not None else [world.snapshot()],
            "events": list(world.events), "reason": "; ".join(reasons) if reasons else "Both goals reached without measured contact, fall, or zone violation"}


def evaluate(world: SharedWorld, duration: float, commands=None):
    if not math.isfinite(duration) or not 0 < duration <= 60:
        raise ValueError("Evaluation duration must be in (0, 60] seconds")
    frames = [world.snapshot()]
    steps = math.ceil(duration/.02)
    for index in range(steps):
        world.step(commands)
        if index % 10 == 9:
            frames.append(world.snapshot())
        if world.metrics["falls"] or len(world.metrics["goals_reached"]) == 2:
            break
    if frames[-1]["tick"] != world.tick:
        frames.append(world.snapshot())
    return verdict(world, frames)
