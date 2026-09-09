"""Verify selected local files against a pinned Hugging Face tree; never downloads recordings."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import urllib.request
from urllib.parse import quote

REPOSITORY="kantine/BotFails"
def hash_file(filename,git_blob=False):
    h=hashlib.sha1() if git_blob else hashlib.sha256()
    if git_blob:h.update(("blob "+str(filename.stat().st_size)+"\0").encode())
    with filename.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()

def verify(source,root,fetch=None):
    if source.get("origin")!="public recording":
        raise ValueError("Synthetic fixtures cannot receive public-source verification")
    revision=source["revision"]
    if not re.fullmatch("[a-f0-9]{40}",revision):
        raise ValueError("An immutable 40-character source revision is required")
    root=Path(root).resolve();snapshot=(root/source["snapshot"]).resolve()
    if not snapshot.is_relative_to(root):raise ValueError("Snapshot escapes source root")
    selected=source["plan"]["files"]
    if len(selected)>2000:raise ValueError("Verify at most 2000 selected files per snapshot")
    def download_metadata(url):
        with urllib.request.urlopen(url,timeout=30) as response:
            body=response.read(4*1024*1024+1)
            if len(body)>4*1024*1024:raise ValueError("Upstream metadata response exceeds limit")
            return json.loads(body),response.headers.get("Link","")
    fetch=fetch or download_metadata
    cache={};verified=[]
    for artifact in selected:
        filename=(root/str(artifact["path"]).replace("\\","/")).resolve()
        if not filename.is_relative_to(snapshot):raise ValueError("Artifact escapes selected snapshot")
        if filename.name==".curation-upstream.json":continue
        relative=filename.relative_to(snapshot).as_posix()
        upstream=relative if relative.startswith("BotFails/") else "BotFails/"+relative
        parent=upstream.rsplit("/",1)[0]
        if parent not in cache:
            entries={}
            prefix="https://huggingface.co/api/datasets/"+REPOSITORY+"/tree/"+revision+"/"
            url=prefix+quote(parent,safe="/")+"?limit=1000"
            for _ in range(20):
                if not url.startswith(prefix):raise ValueError("Untrusted upstream pagination URL")
                page,links=fetch(url)
                entries.update({item["path"]:item for item in page if item.get("type")=="file"})
                following=re.search(r'<([^>]+)>;\s*rel="?next"?',links)
                if not following:break
                url=following.group(1)
            else:raise ValueError("Upstream pagination limit exceeded")
            cache[parent]=entries
        entry=cache[parent].get(upstream)
        if not entry:raise ValueError("Selected file absent from pinned upstream tree: "+upstream)
        sha=hash_file(filename)
        if sha!=artifact["sha256"] or filename.stat().st_size!=artifact["bytes"] or entry.get("size")!=artifact["bytes"]:
            raise ValueError("Local checksum or upstream size mismatch: "+upstream)
        oid=entry.get("lfs",{}).get("oid") or entry.get("oid")
        algorithm="sha256" if entry.get("lfs",{}).get("oid") else "git-blob-sha1"
        expected=str(oid).removeprefix("sha256:")
        actual=sha if algorithm=="sha256" else hash_file(filename,True)
        if expected!=actual:raise ValueError("Pinned upstream content hash mismatch: "+upstream)
        verified.append({"path":relative,"sha256":sha,"bytes":artifact["bytes"],"upstream_path":upstream,"upstream_oid":expected,"algorithm":algorithm})
    return {"schema_version":"1.0.0","repository":REPOSITORY,"revision":revision,
            "verified_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"files":verified}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_json",help="Saved GET /api/v1/sources/{id} response")
    parser.add_argument("--root",default="runtime/sources")
    args=parser.parse_args()
    source=json.loads(Path(args.source_json).read_text(encoding="utf-8"))
    receipt=verify(source,args.root)
    destination=Path(args.root)/source["snapshot"]/".curation-upstream.json"
    if destination.exists():raise SystemExit("Verification receipt already exists; do not overwrite evidence")
    destination.write_text(json.dumps(receipt,indent=2),encoding="utf-8")
    print("Verified "+str(len(receipt["files"]))+" files. Reinspect as a new source revision to attach this receipt.")
