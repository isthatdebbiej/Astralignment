"""Operator-invoked real GPU smoke using explicitly supplied JPEG files.

Reads PERCEPTION_URL and PERCEPTION_TOKEN from environment; never prints
either. Does not reset or mutate any simulator. This is not live-camera QA.
"""
import argparse
import base64
import io
import json
import os
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import uuid
from PIL import Image, ImageOps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", help="Explicitly authorized JPEG files, in temporal order")
    args = parser.parse_args()
    if not 1 <= len(args.images) <= 4:
        parser.error("Supply one to four JPEG files")
    url, token = os.environ["PERCEPTION_URL"], os.environ["PERCEPTION_TOKEN"]
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ValueError("Use an HTTPS service URL without embedded credentials")
    session_id = str(uuid.uuid4())
    paths = args.images if len(args.images) > 1 else args.images*2
    for frame_id, path in enumerate(paths):
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((640, 480), Image.Resampling.LANCZOS)
            width, height = image.size
            encoded = io.BytesIO()
            image.save(encoded, format="JPEG", quality=88)
            raw = encoded.getvalue()
        payload = {"session_id": session_id, "frame_id": frame_id, "captured_at": time.time()*1000,
                   "frame_width": width, "frame_height": height, "stage_width": 8, "stage_depth": 6,
                   "image": "data:image/jpeg;base64,"+base64.b64encode(raw).decode()}
        body = json.dumps(payload, allow_nan=False).encode()
        request = Request(url.rstrip("/")+"/infer", data=body,
                          headers={"Authorization": "Bearer "+token, "Content-Type": "application/json"})
        with urlopen(request, timeout=120) as response:
            result = json.load(response)
        summary = {key: result.get(key) for key in ("frame_id", "status", "scale", "reason", "model",
                   "inference_ms", "floor_inlier_ratio", "reprojection_error_px")}
        summary["has_projection"] = result.get("world_to_clip") is not None
        summary["evidence"] = "real-model-on-operator-supplied-stills; not live-camera tracking verification"
        print(json.dumps(summary, allow_nan=False))
        if result["status"] == "tracking":
            assert len(result["world_to_clip"]) == 16


if __name__ == "__main__":
    main()
