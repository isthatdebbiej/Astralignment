"""Run a human-reviewed retrieval pilot; never manufacture relevance judgments."""
import argparse
import hashlib
import json
import time
import urllib.request
from urllib.parse import urlparse
from pathlib import Path

def read_json(base,route,body=None):
    request=urllib.request.Request(base+"/api/v1"+route,
        json.dumps(body).encode() if body is not None else None,{"Content-Type":"application/json"})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

def evaluate(pilot, base):
    parsed = urlparse(base)
    if parsed.hostname not in ("localhost", "127.0.0.1") or parsed.scheme != "http":
        raise ValueError("This preview evaluator only connects to the local curation API")
    if len(pilot.get("questions", [])) != 20:
        raise ValueError("Exactly 20 frozen, manually reviewed questions are required")
    if not pilot.get("source_revisions") or not pilot.get("reviewer") or not pilot.get("frozen_at"):
        raise ValueError("Missing source revisions, human reviewer, or freeze date")
    if len({q.get("id") for q in pilot["questions"]})!=20:
        raise ValueError("Question identities must be unique")
    project=pilot.get("project_id","default")
    state=read_json(base,"/evaluation-state?project_id="+urllib.parse.quote(project))
    if not pilot.get("corpus_fingerprint") or state["corpus_fingerprint"]!=pilot["corpus_fingerprint"] or state["source_revisions"]!=pilot["source_revisions"]:
        raise ValueError("The frozen retrieval corpus changed; do not score a different corpus")
    episodes={}
    results=[]
    for index,question in enumerate(pilot["questions"]):
        if question.get("manually_reviewed") is not True or not question.get("query","").strip() or not question.get("evidence"):
            raise ValueError("Every question needs human-reviewed episode IDs and evidence references")
        for evidence in question["evidence"]:
            if not isinstance(evidence,dict) or not evidence.get("episode_id") or not evidence.get("artifact_id"):
                raise ValueError("Evidence requires episode_id and artifact_id")
            eid=evidence["episode_id"]
            if eid not in episodes:episodes[eid]=read_json(base,"/episodes/"+urllib.parse.quote(eid))
            episode=episodes[eid]
            if episode["source_id"] not in pilot["source_revisions"] or not any(a["id"]==evidence["artifact_id"] for a in episode["artifacts"]):
                raise ValueError("Evidence is not in the frozen source corpus")
            interval=evidence.get("interval")
            if interval is not None:
                bound=episode["frames"] if interval.get("unit")=="frames" else episode.get("duration")
                start,end=interval.get("start"),interval.get("end")
                if interval.get("unit") not in ("frames","seconds") or not any(s["id"]==interval.get("stream_id") for s in episode["streams"]) or not isinstance(start,(int,float)) or not isinstance(end,(int,float)) or bound is None or not 0<=start<end<=bound:
                    raise ValueError("Evidence interval has invalid or unknown bounds")
                if interval["unit"]=="frames" and (int(start)!=start or int(end)!=end):raise ValueError("Frame bounds must be integers")
        if any(eid not in {e["episode_id"] for e in question["evidence"]} for eid in question["relevant"]):
            raise ValueError("Each relevant episode requires supporting evidence")
        for mode in (("metadata","annotations") if index%2==0 else ("annotations","metadata")):
            start=time.perf_counter()
            request=urllib.request.Request(base+"/api/v1/queries",
                json.dumps({"text":question["query"],"mode":mode,"project_id":project,"limit":10}).encode(),
                {"Content-Type":"application/json"})
            with urllib.request.urlopen(request,timeout=30) as response:
                data=json.load(response)
            retrieved=[e["id"] for e in data["episodes"]]
            relevant=set(question["relevant"])
            hits=len(set(retrieved)&relevant)
            results.append({"question_id":question["id"],"mode":mode,"retrieved":retrieved,
                "precision_at_10":hits/10,"recall_at_10":hits/len(relevant) if relevant else None,
                "query_seconds":time.perf_counter()-start,
                "review_seconds":question.get("review_seconds",{}).get(mode),
                "disclosure":data["disclosure"]})
    return {"pilot_sha256":hashlib.sha256(json.dumps(pilot,sort_keys=True).encode()).hexdigest(),
        "corpus_fingerprint":state["corpus_fingerprint"],"search_version":state["search_version"],
        "scope":"small technical pilot; annotation-assisted retrieval is not label-hidden prediction",
        "results":results}

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("pilot",nargs="?")
    parser.add_argument("--prepare",help="Create an unreviewed template at a new path")
    parser.add_argument("--project",default="default")
    parser.add_argument("--api",default="http://127.0.0.1:8788")
    args=parser.parse_args()
    if args.prepare:
        target=Path(args.prepare)
        template=json.loads((Path(__file__).parents[1]/"docs/evaluation/PILOT_TEMPLATE.json").read_text())
        state=read_json(args.api,"/evaluation-state?project_id="+urllib.parse.quote(args.project))
        template.update({key:state[key] for key in ("project_id","source_revisions","corpus_fingerprint")})
        with target.open("x",encoding="utf-8") as output:json.dump(template,output,indent=2)
        print("Unreviewed template created. Inspect evidence and record actual human judgments before freezing.")
    else:
        if not args.pilot:parser.error("Provide a reviewed pilot or --prepare")
        with open(args.pilot,encoding="utf-8") as source:
            print(json.dumps(evaluate(json.load(source),args.api),indent=2))
