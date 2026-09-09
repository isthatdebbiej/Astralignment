import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import sys
import errno
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[2]/"worker"))
from backup import backup,restore,verify
from storage import ExportBudget,BoundedFile
from verify_source import verify as verify_upstream,hash_file
from media import inspect_video

class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        runtime=Path(__file__).parents[2]/"runtime";runtime.mkdir(exist_ok=True)
        self.temporary=tempfile.TemporaryDirectory(dir=runtime,prefix="curation-reliability-")
        self.root=Path(self.temporary.name)
    def tearDown(self):
        self.temporary.cleanup()
    def test_export_quota_stops_before_write(self):
        budget=ExportBudget(self.root,8)
        with BoundedFile(self.root/"bounded.tmp",budget) as output:
            output.write(b"1234")
            with self.assertRaisesRegex(ValueError,"quota"):
                output.write(b"12345")
        self.assertEqual((self.root/"bounded.tmp").read_bytes(),b"1234")
    def test_retry_reuses_staging_budget_without_double_counting(self):
        target=self.root/"staged.tmp";target.write_bytes(b"12345678")
        budget=ExportBudget(self.root,8)
        with BoundedFile(target,budget) as output:output.write(b"abcdefgh")
        self.assertEqual(target.read_bytes(),b"abcdefgh")
    def test_disk_full_flush_closes_file_and_preserves_committed_data(self):
        committed=self.root/"committed.json";committed.write_bytes(b"preserve")
        output=BoundedFile(self.root/"incomplete.tmp",ExportBudget(self.root,1024))
        output.write(b"incomplete")
        with patch("storage.os.fsync",side_effect=OSError(errno.ENOSPC,"disk full")):
            with self.assertRaises(OSError):output.close()
        self.assertTrue(output.closed)
        self.assertEqual(committed.read_bytes(),b"preserve")
    def test_backup_rejects_active_writer_and_corruption(self):
        data=self.root/"data";data.mkdir()
        conn=sqlite3.connect(data/"curation.sqlite")
        conn.execute("CREATE TABLE records(kind TEXT,id TEXT,data TEXT)")
        conn.commit();conn.close()
        (data/"curation.lock").write_text("{}")
        with self.assertRaisesRegex(ValueError,"Stop"):backup(data,self.root/"blocked")
        (data/"curation.lock").unlink()
        backup(data,self.root/"snapshot")
        with self.assertRaisesRegex(ValueError,"must not exist"):restore(self.root/"snapshot",data)
        (self.root/"snapshot/data/curation.sqlite").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError,"checksum"):verify(self.root/"snapshot")
    def test_upstream_verifier_uses_pinned_content_hashes(self):
        source_root=self.root/"sources";snapshot=source_root/"snapshot";snapshot.mkdir(parents=True)
        original=snapshot/"metadata.txt";original.write_text("synthetic verifier fixture")
        revision="a"*40
        source={"origin":"public recording","revision":revision,"snapshot":"snapshot","plan":{"files":[{"path":"snapshot/metadata.txt","bytes":original.stat().st_size,"sha256":hash_file(original)}]}}
        def metadata(url):
            self.assertIn("/"+revision+"/",url)
            return [{"type":"file","path":"BotFails/metadata.txt","size":original.stat().st_size,"oid":hash_file(original,True)}],""
        receipt=verify_upstream(source,source_root,metadata)
        self.assertEqual(receipt["files"][0]["algorithm"],"git-blob-sha1")
        original.write_text("changed")
        with self.assertRaisesRegex(ValueError,"mismatch"):verify_upstream(source,source_root,metadata)
    def test_real_decoder_counts_frames_and_cancels(self):
        fixture_spec=importlib.util.spec_from_file_location("fixture",Path(__file__).parent/"fixture.py")
        fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
        fixture.create(self.root/"sources")
        movie=next((self.root/"sources").rglob("*.mp4"))
        self.assertEqual(inspect_video(movie)["frames"],3)
        cancel=threading.Event();cancel.set()
        with self.assertRaisesRegex(ValueError,"cancelled"):inspect_video(movie,cancel)

if __name__=="__main__":unittest.main()
