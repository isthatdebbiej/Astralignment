import hashlib
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).parents[2]/"worker"))
from acquire_reference import acquire,matches

class AcquireTests(unittest.TestCase):
    def test_download_requires_exact_bounded_confirmation(self):
        with self.assertRaisesRegex(ValueError,"Confirm"):acquire({"estimated_bytes":100,"files":[]},"unused",99)
        with self.assertRaisesRegex(ValueError,"Confirm"):acquire({"estimated_bytes":100*1024*1024,"files":[]},"unused",100*1024*1024)
    def test_git_blob_and_lfs_content_identities(self):
        with tempfile.TemporaryDirectory() as temporary:
            filename=Path(temporary)/"fixture";filename.write_bytes(b"fixture")
            self.assertTrue(matches(filename,{"bytes":7,"algorithm":"sha256","oid":hashlib.sha256(b"fixture").hexdigest()}))
            self.assertTrue(matches(filename,{"bytes":7,"algorithm":"git-blob-sha1","oid":hashlib.sha1(b"blob 7\0fixture").hexdigest()}))
            filename.write_bytes(b"changed")
            self.assertFalse(matches(filename,{"bytes":7,"algorithm":"sha256","oid":hashlib.sha256(b"fixture").hexdigest()}))
