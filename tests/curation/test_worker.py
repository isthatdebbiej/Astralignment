import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import duckdb

spec = importlib.util.spec_from_file_location("curation_worker", Path(__file__).parents[2] / "worker/curation.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerTests(unittest.TestCase):
    def test_grouped_views_export_and_checksum_rejection(self):
        temporary_root = Path(__file__).parents[2] / "runtime"
        temporary_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root, prefix="curation-fixture-") as tmp:
            root = Path(tmp)
            worker.ROOT = root / "sources"
            worker.DATA = root / "data"
            worker.DATA.mkdir()
            folder = worker.ROOT / "snapshot/BotFails/test/fixture"
            (folder / "meta").mkdir(parents=True)
            (folder / "data/chunk-000").mkdir(parents=True)
            labels = worker.ROOT / "snapshot/BotFails/labels/fixture"
            labels.mkdir(parents=True)
            info = {"codebase_version":"v2.0","robot_type":"fixture","fps":30,"chunks_size":1000,
                "splits":{"train":"0:1"},"data_path":"data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
                "video_path":"videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4",
                "features":{"observation.images.one":{"dtype":"video"},"observation.images.two":{"dtype":"video"}}}
            (folder / "meta/info.json").write_text(json.dumps(info))
            (folder / "meta/episodes.jsonl").write_text(json.dumps({"episode_index":0,"length":3,"tasks":["withheld anomaly"]})+"\n")
            (folder / "meta/tasks.jsonl").write_text("{}\n")
            (labels / "episode_000000_labels.csv").write_text("0\n1\n1\n")
            for camera in ("one","two"):
                p=folder / ("videos/chunk-000/observation.images."+camera)
                p.mkdir(parents=True)
                (p / "episode_000000.mp4").write_bytes(b"explicitly corrupt fixture video")
            parquet = folder / "data/chunk-000/episode_000000.parquet"
            conn=duckdb.connect()
            conn.execute("CREATE TABLE samples(timestamp DOUBLE, frame_index BIGINT, action DOUBLE[])")
            conn.execute("INSERT INTO samples VALUES (0,0,[1]),(.033,1,[2]),(.100,2,[3])")
            conn.execute("COPY samples TO '"+str(parquet).replace("'","''")+"' (FORMAT PARQUET)")
            source={"id":"fixture-source","snapshot":"snapshot","tasks":["test/fixture"],"revision":"fixture","origin":"fixture"}
            plan=worker.preflight(source)
            self.assertEqual(len(plan["episodes"]),1)
            episode=worker.import_episode(source,plan["episodes"][0])
            self.assertEqual(len(episode["streams"]),2)
            self.assertEqual(episode["split"],"test")
            self.assertEqual(episode["upstream_splits"],{"train":"0:1"})
            self.assertEqual(episode["annotations"][1]["start_frame"],1)
            self.assertEqual(episode["annotations"][1]["end_frame"],3)
            self.assertTrue(any("Media probe failed" in f for f in episode["findings"]))
            self.assertIn("action",episode["channels"])
            artifact=next(a for a in episode["artifacts"] if a["kind"]=="state/action")
            preview=worker.preview_samples({"episode_id":episode["id"],"artifact":artifact,"offset":0,"limit":3})
            self.assertEqual([row["timestamp"] for row in preview["rows"]],[0,.033,.100])
            self.assertEqual(preview["rows"][2]["action"],[3.0])
            self.assertEqual(worker.preview_samples({"episode_id":episode["id"],"artifact":artifact,"offset":2,"limit":1})["rows"][0]["frame_index"],2)
            version={"id":"v1","episodes":[episode],"reviews":[],"collection":{"members":[{"episode_id":episode["id"],"interval":None}]}}
            with self.assertRaisesRegex(ValueError,"integrity findings"):
                worker.export_version(version,"rejected-job")
            # Export a state/annotation-only fixture, excluding deliberately corrupt videos.
            episode["artifacts"] = [a for a in episode["artifacts"] if not a["kind"].startswith("observation.images.")]
            episode["streams"] = []
            episode["findings"] = []
            exported=worker.export_version(version,"job1")
            self.assertEqual(exported["annotation_count"],2)
            manifest=json.loads((worker.DATA/"exports/job1/manifest.json").read_text())
            self.assertEqual(manifest["collection"],version["collection"])
            actual=conn.execute("SELECT count(*) FROM read_parquet(?)",[str(worker.DATA/"exports/job1/annotations.parquet")]).fetchone()[0]
            self.assertEqual(actual,2)
            version["collection"]["members"][0]["interval"]={"stream_id":"fixture-frame-clock","unit":"frames","start":1,"end":3}
            selected=worker.export_version(version,"interval-job")
            self.assertEqual(selected["annotation_count"],1)
            conn.close()
            (labels / "episode_000000_labels.csv").write_text("changed")
            with self.assertRaisesRegex(ValueError,"checksum mismatch"):
                worker.export_version(version,"job2")
            with self.assertRaises(ValueError):
                worker.safe(worker.ROOT,"../data")

if __name__=="__main__":
    unittest.main()
