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
import sys
sys.path.insert(0, str(Path(__file__).parent))
from storage import ExportBudget, BoundedFile
from media import inspect_video
from metrics import peak_rss_bytes

ROOT = Path(os.environ.get("CURATION_SOURCE_ROOT", "runtime/sources")).resolve()
DATA = Path(os.environ.get("CURATION_DATA_DIR", "runtime/curation")).resolve()
API = os.environ.get("CURATION_API", "http://127.0.0.1:8788")
TOKEN = os.environ.get("CURATION_WORKER_TOKEN", "")
MAX_BYTES = int(os.environ.get("CURATION_MAX_IMPORT_BYTES", str(20 * 1024**3)))
MAX_EPISODES = 1000
ACTIVE_CANCEL = None
EXPORT_MAX_BYTES = int(os.environ.get("CURATION_EXPORT_MAX_BYTES", str(1024**3)))

def safe(root, relative):
    p = (root / str(relative).replace("\\", "/")).resolve()
    if not p.is_relative_to(root) or not p.exists():
        raise ValueError("Missing or out-of-root artifact: " + str(relative))
    return p

def digest(p):
    if not p.is_file():raise ValueError("Only regular source artifacts are supported")
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
    encoded=json.dumps(data,allow_nan=False).encode()
    if len(encoded)>2*1024*1024:raise ValueError("Worker result exceeds 2 MiB; select fewer episodes or tasks")
    req = urllib.request.Request(API + "/api/v1" + route, encoded,
        {"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return json.loads(body) if body else None

def lines(p):
    if not p.is_file():raise ValueError("Metadata must be a regular file")
    with p.open(encoding="utf-8") as f:
        while True:
            line=f.readline(1024*1024+1)
            if not line:break
            if len(line)>1024*1024:raise ValueError("Episode metadata line exceeds 1 MiB")
            if line.strip():
                yield json.loads(line)

def preflight(source):
    base = safe(ROOT, source["snapshot"])
    receipt_path=base/".curation-upstream.json"
    if receipt_path.exists():receipt_path=safe(ROOT,receipt_path.relative_to(ROOT))
    receipt=json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else None
    if (base / "BotFails").is_dir():
        base = safe(base, "BotFails")
    files = {}
    episodes = []
    findings = []
    seen = set()
    for task in source["tasks"]:
        folder = safe(base, task)
        if safe(folder,"meta/info.json").stat().st_size>1024*1024:raise ValueError("Task metadata exceeds 1 MiB")
        info = json.loads(safe(folder, "meta/info.json").read_text())
        if info.get("codebase_version") != "v2.0":
            raise ValueError("Unsupported BotFails schema; expected LeRobot v2.0")
        for name in ("info.json", "episodes.jsonl", "tasks.jsonl"):
            p = safe(folder, "meta/" + name)
            files[p.relative_to(ROOT).as_posix()] = p.stat().st_size
        for row in lines(safe(folder, "meta/episodes.jsonl")):
            if len(episodes) >= MAX_EPISODES:
                raise ValueError("Select fewer tasks: 1000-episode admission limit")
            index = int(row["episode_index"])
            if source.get("episode_indices") is not None and index not in source["episode_indices"]:continue
            if not 0<int(row["length"])<=1000000:raise ValueError("Unsupported episode frame count")
            if (task, index) in seen:
                raise ValueError("Duplicate source episode identity")
            seen.add((task,index))
            fmt = {"episode_index": index, "episode_chunk": index // int(info["chunks_size"])}
            paths = []
            for key, feature in info["features"].items():
                if feature.get("dtype") == "video":
                    rel = info["video_path"].format(**fmt, video_key=key)
                    paths.append((key, folder / rel))
            paths.append(("state/action", folder / info["data_path"].format(**fmt)))
            paths.extend(("source metadata: "+name,folder/"meta"/name) for name in ("info.json","episodes.jsonl","tasks.jsonl"))
            label = base / "labels" / task.split("/")[1] / ("episode_%06d_labels.csv" % index)
            episode_findings = []
            if label.exists():
                paths.append(("source annotation", label))
            else:
                episode_findings.append("Missing source annotation")
            record = {"index": index, "task": task, "info": info, "row": row, "files": [], "findings":episode_findings}
            for kind, p in paths:
                if not p.resolve().is_relative_to(ROOT):raise ValueError("Artifact path escapes source root")
                if not p.exists():
                    episode_findings.append("Missing artifact: "+kind)
                    continue
                p = safe(ROOT, p.relative_to(ROOT))
                relative = p.relative_to(ROOT).as_posix()
                files[relative] = p.stat().st_size
                record["files"].append({"kind": kind, "path": relative})
            episodes.append(record)
            findings.extend(task+"/"+str(index)+": "+finding for finding in episode_findings)
    if not episodes:raise ValueError("No episodes match the selected tasks and indices")
    verification={"mode":"local-only"}
    if receipt is not None:
        if source.get("origin")!="public recording" or receipt.get("revision")!=source["revision"] or receipt.get("repository")!="kantine/BotFails":
            raise ValueError("Upstream receipt identity mismatch")
        snapshot=safe(ROOT,source["snapshot"])
        expected={str((snapshot/a["path"]).resolve()):a for a in receipt["files"]}
        for filename,size in files.items():
            actual=safe(ROOT,filename);record=expected.get(str(actual))
            if not record or record["sha256"]!=digest(actual) or record["bytes"]!=size:
                raise ValueError("Selected artifact does not match upstream verification receipt")
        files[receipt_path.relative_to(ROOT).as_posix()]=receipt_path.stat().st_size
        verification={"mode":"upstream-hashes-verified","receipt_sha256":digest(receipt_path),"verified_at":receipt.get("verified_at")}
    total = sum(files.values())
    if total > MAX_BYTES:
        raise ValueError("Selected bytes exceed CURATION_MAX_IMPORT_BYTES")
    if shutil.disk_usage(DATA).free < max(64 * 1024**2, total // 20):
        raise ValueError("Insufficient free disk for bounded derived artifacts")
    return {"estimated_bytes": total, "files": [{"path": p, "bytes": b, "sha256": digest(safe(ROOT, p))} for p, b in files.items()],
            "episodes": episodes, "findings": findings, "verification":verification}

def import_episode(source, record):
    info = record["info"]
    identity = source["revision"] + "/" + record["task"] + "/" + str(record["index"])
    eid = stable(source["id"] + "/" + identity)
    artifacts, streams, findings, annotations, channels = [], [], list(record.get("findings",[])), [], []
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
                meta = inspect_video(p,ACTIVE_CANCEL)
                if meta["frames"] != frame_count:
                    findings.append("Decoded video frame count differs from episode length: "+item["kind"])
                measured = meta["duration"]
                if measured is not None and measured>0:
                    duration = measured if duration is None else min(duration, measured)
            except (OSError, ValueError, subprocess.SubprocessError, KeyError) as error:
                findings.append("Media probe failed: " + item["kind"] + ": " + str(error))
        elif item["kind"] == "state/action":
            try:
                import duckdb
                import pyarrow.parquet as pq
                import pyarrow as pa
                pa.set_cpu_count(1);pa.set_io_thread_count(1)
                parquet=pq.ParquetFile(p)
                if any(parquet.metadata.row_group(n).total_byte_size>256*1024*1024 for n in range(parquet.num_row_groups)):
                    raise ValueError("Parquet row group exceeds 256 MiB decoded admission limit")
                row_position=0
                bad_frame_mapping=False
                for batch in parquet.iter_batches(batch_size=64):
                    if ACTIVE_CANCEL is not None and ACTIVE_CANCEL.is_set():raise ValueError("Import cancelled")
                    if "frame_index" in batch.schema.names:
                        indices=batch.column(batch.schema.names.index("frame_index")).to_pylist()
                        if any(value!=row_position+n for n,value in enumerate(indices)):bad_frame_mapping=True
                    row_position+=batch.num_rows
                if bad_frame_mapping:findings.append("Frame index mapping differs from annotation row ordinals")
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
            if p.stat().st_size>64*1024*1024:
                findings.append("Annotation artifact exceeds 64 MiB admission limit")
                continue
            csv.field_size_limit(4096)
            with p.open(newline="") as f:
                labels=[]
                for row in csv.reader(f):
                    if row:labels.append(row[0].strip())
                    if len(labels)>1000000:raise ValueError("Annotation row limit exceeded")
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
    import pyarrow as pa
    import pyarrow.parquet as pq
    if any(e["findings"] for e in version["episodes"]):
        raise ValueError("Resolve episode integrity findings before export")
    for source in version.get("sources", []):
        for artifact in source.get("plan", {}).get("files", []):
            if digest(safe(ROOT, artifact["path"])) != artifact["sha256"]:
                raise ValueError("Source checksum mismatch: " + artifact["path"])
    destination = DATA / "exports" / job_id
    if not destination.resolve().is_relative_to(DATA):raise ValueError("Export destination escapes data root")
    destination.mkdir(parents=True, exist_ok=True)
    for episode in version["episodes"]:
        for a in episode["artifacts"]:
            if digest(safe(ROOT, a["path"])) != a["sha256"]:
                raise ValueError("Source checksum mismatch: " + a["path"])
    selected = version["collection"]["members"]
    rows = []
    row_bytes=0
    def add_row(row):
        nonlocal row_bytes
        row_bytes+=len(json.dumps(row).encode())
        if row_bytes>64*1024*1024 or len(rows)>=100000:
            raise ValueError("Annotation export exceeds bounded in-memory selection limit")
        rows.append(row)
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
            add_row({"episode_id": episode["id"], "producer": "source",
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
                add_row({"episode_id": episode["id"], "producer": "reviewer",
                             "selection": member["interval"], "record": review})
    manifest = {**version, "exporter_version": "0.1.0", "media_bundled": False,
                "interval_semantics": "half-open references; original annotation scopes retained"}
    budget = ExportBudget(DATA / "exports", EXPORT_MAX_BYTES)
    with BoundedFile(destination / "manifest.json.tmp", budget) as output:
        for chunk in json.JSONEncoder(ensure_ascii=False, allow_nan=False).iterencode(manifest):
            output.write(chunk.encode("utf-8"))
    schema = pa.schema([(name, pa.string()) for name in ("episode_id","producer","selection_json","record_json")])
    with BoundedFile(destination / "annotations.jsonl.tmp", budget) as jsonl, BoundedFile(destination / "annotations.parquet.tmp", budget) as parquet:
        with pq.ParquetWriter(parquet, schema) as writer:
            for start in range(0, len(rows), 128):
                batch = rows[start:start+128]
                for row in batch:
                    jsonl.write((json.dumps(row, allow_nan=False)+"\n").encode("utf-8"))
                writer.write_table(pa.Table.from_pylist([{"episode_id":row["episode_id"],"producer":row["producer"],
                    "selection_json":json.dumps(row["selection"]),"record_json":json.dumps(row["record"])} for row in batch], schema=schema))
    artifacts = []
    for name in ("manifest.json", "annotations.jsonl", "annotations.parquet"):
        p = destination / name
        os.replace(destination / (name + ".tmp"), p)
        artifacts.append({"id": stable(job_id + name), "path": p.relative_to(DATA).as_posix(),
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
        video_columns = [c for c in available if c.startswith("observation.images.")][:32]
        fields = ", ".join('"' + c.replace('"','""') + '"' for c in columns+video_columns)
        records = conn.execute("SELECT " + fields + " FROM read_parquet(?) LIMIT ? OFFSET ?",
                               [str(filename), limit, offset]).fetchall()
        result = {"episode_id": payload["episode_id"], "artifact_sha256": artifact["sha256"],
                  "offset": offset, "columns": columns, "rows": [dict(zip(columns, row)) for row in records],
                  "video_references": [[{"kind":key,"path":value["path"],"timestamp":value["timestamp"]}
                    for key,value in zip(video_columns,row[len(columns):]) if isinstance(value,dict)
                    and isinstance(value.get("path"),str) and isinstance(value.get("timestamp"),(float,int))]
                    for row in records],
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
    started=time.monotonic()
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
        send(status="completed", result=result,metrics={"elapsed_seconds":time.monotonic()-started,
            "worker_lifetime_peak_rss_bytes":peak_rss_bytes()})
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
