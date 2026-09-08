"""Local CUDA depth benchmark; relative inverse depth, not metric geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor' / 'depth-anything-v2'))
import cv2
import numpy as np
import torch
from depth_anything_v2.dpt import DepthAnythingV2


def load_model():
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable. No silent CPU fallback; check driver/runtime.')
    model = DepthAnythingV2(encoder='vits', features=64, out_channels=[48, 96, 192, 384])
    weights = ROOT / 'models' / 'depth' / 'depth_anything_v2_vits.pth'
    model.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True))
    return model.to('cuda').eval()


@torch.inference_mode()
def infer(model, image, size=266):
    torch.cuda.synchronize()
    started = time.perf_counter()
    result = model.infer_image(image, input_size=size)
    torch.cuda.synchronize()
    if not np.isfinite(result).all():
        raise RuntimeError('Non-finite depth output')
    return result, (time.perf_counter() - started) * 1000


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--size', type=int, default=266, choices=[266, 392, 518])
    parser.add_argument('--runs', type=int, default=5, choices=range(1, 21))
    args = parser.parse_args()
    torch.set_num_threads(4)
    model = load_model()
    image = cv2.imread(str(args.image))
    if image is None:
        raise ValueError(f'Cannot decode {args.image}')
    torch.cuda.reset_peak_memory_stats()
    _, cold_ms = infer(model, image, args.size)
    timings = []
    for _ in range(args.runs):
        result, elapsed = infer(model, image, args.size)
        timings.append(elapsed)
    output = ROOT / 'artifacts' / 'depth'
    output.mkdir(parents=True, exist_ok=True)
    np.save(output / 'relative-depth.npy', result)
    preview = ((result - result.min()) / max(float(np.ptp(result)), 1e-6) * 255).astype(np.uint8)
    cv2.imwrite(str(output / 'relative-depth.png'), preview)
    report = {'device': torch.cuda.get_device_name(0), 'torch': torch.__version__,
              'cuda_runtime': torch.version.cuda, 'input_size': args.size, 'image': str(args.image),
              'image_sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(),
              'units': 'relative inverse depth; not meters', 'cold_ms': cold_ms,
              'inference_ms': timings, 'median_ms': float(np.median(timings)),
              'peak_allocated_mib': torch.cuda.max_memory_allocated() / 1024**2,
              'output_shape': list(result.shape), 'finite': bool(np.isfinite(result).all())}
    (output / 'benchmark.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
