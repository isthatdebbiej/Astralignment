"""Cold backup/restore with checksums. Requires API and worker to be stopped."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3

def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda:source.read(1024*1024),b""):
            h.update(block)
    return h.hexdigest()

def safe(root,relative):
    p=(root/str(relative).replace("\\","/")).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ValueError("Backup path escapes root")
    return p

def backup(data,destination,sources=None):
    data,destination=Path(data).resolve(),Path(destination).resolve()
    if destination.exists() or destination.is_relative_to(data):
        raise ValueError("Choose a new backup directory outside the data directory")
    if (data/"curation.lock").exists():
        raise ValueError("Stop the curation API and worker before backup")
    if not (data/"curation.sqlite").is_file():
        raise ValueError("No curation database")
    destination.mkdir(parents=True)
    files=[]
    try:
        for p in data.rglob("*"):
            if p.is_symlink():
                raise ValueError("Symlinks are not supported in backup data")
            if p.is_file() and not p.name.endswith(".tmp"):
                relative="data/"+p.relative_to(data).as_posix()
                target=safe(destination,relative)
                target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(p,target)
                files.append({"path":relative,"bytes":target.stat().st_size,"sha256":sha(target)})
        refs={}
        conn=sqlite3.connect("file:"+str(data/"curation.sqlite").replace("\\","/")+"?mode=ro",uri=True)
        for (raw,) in conn.execute("SELECT data FROM records WHERE kind='source'"):
            source=json.loads(raw)
            for a in source.get("plan",{}).get("files",[]):
                previous=refs.get(a["path"])
                if previous and previous["sha256"]!=a["sha256"]:
                    raise ValueError("Conflicting source revisions at one local path")
                refs[a["path"]]=a
        conn.close()
        if sources:
            source_root=Path(sources).resolve()
            for relative,a in refs.items():
                original=safe(source_root,relative)
                if sha(original)!=a["sha256"]:
                    raise ValueError("Source checksum mismatch")
                name="sources/"+Path(relative).as_posix()
                target=safe(destination,name);target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(original,target)
                files.append({"path":name,"bytes":target.stat().st_size,"sha256":sha(target)})
        manifest={"schema_version":"1.0.0","files":files,"source_references":list(refs.values()),"sources_included":bool(sources)}
        (destination/"backup.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
        verify(destination)
        return manifest
    except Exception:
        # Keep partial output for inspection; it is never advertised as a completed backup.
        raise

def verify(directory):
    directory=Path(directory).resolve()
    manifest=json.loads((directory/"backup.json").read_text(encoding="utf-8"))
    for a in manifest["files"]:
        p=safe(directory,a["path"])
        if p.stat().st_size!=a["bytes"] or sha(p)!=a["sha256"]:
            raise ValueError("Backup checksum mismatch: "+a["path"])
    connection=sqlite3.connect("file:"+str(directory/"data/curation.sqlite").replace("\\","/")+"?mode=ro",uri=True)
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
            raise ValueError("Backup database integrity check failed")
    finally:
        connection.close()
    return manifest

def restore(directory,destination):
    directory,destination=Path(directory).resolve(),Path(destination).resolve()
    manifest=verify(directory)
    if destination.exists():
        raise ValueError("Restore destination must not exist; existing data is never overwritten")
    destination.mkdir(parents=True)
    for a in manifest["files"]:
        target=safe(destination,a["path"]);target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(safe(directory,a["path"]),target)
    return {"data_directory":str(destination/"data"),"sources_directory":str(destination/"sources"),
            "source_references_require_recovery":not manifest["sources_included"]}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="command",required=True)
    create=sub.add_parser("backup");create.add_argument("data");create.add_argument("destination");create.add_argument("--sources");create.add_argument("--services-stopped",action="store_true",required=True)
    check=sub.add_parser("verify");check.add_argument("directory")
    recover=sub.add_parser("restore");recover.add_argument("directory");recover.add_argument("destination")
    args=parser.parse_args()
    if args.command=="backup":result=backup(args.data,args.destination,args.sources)
    elif args.command=="verify":result=verify(args.directory)
    else:result=restore(args.directory,args.destination)
    print(json.dumps(result,indent=2))
