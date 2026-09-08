"""Deployment definition only. Root operator provisions secret and deploys.

modal deploy perception/modal_app.py
Secret name: astralignment-perception, field PERCEPTION_TOKEN (>=32 chars).
"""
import os
from pathlib import Path
import modal

SOURCE_REVISION = "3d835ec1a5802d64a8b8b15f817a1ab54809bfe4"
HERE = Path(__file__).resolve().parent
app = modal.App("astralignment-perception")


def cache_models():
    from huggingface_hub import snapshot_download
    snapshot_download("depth-anything/DA3-BASE", revision="f4a6c9b3c95e41c82048423d3493a81ec3fa810e",
                      allow_patterns=["config.json", "model.safetensors"])
    snapshot_download("depth-anything/DA3METRIC-LARGE", revision="4010e39f3634a45bc60553321fb49fb760bd594e",
                      allow_patterns=["config.json", "model.safetensors"])


gpu_image = (modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0", "libgomp1")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .run_commands("pip install --no-deps git+https://github.com/ByteDance-Seed/Depth-Anything-3.git@"+SOURCE_REVISION)
    .run_commands("python -c 'from depth_anything_3.api import DepthAnything3; print(\"DA3 import verified\")'")
    .env({"HF_HOME": "/opt/hf-cache", "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "4"})
    .run_function(cache_models)
    .add_local_dir(str(HERE), remote_path="/root/perception", ignore=["**/.venv/**", "**/__pycache__/**", "**/.pytest_cache/**"]))

cpu_image = (modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi==0.116.1", "numpy==1.26.4", "Pillow==11.3.0")
    .add_local_dir(str(HERE), remote_path="/root/perception", ignore=["**/.venv/**", "**/__pycache__/**", "**/.pytest_cache/**"]))

gpu_type = os.environ.get("PERCEPTION_GPU", "L4")
if gpu_type not in ("L4", "L40S"):
    raise ValueError("PERCEPTION_GPU must be L4 or L40S")


@app.cls(image=gpu_image, gpu=gpu_type, cpu=4, memory=16384, max_containers=1,
         min_containers=0, buffer_containers=0, scaledown_window=60, timeout=120)
class GeometryGPU:
    @modal.enter()
    def load(self):
        from perception.engine import PerceptionEngine
        from perception.model import DA3Models
        self.engine = PerceptionEngine(DA3Models())

    @modal.method()
    def infer(self, payload: dict):
        return self.engine.process(payload)


@app.function(image=cpu_image, cpu=.25, memory=1024, max_containers=1, min_containers=0,
              buffer_containers=0, scaledown_window=60, timeout=120,
              secrets=[modal.Secret.from_name("astralignment-perception")])
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def web():
    from perception.service import create_app
    gpu = GeometryGPU()

    async def infer(payload):
        return await gpu.infer.remote.aio(payload)

    return create_app(infer)
