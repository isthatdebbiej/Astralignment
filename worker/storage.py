"""Bounded export writes. Source artifacts are never written by this module."""
import os
import shutil
from pathlib import Path

class ExportBudget:
    def __init__(self, root, maximum):
        self.root = Path(root)
        self.maximum = maximum
        self.used = sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file()) if self.root.exists() else 0
    def reserve(self, size):
        if self.used + size > self.maximum:
            raise ValueError("Export storage quota exceeded; preserve existing exports and choose a smaller selection")
        if shutil.disk_usage(self.root).free < size + 1024 * 1024:
            raise ValueError("Insufficient disk space for export write")
        self.used += size

class BoundedFile:
    def __init__(self, filename, budget):
        self.file = open(filename, "wb")
        self.budget = budget
    @property
    def closed(self):
        return self.file.closed
    def writable(self):
        return True
    def write(self, data):
        self.budget.reserve(len(data))
        return self.file.write(data)
    def tell(self):
        return self.file.tell()
    def flush(self):
        self.file.flush()
        os.fsync(self.file.fileno())
    def close(self):
        if not self.closed:
            self.flush()
            self.file.close()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()
