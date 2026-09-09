"""Generate a tiny explicitly labeled fixture; never described as public robot data."""
import json
from fractions import Fraction
from pathlib import Path
import sys
import av
import pyarrow as pa
import pyarrow.parquet as pq

def create(root):
    folder=Path(root)/"snapshot/BotFails/test/fixture"
    (folder/"meta").mkdir(parents=True)
    (folder/"data/chunk-000").mkdir(parents=True)
    labels=Path(root)/"snapshot/BotFails/labels/fixture"
    labels.mkdir(parents=True)
    features={key:{"dtype":"video"} for key in ("observation.images.one","observation.images.two")}
    info={"codebase_version":"v2.0","robot_type":"fixture","fps":30,"chunks_size":1000,"splits":{"train":"0:1"},
          "data_path":"data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
          "video_path":"videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4","features":features}
    (folder/"meta/info.json").write_text(json.dumps(info),encoding="utf-8")
    (folder/"meta/tasks.jsonl").write_text(json.dumps({"task_index":0,"task":"Explicit synthetic fixture"})+"\n",encoding="utf-8")
    (folder/"meta/episodes.jsonl").write_text(json.dumps({"episode_index":0,"length":3,"tasks":["Explicit synthetic fixture"]})+"\n",encoding="utf-8")
    (labels/"episode_000000_labels.csv").write_text("0\n1\n1\n",encoding="utf-8")
    paths={}
    for key in features:
        relative=f"videos/chunk-000/{key}/episode_000000.mp4"
        filename=folder/relative;filename.parent.mkdir(parents=True)
        with av.open(str(filename),"w") as output:
            stream=output.add_stream("libx264",rate=30)
            stream.width=64;stream.height=64;stream.pix_fmt="yuv420p";stream.codec_context.thread_count=1
            for index in range(3):
                frame=av.VideoFrame(64,64,"yuv420p")
                for plane,value in zip(frame.planes,(40+index*40,128,128)):
                    plane.update(bytes([value])*plane.buffer_size)
                frame.pts=index;frame.time_base=Fraction(1,30)
                for packet in stream.encode(frame):output.mux(packet)
            for packet in stream.encode():output.mux(packet)
        paths[key]=relative
    rows=[]
    for index,timestamp in enumerate((0,.033,.100)):
        row={"timestamp":timestamp,"frame_index":index,"action":[float(index)],"observation.state":[float(index)/2]}
        row.update({key:{"path":relative,"timestamp":index/30} for key,relative in paths.items()})
        rows.append(row)
    pq.write_table(pa.Table.from_pylist(rows),folder/"data/chunk-000/episode_000000.parquet")
    return {"snapshot":"snapshot","tasks":["test/fixture"],"origin":"fixture","license":"Synthetic test fixture; no public dataset qualification"}

if __name__=="__main__":
    print(json.dumps(create(sys.argv[1])))
