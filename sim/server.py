"""FastAPI simulation service. Run: python -m sim.server (127.0.0.1:8001)."""
from __future__ import annotations

import asyncio
import copy
import hashlib
import inspect
import json
import logging
import math
import threading
import time
import textwrap
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field, model_validator

from .evaluator import evaluate, verdict
from .dimos_status import PINNED_DIMOS_VERSION, availability as dimos_availability
from .scene import SceneConfig, StrictModel, randomized_scene
from .world import ASSETS, ROBOT_ENVELOPE_RADIUS, SharedWorld

Mode = Literal["independent", "reservation", "external"]
log = logging.getLogger("astralignment.sim")


class ResetRequest(StrictModel):
    scene: SceneConfig | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31-1)
    expected_scene_epoch: int | None = Field(default=None, ge=0)
    expected_episode_id: str | None = Field(default=None, min_length=1, max_length=64)


class RunRequest(StrictModel):
    mode: Mode = "independent"


class StepRequest(StrictModel):
    commands: dict[str, tuple[float, float]] | None = None
    steps: int = Field(default=1, ge=1, le=50)

    @model_validator(mode="after")
    def bounded_commands(self):
        if self.commands is not None:
            if set(self.commands)-{"g1_a", "g1_b"}:
                raise ValueError("Commands contain an unknown robot ID")
            if any(not all(math.isfinite(value) for value in velocity) or math.hypot(*velocity) > .70001 for velocity in self.commands.values()):
                raise ValueError("World velocity commands must be finite and bounded to 0.7 m/s")
        return self


class ForkRequest(StrictModel):
    scene: SceneConfig | None = None
    checkpoint_id: str | None = None
    mode: Mode = "external"

    @model_validator(mode="after")
    def one_origin(self):
        if self.scene is not None and self.checkpoint_id is not None:
            raise ValueError("Choose scene or checkpoint_id, not both")
        return self


class EvaluateRequest(ForkRequest):
    mode: Mode = "independent"
    duration: float = Field(default=30, gt=0, le=60)
    commands: dict[str, tuple[float, float]] | None = None

    @model_validator(mode="after")
    def commands_valid(self):
        StepRequest(commands=self.commands)
        return self


class CommandsRequest(StepRequest):
    ttl_seconds: float = Field(default=.5, ge=.02, le=1)


class DimosHeartbeat(StrictModel):
    bridge_id: str = Field(min_length=1, max_length=64)
    version: Literal["0.0.12"]
    source: Literal["dimos-native"]
    ticks_published: int = Field(ge=0)
    commands_received: int = Field(ge=0)
    commands_rejected: int = Field(ge=0)
    last_sim_tick: int = Field(ge=0)
    error: str | None = Field(default=None, max_length=1000)
    control_enabled: bool


class SimulationService:
    def __init__(self):
        self.controller_source = textwrap.dedent(inspect.getsource(SharedWorld.desired_velocities)).strip()
        self.controller_source_hash = hashlib.sha256(self.controller_source.encode("utf-8")).hexdigest()
        self.lock = threading.RLock()
        self.world = SharedWorld()
        self.checkpoints = OrderedDict()
        self.branches = OrderedDict()
        self.branch_frames = {}
        self.branch_locks = {}
        self.evaluation_slots = threading.BoundedSemaphore(2)
        self.stop_event = threading.Event()
        self.thread = None
        self.error = None
        self.step_wall_ms = 0.
        self.dimos_heartbeat = None
        self.dimos_heartbeat_at = 0.

    def start(self):
        self.stop_event.clear()
        self.thread = threading.Thread(target=self.loop, name="mujoco-clock", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)

    def loop(self):
        while not self.stop_event.is_set():
            start = time.perf_counter()
            with self.lock:
                if not self.world.paused and not self.world.invalidated:
                    try:
                        self.world.step()
                        self.step_wall_ms = (time.perf_counter()-start)*1000
                        if self.world.metrics["falls"] or len(self.world.metrics["goals_reached"]) == 2:
                            self.world.paused = True
                    except Exception as exc:
                        self.world.paused = True
                        self.error = str(exc)
                        log.exception("Physics paused after error")
            self.stop_event.wait(max(.001, .02-(time.perf_counter()-start)))

    def branch(self, request):
        with self.lock:
            epoch = self.world.scene_epoch
            if request.scene is not None:
                checkpoint = None
                scene = request.scene.model_copy(deep=True)
            elif request.checkpoint_id is not None:
                if request.checkpoint_id not in self.checkpoints:
                    raise HTTPException(404, "Checkpoint not found or evicted")
                checkpoint = copy.deepcopy(self.checkpoints[request.checkpoint_id])
                if checkpoint["scene_epoch"] != epoch:
                    raise HTTPException(409, "Checkpoint invalidated by scene change")
                scene = None
            else:
                checkpoint = self.world.checkpoint()
                scene = None
        branch = SharedWorld.from_checkpoint(checkpoint) if checkpoint else SharedWorld(scene, scene_epoch=epoch)
        branch.mode = request.mode
        branch.paused = True
        return branch


service: SimulationService | None = None


def active():
    if service is None:
        raise HTTPException(503, "Simulation is starting")
    return service


@asynccontextmanager
async def lifespan(app):
    global service
    service = await asyncio.to_thread(SimulationService)
    service.start()
    yield
    service.stop()
    service = None


app = FastAPI(title="Astralignment authoritative two-G1 physics", version="0.1.0", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=str(ASSETS)), name="model-assets")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Raw invalid input may contain NaN/Infinity; echoing it would turn a clean
    # rejection into a JSON serialization failure. Return safe field diagnostics.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]})


@app.get("/health")
def health():
    svc = active()
    with svc.lock:
        return {"ok": svc.error is None, "service": "astralignment-mujoco", "physics_hz": 500,
                "policy_hz": 50, "robots": 2, "shared_world": True, "step_wall_ms": svc.step_wall_ms,
                "tick": svc.world.tick, "scene_epoch": svc.world.scene_epoch, "error": svc.error,
                "policy_hash": svc.world.policy_hash, "policy_source": svc.world.provenance.get("repository"),
                "modes": {"independent": "built-in baseline", "reservation": "built-in reference", "external": "bounded velocity interface"}}


@app.get("/scene")
def scene():
    svc = active()
    with svc.lock:
        return svc.world.scene.model_dump(mode="json")


@app.get("/state")
def state():
    svc = active()
    with svc.lock:
        return svc.world.snapshot()


@app.get("/model")
def model():
    svc = active()
    with svc.lock:
        return svc.world.model_description()


@app.get("/controller")
def controller_source():
    svc = active()
    return {"language": "python", "source": svc.controller_source, "source_hash": svc.controller_source_hash,
            "path": "sim/world.py::SharedWorld.desired_velocities",
            "provenance": "Built-in Astralignment reference controller; not generated by Astra",
            "envelope_radius_m": ROBOT_ENVELOPE_RADIUS,
            "description": "Independent goal seeking or conservative one-robot-at-a-time stage reservation"}


@app.get("/dimos/status")
def dimos_status():
    svc = active()
    with svc.lock:
        status = dimos_availability()
        age = time.monotonic()-svc.dimos_heartbeat_at if svc.dimos_heartbeat else None
        heartbeat = copy.deepcopy(svc.dimos_heartbeat)
    recent = heartbeat is not None and age < 3
    status.update({"active": bool(recent and heartbeat["error"] is None and heartbeat["ticks_published"] > 0),
                   "heartbeat_age_seconds": age, "bridge_report": heartbeat,
                   "evidence": "Recent telemetry reported by a native bridge" if recent else "No recent native bridge heartbeat"})
    return status


@app.post("/dimos/heartbeat")
def dimos_heartbeat(request: DimosHeartbeat):
    svc = active()
    with svc.lock:
        svc.dimos_heartbeat = request.model_dump()
        svc.dimos_heartbeat_at = time.monotonic()
    return {"accepted": True, "pinned_version": PINNED_DIMOS_VERSION}


@app.get("/random-scene")
def random_scene(seed: int = 7):
    if not 0 <= seed <= 2**31-1:
        raise HTTPException(422, "Seed must be in [0, 2147483647]")
    svc = active()
    with svc.lock:
        template = svc.world.scene.model_copy(deep=True)
    try:
        return randomized_scene(seed, template).model_dump(mode="json")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/reset")
def reset(request: ResetRequest = ResetRequest()):
    svc = active()
    with svc.lock:
        if request.expected_scene_epoch is not None and request.expected_scene_epoch != svc.world.scene_epoch:
            raise HTTPException(409, "Scene epoch changed; reload the current scene before resetting")
        if request.expected_episode_id is not None and request.expected_episode_id != svc.world.episode_id:
            raise HTTPException(409, "Episode changed; reload the current scene before resetting")
        new_scene = (request.scene or svc.world.scene).model_copy(deep=True)
        if request.seed is not None:
            try:
                new_scene = randomized_scene(request.seed, new_scene)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        new_world = SharedWorld(new_scene, scene_epoch=svc.world.scene_epoch+1)
        svc.world = new_world
        svc.error = None
        svc.branches.clear()
        svc.branch_frames.clear()
        svc.branch_locks.clear()
        return svc.world.snapshot()


@app.post("/run")
def run(request: RunRequest = RunRequest()):
    svc = active()
    with svc.lock:
        if svc.world.invalidated:
            raise HTTPException(409, "Scene invalidated; reset first")
        svc.world.mode = request.mode
        svc.world.paused = False
        return svc.world.snapshot()


@app.post("/pause")
def pause():
    svc = active()
    with svc.lock:
        svc.world.paused = True
        return svc.world.snapshot()


@app.post("/resume")
def resume():
    svc = active()
    with svc.lock:
        if svc.world.invalidated:
            raise HTTPException(409, "Scene invalidated; reset first")
        svc.world.paused = False
        return svc.world.snapshot()


@app.post("/invalidate")
def invalidate():
    svc = active()
    with svc.lock:
        svc.world.paused = True
        svc.world.invalidated = True
        svc.world.scene_epoch += 1
        svc.world.event("scene_invalidated")
        svc.branches.clear()
        svc.branch_frames.clear()
        svc.branch_locks.clear()
        return svc.world.snapshot()


@app.post("/step")
def step(request: StepRequest):
    svc = active()
    with svc.lock:
        if svc.world.invalidated:
            raise HTTPException(409, "Scene invalidated; reset first")
        if not svc.world.paused:
            raise HTTPException(409, "Pause before explicit stepping; use /commands for realtime external control")
        if request.commands is not None:
            svc.world.external_commands = {rid: list(request.commands.get(rid, [0., 0.])) for rid in svc.world.controllers}
            svc.world.external_expires_tick = svc.world.tick + 250
        for _ in range(request.steps):
            svc.world.step(request.commands)
        return svc.world.snapshot()


@app.post("/commands")
def commands(request: CommandsRequest):
    svc = active()
    with svc.lock:
        if svc.world.invalidated:
            raise HTTPException(409, "Scene invalidated; reset first")
        if svc.world.mode != "external":
            raise HTTPException(409, "Run external mode before submitting realtime commands")
        svc.world.external_commands = {rid: list((request.commands or {}).get(rid, [0., 0.])) for rid in svc.world.controllers}
        svc.world.external_expires_tick = svc.world.tick+math.ceil(request.ttl_seconds*500)
        return {"accepted": True, "tick": svc.world.tick, "expires_tick": svc.world.external_expires_tick}


@app.post("/checkpoint")
def checkpoint():
    svc = active()
    with svc.lock:
        checkpoint_id = str(uuid.uuid4())
        captured = svc.world.checkpoint()
        svc.checkpoints[checkpoint_id] = captured
        state_hash = hashlib.sha256(json.dumps(captured, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
        while len(svc.checkpoints) > 16:
            svc.checkpoints.popitem(last=False)
        return {"checkpoint_id": checkpoint_id, "state_hash": state_hash, "checkpoint": captured, "episode_id": svc.world.episode_id,
                "scene_epoch": svc.world.scene_epoch, "tick": svc.world.tick, "state": svc.world.snapshot()}


@app.post("/fork")
def fork(request: ForkRequest = ForkRequest()):
    svc = active()
    branch = svc.branch(request)
    branch_id = str(uuid.uuid4())
    with svc.lock:
        if len(svc.branches) >= 12:
            raise HTTPException(429, "Branch limit reached; delete a branch before forking")
        if branch.scene_epoch != svc.world.scene_epoch:
            raise HTTPException(409, "Scene changed while creating branch")
        svc.branches[branch_id] = branch
        svc.branch_frames[branch_id] = [branch.snapshot()]
        svc.branch_locks[branch_id] = threading.RLock()
    return {"branch_id": branch_id, "state": branch.snapshot()}


def get_branch(svc, branch_id):
    branch = svc.branches.get(branch_id)
    if branch is None:
        raise HTTPException(404, "Branch not found or invalidated")
    if branch.scene_epoch != svc.world.scene_epoch:
        raise HTTPException(409, "Branch invalidated by scene change")
    return branch


@app.post("/branch/{branch_id}/step")
def branch_step(branch_id: str, request: StepRequest):
    svc = active()
    with svc.lock:
        branch = get_branch(svc, branch_id)
        branch_lock = svc.branch_locks[branch_id]
        frames = svc.branch_frames[branch_id]
    with branch_lock:
        if branch.data.time >= 120:
            raise HTTPException(409, "Branch reached its 120-second simulation limit")
        for _ in range(request.steps):
            branch.step(request.commands)
        snapshot = branch.snapshot()
        frames.append(snapshot)
        if len(frames) > 601:
            del frames[1]
    with svc.lock:
        get_branch(svc, branch_id)
    return snapshot


@app.get("/branch/{branch_id}/result")
def branch_result(branch_id: str):
    svc = active()
    with svc.lock:
        branch = get_branch(svc, branch_id)
        branch_lock = svc.branch_locks[branch_id]
        frames = svc.branch_frames[branch_id]
    with branch_lock:
        result = verdict(branch, copy.deepcopy(frames))
    with svc.lock:
        get_branch(svc, branch_id)
    return result


@app.delete("/branch/{branch_id}")
def delete_branch(branch_id: str):
    svc = active()
    with svc.lock:
        svc.branches.pop(branch_id, None)
        svc.branch_frames.pop(branch_id, None)
        svc.branch_locks.pop(branch_id, None)
        return {"ok": True}


@app.post("/evaluate")
def evaluate_route(request: EvaluateRequest):
    svc = active()
    if not svc.evaluation_slots.acquire(blocking=False):
        raise HTTPException(429, "Two evaluations are already running")
    try:
        branch = svc.branch(request)
        result = evaluate(branch, request.duration, request.commands)
    finally:
        svc.evaluation_slots.release()
    with svc.lock:
        if branch.scene_epoch != svc.world.scene_epoch:
            raise HTTPException(409, "Evaluation invalidated by scene change")
    return result


@app.websocket("/ws/state")
async def state_socket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            svc = active()
            with svc.lock:
                snapshot = svc.world.snapshot()
            await websocket.send_json(snapshot)
            await asyncio.sleep(.05)
    except (WebSocketDisconnect, RuntimeError):
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("sim.server:app", host="127.0.0.1", port=8001, log_level="info")
