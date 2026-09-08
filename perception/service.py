"""CPU HTTP admission. Authentication and JPEG checks precede any GPU call."""
import asyncio
import hmac
import json
import os
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError
from PIL import Image

from .engine import decode_image
from .provenance import MODEL_LABEL, SOURCE_REVISION


class FrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    frame_id: int = Field(ge=0, le=2**31-1, strict=True)
    captured_at: FiniteFloat = Field(ge=0, le=1e15, strict=True)
    frame_width: int = Field(ge=64, le=1920, strict=True)
    frame_height: int = Field(ge=64, le=1920, strict=True)
    image: str = Field(max_length=4_000_000)
    stage_width: FiniteFloat = Field(ge=1, le=20, strict=True)
    stage_depth: FiniteFloat = Field(ge=1, le=20, strict=True)


def validate_request(payload):
    parsed = FrameRequest.model_validate(payload).model_dump(mode="json")
    decode_image(parsed)
    return parsed


def create_app(infer, token=None):
    app = FastAPI(title="Astralignment bounded camera geometry", docs_url=None, redoc_url=None, openapi_url=None)
    expected = token if token is not None else os.environ.get("PERCEPTION_TOKEN", "")
    if len(expected) < 32:
        raise RuntimeError("PERCEPTION_TOKEN must be provisioned with at least 32 characters")
    lock = asyncio.Lock()

    def authorize(request):
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, "Bearer "+expected):
            raise HTTPException(401, "Unauthorized")

    @app.get("/health")
    async def health(request: Request):
        authorize(request)
        return {"ok": True, "model": MODEL_LABEL, "source_revision": SOURCE_REVISION,
                "gpu": "on-demand", "max_gpu_containers": 1, "automatic_floor": True,
                "metric_calibration": "estimated, not measured", "max_context_frames": 4}

    @app.post("/infer")
    async def inference(request: Request):
        authorize(request)
        if lock.locked():
            raise HTTPException(429, "Perception busy; submit only one frame at a time")
        async with lock:
            data = bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 4_010_000:
                    raise HTTPException(413, "Frame request too large")
            try:
                payload = validate_request(json.loads(data))
            except (ValueError, TypeError, OSError, ValidationError, Image.DecompressionBombError):
                # Never echo image bytes, token, or malformed nonfinite JSON.
                raise HTTPException(422, "Invalid bounded JPEG frame request") from None
            try:
                return await infer(payload)
            except Exception:
                # Detailed exceptions can contain filesystem/model-server paths.
                # Return no stale pose and no fabricated fallback projection.
                raise HTTPException(503, "Real perception model unavailable; overlay withheld") from None
    return app
