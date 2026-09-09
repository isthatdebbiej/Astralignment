"""Acquire only the seven files for the pinned BotFails coffee episode 0.

Default is metadata-only planning. Recording downloads require --confirm-bytes.
No repository scripts execute; existing files must already match upstream hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request

REVISION = "3478e49d91e1737eb76dfee2d81bb22617039c13"
TASK = "test/domotic_makingCoffee_anomaly"
REPOSITORY = "kantine/BotFails"
PATHS = [f"BotFails/{TASK}/meta/{name}" for name in ("info.json", "episodes.jsonl", "tasks.jsonl")] + [
    f"BotFails/{TASK}/data/chunk-000/episode_000000.parquet",
    *[f"BotFails/{TASK}/videos/chunk-000/observation.images.logitech_{i}/episode_000000.mp4" for i in (1, 2)],
    "BotFails/labels/domotic_makingCoffee_anomaly/episode_000000_labels.csv",
]

def plan():
    parents = {}
    files = []
    for name in PATHS:
        parent = name.rsplit("/", 1)[0]
        if parent not in parents:
            url = f"https://huggingface.co/api/datasets/{REPOSITORY}/tree/{REVISION}/{parent}?limit=1000"
            with urllib.request.urlopen(url, timeout=30) as response:
                content = response.read(4*1024*1024+1)
                if len(content)>4*1024*1024:raise ValueError("Metadata exceeds budget")
                parents[parent] = {entry["path"]: entry for entry in json.loads(content)}
        entry = parents[parent][name]
        lfs = entry.get("lfs") or {}
        files.append({"path": name, "bytes": entry["size"], "oid": lfs.get("oid") or entry["oid"],
                      "algorithm": "sha256" if lfs else "git-blob-sha1"})
    return {"repository":REPOSITORY,"revision":REVISION,"task":TASK,"episode_indices":[0],
            "dataset_card":f"https://huggingface.co/datasets/{REPOSITORY}/blob/{REVISION}/README.md",
            "estimated_bytes":sum(f["bytes"] for f in files),"files":files}

def matches(filename, entry):
    if filename.stat().st_size!=entry["bytes"]:return False
    digest=hashlib.sha256() if entry["algorithm"]=="sha256" else hashlib.sha1()
    if entry["algorithm"]!="sha256":digest.update(f'blob {entry["bytes"]}\0'.encode())
    with filename.open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):digest.update(block)
    return digest.hexdigest()==entry["oid"]

def acquire(selection, destination, confirm_bytes):
    if selection["estimated_bytes"]!=confirm_bytes or not 0<confirm_bytes<=64*1024*1024:
        raise ValueError("Confirm the exact planned bytes, within the 64 MiB reference limit")
    root=Path(destination).resolve();root.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(root).free<confirm_bytes+64*1024*1024:raise ValueError("Insufficient local storage")
    for entry in selection["files"]:
        if entry["path"] not in PATHS:raise ValueError("Unrequested source file")
        filename=root/entry["path"]
        if not filename.resolve().is_relative_to(root):raise ValueError("Source path escapes destination")
        if filename.exists():
            if not matches(filename,entry):raise ValueError("Existing source differs; use a new snapshot directory")
            continue
        filename.parent.mkdir(parents=True,exist_ok=True)
        partial=filename.with_suffix(filename.suffix+".part")
        if partial.exists():raise ValueError("Interrupted download exists; inspect it or use a new snapshot directory")
        url=f'https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/{entry["path"]}'
        with urllib.request.urlopen(url,timeout=60) as response,partial.open("xb") as output:
            count=0
            for block in iter(lambda:response.read(1024*1024),b""):
                count+=len(block)
                if count>entry["bytes"]:raise ValueError("Download exceeds planned bytes")
                output.write(block)
            output.flush();os.fsync(output.fileno())
        if not matches(partial,entry):raise ValueError("Downloaded content does not match pinned upstream identity")
        os.replace(partial,filename)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination",default="runtime/sources/botfails-reference")
    parser.add_argument("--confirm-bytes",type=int)
    args=parser.parse_args();selection=plan();print(json.dumps(selection,indent=2),flush=True)
    if args.confirm_bytes is not None:
        acquire(selection,args.destination,args.confirm_bytes)
        print("Pinned selected files acquired and independently hashed. Register only episode index 0.")
