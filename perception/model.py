"""Thin real-model adapter. No downloaded remote code or model-name input."""
from dataclasses import dataclass
import numpy as np

from .geometry import GeometryError, metric_depth, valid_intrinsics
from .provenance import BASE_MODEL, BASE_REVISION, METRIC_MODEL, METRIC_REVISION


@dataclass
class Prediction:
    depths: np.ndarray
    confidence: np.ndarray
    extrinsics: np.ndarray
    intrinsics: np.ndarray
    images: np.ndarray
    latest_metric: np.ndarray
    latest_sky: np.ndarray | None


class DA3Models:
    def __init__(self):
        import torch
        from depth_anything_3.api import DepthAnything3
        if not torch.cuda.is_available():
            raise RuntimeError("Perception requires an actual CUDA GPU; no simulated model fallback")
        torch.set_num_threads(4)
        self.base = DepthAnything3.from_pretrained(BASE_MODEL, revision=BASE_REVISION).to("cuda").eval()
        self.metric = DepthAnything3.from_pretrained(METRIC_MODEL, revision=METRIC_REVISION).to("cuda").eval()

    def predict(self, images):
        import torch
        if not 1 <= len(images) <= 4:
            raise ValueError("Only anchor plus at most three context frames are admitted")
        kwargs = {"process_res": 504, "process_res_method": "upper_bound_resize",
                  "ref_view_strategy": "first", "infer_gs": False}
        with torch.inference_mode():
            base = self.base.inference(images, **kwargs)
            metric = self.metric.inference([images[-1]], **kwargs)
        if base.extrinsics is None or base.intrinsics is None or base.conf is None:
            raise GeometryError("DA3 did not return camera geometry and confidence")
        depths = np.asarray(base.depth, dtype=np.float64)
        if depths.ndim != 3 or len(depths) != len(images):
            raise GeometryError("Unexpected real-model depth tensor shape")
        height, width = depths.shape[-2:]
        intrinsics = np.asarray(base.intrinsics, dtype=np.float64)
        for k in intrinsics:
            valid_intrinsics(k, width, height)
        canonical = np.asarray(metric.depth[0], dtype=np.float64)
        if canonical.shape != (height, width):
            raise GeometryError("Metric and any-view image preprocessing disagree")
        sky = None if getattr(metric, "sky", None) is None else np.asarray(metric.sky[0], dtype=bool)
        return Prediction(depths, np.asarray(base.conf), np.asarray(base.extrinsics), intrinsics,
                          np.asarray(base.processed_images), metric_depth(canonical, intrinsics[-1]), sky)
