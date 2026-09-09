"""Read-only native/Docker smoke checks and before/after restart comparison (stdlib only)."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse, quote

def capture(base, wait_seconds=60):
    parsed=urlparse(base)
    if parsed.scheme!="http" or parsed.hostname not in ("127.0.0.1","localhost"):
        raise ValueError("Use the local loopback publication for this smoke check")
    def read(route):
        with urllib.request.urlopen(base+"/api/v1"+route,timeout=10) as response:
            body=response.read(16*1024*1024+1)
            if len(body)>16*1024*1024:raise ValueError("Smoke response exceeds 16 MiB")
            return json.loads(body)
    deadline=time.monotonic()+wait_seconds
    while True:
        try:
            settings=read("/settings")
            if settings["worker"]["status"]=="available":break
        except OSError:
            pass
        if time.monotonic()>deadline:raise ValueError("API/worker did not become available")
        time.sleep(1)
    def pages(route):
        output=[]
        for offset in range(0,10000,40):
            chunk=read(route+"?offset="+str(offset));output.extend(chunk)
            if len(chunk)<40:return output
        raise ValueError("Smoke listing exceeds 10,000-record budget")
    def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    versions={}
    for collection in pages("/collections"):
        for version in pages("/collections/"+quote(collection["id"])+"/versions"):
            versions[version["id"]]=digest(version)
    exports={}
    for job in pages("/jobs"):
        if job["kind"]!="export" or job["status"]!="completed":continue
        for artifact in job["result"]["artifacts"]:
            h=hashlib.sha256();count=0
            with urllib.request.urlopen(base+"/api/v1/artifacts/"+quote(artifact["id"]),timeout=30) as response:
                for chunk in iter(lambda:response.read(1024*1024),b""):
                    count+=len(chunk)
                    if count>artifact["bytes"]:raise ValueError("Export grew beyond committed size")
                    h.update(chunk)
            if count!=artifact["bytes"] or h.hexdigest()!=artifact["sha256"]:raise ValueError("Committed export checksum mismatch")
            exports[artifact["id"]]=h.hexdigest()
    episodes={}
    for offset in range(0,10000,40):
        chunk=read("/episodes?offset="+str(offset))["episodes"]
        for e in chunk:episodes[e["id"]]=digest(read("/episodes/"+quote(e["id"])))
        if len(chunk)<40:break
    else:raise ValueError("Smoke episode listing exceeds budget")
    return {"schema_version":"1","source_ids":sorted(s["id"] for s in pages("/sources")),"episodes_and_reviews":episodes,
            "collections":{c["id"]:digest(c) for c in pages("/collections")},"versions":versions,"exports":exports}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--api",default="http://127.0.0.1:8788")
    group=parser.add_mutually_exclusive_group();group.add_argument("--record");group.add_argument("--compare")
    args=parser.parse_args();result=capture(args.api)
    if args.record:
        with Path(args.record).open("x",encoding="utf-8") as output:json.dump(result,output,indent=2)
    if args.compare:
        if json.loads(Path(args.compare).read_text(encoding="utf-8"))!=result:raise SystemExit("Persisted state changed across restart; inspect before proceeding")
    print(json.dumps({"status":"passed","sources":len(result["source_ids"]),"frozen_versions":len(result["versions"]),"verified_exports":len(result["exports"])}))
