"""Bounded session tracker over real DA3 outputs and independent image matches."""
import base64
from collections import OrderedDict
from dataclasses import dataclass, field
import io
import time
import numpy as np
from PIL import Image

from .geometry import (GeometryError, fit_floor, homogeneous, relative_camera,
                       reprojection_error, robust_scale, world_to_clip)
from .provenance import MODEL_LABEL


def decode_image(request):
    image = request["image"]
    if not isinstance(image, str) or not image.startswith("data:image/jpeg;base64,"):
        raise ValueError("Expected a JPEG data URL")
    if len(image) > 4_000_000:
        raise ValueError("JPEG request exceeds 4MB encoded bound")
    raw = base64.b64decode(image.split(",", 1)[1], validate=True)
    with Image.open(io.BytesIO(raw)) as pil:
        width, height = pil.size
        if pil.format != "JPEG" or width*height > 2_500_000 or min(width, height) < 64 or max(width, height) > 1920:
            raise ValueError("JPEG dimensions outside 64..1920 / 2.5MP bound")
        if (width, height) != (request["frame_width"], request["frame_height"]):
            raise ValueError("Declared frame dimensions do not match decoded JPEG")
        if pil.getexif().get(274, 1) != 1:
            raise ValueError("Send an orientation-normalized JPEG without EXIF rotation")
        return np.asarray(pil.convert("RGB")).copy()


def depth_preview(depth):
    depth = np.asarray(depth)
    good = np.isfinite(depth) & (depth > .1) & (depth < 35)
    if good.sum() < 50:
        return None
    # Diagnostic relative palette only; the geometry retains numerical metres.
    low, high = np.quantile(depth[good], [.03, .97])
    normalized = np.zeros(depth.shape, dtype=np.float64)
    normalized[good] = np.clip((depth[good]-low)/max(high-low, .01), 0, 1)
    colors = np.stack([255*(1-normalized), 210*(1-np.abs(normalized-.5)*2), 255*normalized], axis=-1)
    colors[~good] = 0
    preview = Image.fromarray(colors.astype(np.uint8)).resize((320, max(1, round(320*depth.shape[0]/depth.shape[1]))))
    buffer = io.BytesIO()
    preview.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64,"+base64.b64encode(buffer.getvalue()).decode()


def matched_pixels(source, target):
    import cv2
    a = cv2.cvtColor(source, cv2.COLOR_RGB2GRAY)
    b = cv2.cvtColor(target, cv2.COLOR_RGB2GRAY)
    orb = cv2.ORB_create(nfeatures=1200, fastThreshold=12)
    key_a, desc_a = orb.detectAndCompute(a, None)
    key_b, desc_b = orb.detectAndCompute(b, None)
    if desc_a is None or desc_b is None:
        raise GeometryError("No stable image features; use a textured floor and steady camera")
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(desc_a, desc_b, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .75*pair[1].distance]
    # One-to-one targets avoid duplicate texture giving misleading support.
    unique = {}
    for match in sorted(good, key=lambda item: item.distance):
        unique.setdefault(match.trainIdx, match)
    if len(unique) < 24:
        raise GeometryError("Insufficient frame overlap or texture for camera tracking")
    good = list(unique.values())
    return np.array([key_a[m.queryIdx].pt for m in good]), np.array([key_b[m.trainIdx].pt for m in good])


@dataclass
class Session:
    anchor: np.ndarray
    dimensions: tuple
    stage: tuple
    last_id: int
    last_captured: float
    last_seen: float
    anchor_metric: np.ndarray | None = None
    anchor_sky: np.ndarray | None = None
    anchor_k: np.ndarray | None = None
    floor: object | None = None
    history: list = field(default_factory=list)
    last_pose: np.ndarray | None = None
    last_pose_time: float | None = None
    result: dict | None = None


class PerceptionEngine:
    MAX_SESSIONS = 8
    SESSION_TTL = 120

    def __init__(self, models):
        self.models = models
        self.sessions = OrderedDict()

    def process(self, request):
        started = time.monotonic()
        result = {key: request[key] for key in (
            "session_id", "frame_id", "captured_at", "frame_width", "frame_height")}
        result.update(processed_at=time.time()*1000, status="searching", world_to_clip=None,
                      scale="unavailable", reason="Searching for floor and camera geometry",
                      model=MODEL_LABEL, inference_ms=0)
        now = time.monotonic()
        for key in list(self.sessions):
            if now-self.sessions[key].last_seen > self.SESSION_TTL:
                del self.sessions[key]
        session_id = request["session_id"]
        session = self.sessions.get(session_id)
        if session is None and request["frame_id"] != 0:
            result.update(status="lost", reason="Anchor unavailable after expiry/cold start; begin a new session at frame 0")
            return result
        if session is not None and request["frame_id"] == session.last_id and session.result is not None:
            # HTTP retry of exactly this accepted payload is handled by the gateway;
            # do not spend another GPU inference on a duplicate frame id.
            result.update(status="lost", reason="Duplicate frame id; send a newer frame")
            return result
        try:
            image = decode_image(request)
            dimensions = (request["frame_width"], request["frame_height"])
            stage = (request["stage_width"], request["stage_depth"])
            if session is None:
                while len(self.sessions) >= self.MAX_SESSIONS:
                    self.sessions.popitem(last=False)
                session = Session(image, dimensions, stage, request["frame_id"], request["captured_at"], now)
                self.sessions[session_id] = session
            else:
                if request["frame_id"] <= session.last_id or request["captured_at"] <= session.last_captured:
                    raise GeometryError("Out-of-order frame or capture timestamp")
                if dimensions != session.dimensions or stage != session.stage:
                    raise GeometryError("Camera dimensions or stage changed; start a new session")
                session.last_id = request["frame_id"]
                session.last_captured = request["captured_at"]
                session.last_seen = now
                self.sessions.move_to_end(session_id)
            # Anchor remains first and is never replaced. Two accepted context
            # frames plus current frame give a strict maximum of four images.
            first = request["frame_id"] == 0
            images = [session.anchor] if first else [session.anchor, *session.history[-2:], image]
            prediction = self.models.predict(images)
            preview = depth_preview(prediction.latest_metric)
            if preview:
                result["depth_preview"] = preview
            if session.anchor_metric is None:
                if not first:
                    raise GeometryError("Initial anchor metric depth failed; start a new session")
                session.anchor_metric = prediction.latest_metric.copy()
                session.anchor_sky = prediction.latest_sky
                session.anchor_k = prediction.intrinsics[0].copy()
            scale, scatter = robust_scale(prediction.depths[0], session.anchor_metric,
                                          prediction.confidence[0], session.anchor_sky)
            if session.floor is None:
                session.floor = fit_floor(session.anchor_metric, session.anchor_k,
                                          prediction.confidence[0], session.anchor_sky)
            floor = session.floor
            result["floor_inlier_ratio"] = floor.inlier_ratio
            if first:
                result.update(reason="Floor candidate found; waiting for a second overlapping frame to verify pose", scale="estimated_metric")
                return self._finish(result, started, session)
            latest = relative_camera(prediction.extrinsics[-1], prediction.extrinsics[0], scale)
            if np.linalg.norm(latest[:3, 3]) > 15:
                raise GeometryError("Camera moved beyond the bounded anchor tracking region")
            # A changing estimated focal or metric geometry must not silently
            # resize the retained world. Its original anchor remains fixed.
            focal_ratio = prediction.intrinsics[0][0, 0]/session.anchor_k[0, 0]
            if not .8 < focal_ratio < 1.25:
                raise GeometryError("Anchor intrinsics changed too much; tracking lost")
            current_scale, _ = robust_scale(prediction.depths[-1], prediction.latest_metric,
                                             prediction.confidence[-1], prediction.latest_sky)
            if not .65 < current_scale/scale < 1.55:
                raise GeometryError("Current metric scale disagrees with retained anchor")
            previous_index = len(images)-2  # last accepted context, or anchor
            previous = relative_camera(prediction.extrinsics[previous_index], prediction.extrinsics[0], scale)
            uv, observed = matched_pixels(prediction.images[previous_index], prediction.images[-1])
            error, inlier_fraction, matches = reprojection_error(
                uv, observed, prediction.depths[previous_index]*scale,
                prediction.intrinsics[previous_index], prediction.intrinsics[-1], latest @ np.linalg.inv(previous))
            result["reprojection_error_px"] = error
            if error > 8 or inlier_fraction < .55:
                raise GeometryError(f"Independent image matches reject camera pose ({error:.1f}px median error)")
            if session.last_pose is not None:
                dt = max(.1, (request["captured_at"]-session.last_pose_time)/1000)
                relative = latest @ np.linalg.inv(session.last_pose)
                angle = np.arccos(np.clip((np.trace(relative[:3, :3])-1)/2, -1, 1))
                if np.linalg.norm(relative[:3, 3]) > min(3., .25+2*dt) or angle > min(1.2, .2+2*dt):
                    raise GeometryError("Implausible camera pose jump; overlay withheld")
            camera_from_stage = latest @ floor.anchor_from_stage
            # The centre must remain in front of the camera. Never mirror or
            # clamp behind-camera points into a plausible-looking overlay.
            if camera_from_stage[2, 3] <= .15:
                raise GeometryError("Anchored stage is behind the current camera")
            height, width = prediction.depths.shape[-2:]
            result.update(status="tracking", scale="estimated_metric",
                          world_to_clip=world_to_clip(prediction.intrinsics[-1], width, height, camera_from_stage),
                          reason=f"Estimated metric floor; {matches} image matches, {error:.1f}px residual. Not measured calibration.")
            session.last_pose, session.last_pose_time = latest, request["captured_at"]
            session.history = [*session.history, image][-2:]
            # Diagnostic additions are intentionally separate from the strict
            # shared contract; numerical acceptance fields above are enough.
        except GeometryError as exc:
            result.update(status="lost" if session and session.last_pose is not None else "searching",
                          world_to_clip=None, reason=str(exc))
        except (ValueError, TypeError, OSError) as exc:
            result.update(status="error", world_to_clip=None, reason=str(exc)[:300])
        return self._finish(result, started, session)

    @staticmethod
    def _finish(result, started, session):
        result["processed_at"] = time.time()*1000
        result["inference_ms"] = (time.monotonic()-started)*1000
        if session is not None:
            session.result = result
        return result
