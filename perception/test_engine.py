"""Synthetic pipeline/security fixtures. Real GPU inference is separate evidence."""
import base64
import io
import time
import uuid
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from perception.engine import PerceptionEngine
from perception.model import Prediction
from perception.service import create_app
from perception.test_geometry import scene_depth


def frame(image=None, session_id=None, frame_id=0):
    if image is None:
        image = np.random.default_rng(2).integers(0, 255, (240, 320, 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, format="JPEG")
    return {"session_id": session_id or str(uuid.uuid4()), "frame_id": frame_id,
            "captured_at": time.time()*1000+frame_id*100, "frame_width": 320, "frame_height": 240,
            "stage_width": 8, "stage_depth": 6,
            "image": "data:image/jpeg;base64,"+base64.b64encode(buffer.getvalue()).decode()}


class SyntheticModels:
    """Known plane + stationary cameras; does not emulate a trained network."""
    def __init__(self):
        self.batch_sizes = []

    def predict(self, images):
        self.batch_sizes.append(len(images))
        depth, k, _ = scene_depth()
        count = len(images)
        return Prediction(np.repeat(depth[None]/2, count, axis=0), np.ones((count, 240, 320)),
                          np.repeat(np.eye(4)[None], count, axis=0), np.repeat(k[None], count, axis=0),
                          np.stack(images), depth, None)


def test_bounded_anchor_tracking_then_expiry():
    models = SyntheticModels()
    engine = PerceptionEngine(models)
    request = frame()
    initial = engine.process(request)
    assert initial["status"] == "searching" and initial["world_to_clip"] is None
    origin = engine.sessions[request["session_id"]].floor.anchor_from_stage.copy()
    for i in range(1, 6):
        request["frame_id"] = i
        request["captured_at"] += 100
        result = engine.process(request)
        assert result["status"] == "tracking", result["reason"]
        assert len(result["world_to_clip"]) == 16
        assert result["scale"] == "estimated_metric"
        assert result["reprojection_error_px"] < 1e-6
        assert np.array_equal(engine.sessions[request["session_id"]].floor.anchor_from_stage, origin)
    assert models.batch_sizes == [1, 2, 3, 4, 4, 4]
    engine.sessions[request["session_id"]].last_seen = -1e12
    request["frame_id"] += 1
    expired = engine.process(request)
    assert expired["status"] == "lost" and expired["world_to_clip"] is None
    assert len(models.batch_sizes) == 6


def test_unsupported_tracking_does_not_return_old_projection():
    engine = PerceptionEngine(SyntheticModels())
    request = frame()
    engine.process(request)
    request["frame_id"], request["captured_at"] = 1, request["captured_at"]+100
    assert engine.process(request)["status"] == "tracking"
    black = frame(np.zeros((240, 320, 3), dtype=np.uint8), request["session_id"], 2)
    black["captured_at"] = request["captured_at"]+100
    lost = engine.process(black)
    assert lost["status"] == "lost" and lost["world_to_clip"] is None


def test_cpu_auth_and_image_validation_precede_gpu_call():
    calls = []
    async def infer(payload):
        calls.append(payload)
        return {"status": "searching"}
    token = "test-token-not-a-secret-"*2
    client = TestClient(create_app(infer, token=token))
    request = frame()
    assert client.post("/infer", json=request).status_code == 401
    assert calls == []
    headers = {"Authorization": "Bearer "+token}
    broken = dict(request, image="data:image/jpeg;base64,broken")
    assert client.post("/infer", json=broken, headers=headers).status_code == 422
    assert client.post("/infer", json=dict(request, frame_width=321), headers=headers).status_code == 422
    assert client.post("/infer", json=dict(request, stage_width=True), headers=headers).status_code == 422
    assert calls == []
    assert client.get("/health", headers=headers).json()["gpu"] == "on-demand"
    assert calls == []
    assert client.post("/infer", json=request, headers=headers).status_code == 200
    assert len(calls) == 1


def test_duplicate_and_stage_change_never_silently_reanchor():
    engine = PerceptionEngine(SyntheticModels())
    request = frame()
    engine.process(request)
    duplicate = engine.process(request)
    assert duplicate["status"] == "lost" and duplicate["world_to_clip"] is None
    request["frame_id"], request["captured_at"] = 1, request["captured_at"]+100
    request["stage_width"] = 10
    changed = engine.process(request)
    assert changed["world_to_clip"] is None and "new session" in changed["reason"]
