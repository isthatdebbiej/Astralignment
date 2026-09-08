"""Loopback-only GPU worker. SSH forwarding may expose it to the remote host only."""
from io import BytesIO
import threading

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from depth_local.run import infer, load_model

app = FastAPI(title='Astralignment local relative-depth worker')
model = None
lock = threading.Lock()


@app.on_event('startup')
def startup():
    global model
    torch.set_num_threads(4)
    model = load_model()


@app.get('/health')
def health():
    return {'ready': model is not None, 'model': 'Depth-Anything-V2-Small',
            'device': torch.cuda.get_device_name(0), 'units': 'relative inverse depth, not meters',
            'tracking': False, 'simulator_connected': False}


@app.post('/depth')
def depth(file: UploadFile = File(...)):
    data = file.file.read(5_000_001)
    if len(data) > 5_000_000:
        raise HTTPException(413, 'Image upload limit is 5 MB')
    try:
        with Image.open(BytesIO(data)) as source:
            if source.width * source.height > 8_000_000:
                raise ValueError('Image exceeds 8 megapixels')
            image = cv2.cvtColor(np.asarray(source.convert('RGB')), cv2.COLOR_RGB2BGR)
    except Exception:
        raise HTTPException(400, 'Invalid image or over 8 megapixels')
    if not lock.acquire(blocking=False):
        raise HTTPException(429, 'Worker busy; retry with the latest frame')
    try:
        result, ms = infer(model, image)
        output = BytesIO()
        np.save(output, result, allow_pickle=False)
        return Response(output.getvalue(), media_type='application/octet-stream', headers={
            'X-Depth-Units': 'relative-inverse-depth', 'X-Inference-Ms': f'{ms:.1f}',
            'Cache-Control': 'no-store'})
    finally:
        lock.release()
