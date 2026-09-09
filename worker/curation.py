"""CPU-only BotFails snapshot worker. Never executes dataset code or downloads media."""
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.request
import urllib.error

ROOT = Path(os.environ.get("CURATION_SOURCE_ROOT", "runtime/sources")).resolve()
DATA = Path(os.environ.get("CURATION_DATA_DIR", "runtime/curation")).resolve()
API = os.environ.get("CURATION_API", "http://127.0.0.1:8788")
TOKEN = os.environ.get("CURATION_WORKER_TOKEN", "")
MAX_BYTES = int(os.environ.get("CURATION_MAX_IMPORT_BYTES", str(20 * 1024**3)))
MAX_EPISODES = 1000
ACTIVE_CANCEL = None

def safe(root, relative):
    p = (root / relative).resolve()
    if not p.is_relative_to(root) or not p.exists():
        raise ValueError("Missing or out-of-root artifact: " + str(relative))
    return p

def digest(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            if ACTIVE_CANCEL is not None and ACTIVE_CANCEL.is_set():
                raise RuntimeError("Job cancelled or lease lost")
            h.update(chunk)
    return h.hexdigest()

def stable(text):
    return hashlib.sha256(text.encode()).hexdigest()[:32]

def request(route, data):
    req = urllib.request.Request(API + "/api/v1" + route, json.dumps(data).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return json.loads(body) if body else None

def lines(p):
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def preflight(source):
    base = safe(ROOT, source["snapshot"])
    if (base / "BotFails").is_dir():
        base = safe(base, "BotFails")
    files = {}
    episodes = []
    findings = []
    for task in source["tasks"]:
        folder = safe(base, task)
        info = json.loads(safe(folder, "meta/info.json").read_text())
        if info.get("codebase_version") != "v2.0":
            raise ValueError("Unsupported BotFails schema; expected LeRobot v2.0")
        for name in ("info.json", "episodes.jsonl", "tasks.jsonl"):
            p = safe(folder, "meta/" + name)
            files[str(p.relative_to(ROOT))] = p.stat().st_size
        for row in lines(safe(folder, "meta/episodes.jsonl")):
            if len(episodes) >= MAX_EPISODES:
                raise ValueError("Select fewer tasks: 1000-episode admission limit")
            index = int(row["episode_index"])
            fmt = {"episode_index": index, "episode_chunk": index // int(info["chunks_size"])}
            paths = []
            for key, feature in info["features"].items():
                if feature.get("dtype") == "video":
                    rel = info["video_path"].format(**fmt, video_key=key)
                    paths.append((key, folder / rel))
            paths.append(("state/action", folder / info["data_path"].format(**fmt)))
            label = base / "labels" / task.split("/")[1] / ("episode_%06d_labels.csv" % index)
            if label.exists():
                paths.append(("source annotation", label))
            else:
                findings.append(task + "/" + str(index) + ": missing source annotation")
            record = {"index": index, "task": task, "info": info, "row": row, "files": []}
            for kind, p in paths:
                p = safe(ROOT, p.relative_to(ROOT))
                relative = str(p.relative_to(ROOT))
                files[relative] = p.stat().st_size
                record["files"].append({"kind": kind, "path": relative})
            episodes.append(record)
    total = sum(files.values())
    if total > MAX_BYTES:
        raise ValueError("Selected bytes exceed CURATION_MAX_IMPORT_BYTES")
    if shutil.disk_usage(DATA).free < max(64 * 1024**2, total // 20):
        raise ValueError("Insufficient free disk for bounded derived artifacts")
    return {"estimated_bytes": total, "files": [{"path": p, "bytes": b, "sha256": digest(safe(ROOT, p))} for p, b in files.items()],
            "episodes": episodes, "findings": findings}

def import_episode(source, record):
    info = record["info"]
    identity = source["revision"] + "/" + record["task"] + "/" + str(record["index"])
    eid = stable(source["id"] + "/" + identity)
    artifacts, streams, findings, annotations, channels = [], [], [], [], []
    frame_count = int(record["row"]["length"])
    fps = info.get("fps")
    duration = None
    for item in record["files"]:
        p = safe(ROOT, item["path"])
        sha = digest(p)
        a = {"id": stable(source["id"] + "/" + item["path"] + "/" + sha),
             "path": item["path"], "sha256": sha, "bytes": p.stat().st_size, "kind": item["kind"]}
        artifacts.append(a)
        if item["kind"].startswith("observation.images."):
            stream = {"id": stable(eid + item["kind"]), "kind": item["kind"],
                      "artifact_id": a["id"], "timing": "native video PTS; cross-clock relationship unknown"}
            streams.append(stream)
            try:
                probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                    "format=duration:stream=codec_type,nb_frames", "-of", "json", str(p)],
                    capture_output=True, timeout=30, check=True)
                meta = json.loads(probe.stdout)
                if not any(s.get("codec_type") == "video" for s in meta.get("streams", [])):
                    raise ValueError("No video stream")
                measured = float(meta["format"]["duration"])
                duration = measured if duration is None else min(duration, measured)
            except (OSError, ValueError, subprocess.SubprocessError, KeyError) as error:
                findings.append("Media probe failed: " + item["kind"] + ": " + str(error))
        elif item["kind"] == "state/action":
            try:
                import duckdb
                conn = duckdb.connect(config={"threads": "1", "memory_limit": "256MB"})
                columns = [r[0] for r in conn.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(p)]).fetchall()]
                channels = [c for c in ("timestamp", "frame_index", "action", "observation.state") if c in columns]
                count = conn.execute("SELECT count(*) FROM read_parquet(?)", [str(p)]).fetchone()[0]
                if count != frame_count:
                    findings.append("State/action row count differs from episode length")
                conn.close()
            except Exception as error:
                findings.append("State/action inspection failed: " + str(error))
        elif item["kind"] == "source annotation":
            with p.open(newline="") as f:
                labels = [row[0].strip() for row in csv.reader(f) if row]
            if len(labels) != frame_count:
                findings.append("Annotation frame count differs from episode length")
            start = 0
            for end in range(1, len(labels) + 1):
                if end == len(labels) or labels[end] != labels[start]:
                    annotations.append({"label": labels[start], "start_frame": start, "end_frame": end, "evidence": a["id"]})
                    start = end
    return {"id": eid, "source_id": source["id"], "source_episode": str(record["index"]),
        "family_id": stable(identity), "task": record["task"].split("/")[1], "split": record["task"].split("/")[0],
        "origin": source["origin"], "robot": info.get("robot_type"), "duration": duration,
        "fps": fps, "frames": frame_count, "upstream_splits": info.get("splits", {}),
        "task_text": record["row"].get("tasks", []), "streams": streams, "artifacts": artifacts,
        "annotations": annotations, "findings": findings, "channels": channels}

def export_version(version, job_id):
    import duckdb
    if any(e["findings"] for e in version["episodes"]):
        raise ValueError("Resolve episode integrity findings before export")
    for source in version.get("sources", []):
        for artifact in source.get("plan", {}).get("files", []):
            if digest(safe(ROOT, artifact["path"])) != artifact["sha256"]:
                raise ValueError("Source checksum mismatch: " + artifact["path"])
    destination = DATA / "exports" / job_id
    destination.mkdir(parents=True, exist_ok=True)
    for episode in version["episodes"]:
        for a in episode["artifacts"]:
            if digest(safe(ROOT, a["path"])) != a["sha256"]:
                raise ValueError("Source checksum mismatch: " + a["path"])
    selected = version["collection"]["members"]
    rows = []
    for member in selected:
        episode = next(e for e in version["episodes"] if e["id"] == member["episode_id"])
        # Keep original annotation scope, plus the selected interval reference. No slicing.
        for annotation in episode["annotations"]:
            interval = member["interval"]
            if interval:
                if interval["unit"] != "frames":
                    raise ValueError("Seconds-to-source-frame mapping is not verified for annotation export")
                if annotation["end_frame"] <= interval["start"] or annotation["start_frame"] >= interval["end"]:
                    continue
            rows.append({"episode_id": episode["id"], "producer": "source",
                         "selection": member["interval"], "record": annotation})
        for review in version["reviews"]:
            if review["episode_id"] == episode["id"]:
                scope = review.get("interval")
                interval = member["interval"]
                if scope and interval:
                    if scope["stream_id"] != interval["stream_id"] or scope["unit"] != interval["unit"]:
                        continue
                    if scope["end"] <= interval["start"] or scope["start"] >= interval["end"]:
                        continue
                rows.append({"episode_id": episode["id"], "producer": "reviewer",
                             "selection": member["interval"], "record": review})
    manifest = {**version, "exporter_version": "0.1.0", "media_bundled": False,
                "interval_semantics": "half-open references; original annotation scopes retained"}
    (destination / "manifest.json.tmp").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (destination / "annotations.jsonl.tmp").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    conn = duckdb.connect(config={"threads": "1", "memory_limit": "256MB"})
    conn.execute("CREATE TABLE annotations(episode_id VARCHAR, producer VARCHAR, selection_json VARCHAR, record_json VARCHAR)")
    if rows:
        conn.executemany("INSERT INTO annotations VALUES (?,?,?,?)",
            [(r["episode_id"], r["producer"], json.dumps(r["selection"]), json.dumps(r["record"])) for r in rows])
    output = str(destination / "annotations.parquet.tmp").replace("'", "''")
    conn.execute("COPY annotations TO '" + output + "' (FORMAT PARQUET)")
    conn.close()
    artifacts = []
    for name in ("manifest.json", "annotations.jsonl", "annotations.parquet"):
        p = destination / name
        os.replace(destination / (name + ".tmp"), p)
        artifacts.append({"id": stable(job_id + name), "path": str(p.relative_to(DATA)),
            "bytes": p.stat().st_size, "sha256": digest(p), "kind": name})
    return {"artifacts": artifacts, "annotation_count": len(rows)}

def preview_samples(payload):
    import duckdb
    artifact = payload["artifact"]
    filename = safe(ROOT, artifact["path"])
    if digest(filename) != artifact["sha256"]:
        raise ValueError("State/action checksum mismatch")
    offset, limit = int(payload["offset"]), int(payload["limit"])
    if offset < 0 or limit < 1 or limit > 128:
        raise ValueError("Invalid preview bounds")
    conn = duckdb.connect(config={"threads": "1", "memory_limit": "256MB"})
    try:
        available = [row[0] for row in conn.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(filename)]).fetchall()]
        columns = [c for c in ("timestamp", "frame_index", "action", "observation.state") if c in available]
        if not columns:
            raise ValueError("No supported recorded state/action channels")
        fields = ", ".join('"' + c + '"' for c in columns)
        records = conn.execute("SELECT " + fields + " FROM read_parquet(?) LIMIT ? OFFSET ?",
                               [str(filename), limit, offset]).fetchall()
        result = {"episode_id": payload["episode_id"], "artifact_sha256": artifact["sha256"],
                  "offset": offset, "columns": columns, "rows": [dict(zip(columns, row)) for row in records],
                  "timing": "Original recorded values and file row order; units and cross-clock mapping unverified. No interpolation."}
        encoded = json.dumps(result, allow_nan=False)
        if len(encoded.encode()) > 1024 * 1024:
            raise ValueError("Preview exceeds 1 MiB response budget; request fewer rows")
        return result
    finally:
        conn.close()

def execute(job):
    global ACTIVE_CANCEL
    stopped = threading.Event()
    lease_lost = threading.Event()
    ACTIVE_CANCEL = lease_lost
    def send(**values):
        if lease_lost.is_set():
            raise RuntimeError("Job cancelled or lease expired")
        return request("/internal/jobs/" + job["id"], {"attempt": job["attempt"], **values})
    def heartbeat():
        while not stopped.wait(10):
            try:
                send()
            except Exception:
                lease_lost.set()
                return
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        if job["kind"] == "preflight":
            result = preflight(job["payload"]["source"])
        elif job["kind"] == "import":
            source = job["payload"]["source"]
            fresh = preflight(source)
            if fresh["files"] != source["plan"]["files"]:
                raise ValueError("Selected files changed since preflight; register a new snapshot")
            for n, record in enumerate(fresh["episodes"]):
                send(stage="hashing and inspecting episode " + str(n + 1), progress=n / len(fresh["episodes"]))
                episode = import_episode(source, record)
                send(episode=episode)
            result = {"episodes": len(fresh["episodes"])}
        elif job["kind"] == "export":
            result = export_version(job["payload"]["version"], job["id"])
        elif job["kind"] == "preview":
            result = preview_samples(job["payload"])
        else:
            raise ValueError("Unsupported job kind")
        send(status="completed", result=result)
    except Exception as error:
        try:
            send(status="failed", error=str(error))
        except Exception:
            pass
    finally:
        stopped.set()
        thread.join(timeout=2)
        ACTIVE_CANCEL = None

if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("CURATION_WORKER_TOKEN is required")
    DATA.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            job = request("/internal/claim", {})
            if job:
                execute(job)
            else:
                time.sleep(2)
        except (OSError, urllib.error.URLError) as error:
            print("Worker waiting for API:", type(error).__name__, flush=True)
            time.sleep(3)
