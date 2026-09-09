"""Run a human-reviewed retrieval pilot; never manufacture relevance judgments."""
import argparse
import hashlib
import json
import time
import urllib.request
from urllib.parse import urlparse

def evaluate(pilot, base):
    parsed = urlparse(base)
    if parsed.hostname not in ("localhost", "127.0.0.1") or parsed.scheme != "http":
        raise ValueError("This preview evaluator only connects to the local curation API")
    if len(pilot.get("questions", [])) != 20:
        raise ValueError("Exactly 20 frozen, manually reviewed questions are required")
    if not pilot.get("source_revisions") or not pilot.get("reviewer") or not pilot.get("frozen_at"):
        raise ValueError("Missing source revisions, human reviewer, or freeze date")
    results=[]
    for question in pilot["questions"]:
        if not question.get("manually_reviewed") or not question.get("relevant") or not question.get("evidence"):
            raise ValueError("Every question needs human-reviewed episode IDs and evidence references")
        for mode in ("metadata", "annotations"):
            start=time.perf_counter()
            request=urllib.request.Request(base+"/api/v1/queries",
                json.dumps({"text":question["query"],"mode":mode,"limit":10}).encode(),
                {"Content-Type":"application/json"})
            with urllib.request.urlopen(request,timeout=30) as response:
                data=json.load(response)
            retrieved=[e["id"] for e in data["episodes"]]
            relevant=set(question["relevant"])
            hits=len(set(retrieved)&relevant)
            results.append({"question_id":question["id"],"mode":mode,"retrieved":retrieved,
                "precision_at_10":hits/10,"recall_at_10":hits/len(relevant),
                "query_seconds":time.perf_counter()-start,
                "review_seconds":question.get("review_seconds",{}).get(mode),
                "disclosure":data["disclosure"]})
    return {"pilot_sha256":hashlib.sha256(json.dumps(pilot,sort_keys=True).encode()).hexdigest(),
        "scope":"small technical pilot; annotation-assisted retrieval is not label-hidden prediction",
        "results":results}

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("pilot")
    parser.add_argument("--api",default="http://127.0.0.1:8788")
    args=parser.parse_args()
    with open(args.pilot,encoding="utf-8") as source:
        print(json.dumps(evaluate(json.load(source),args.api),indent=2))
