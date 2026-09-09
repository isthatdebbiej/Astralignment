"""Native process-lifetime peak RSS; never described as an exact per-job peak."""
import sys

def peak_rss_bytes():
    try:
        if sys.platform=="win32":
            import ctypes
            from ctypes import wintypes
            class Counters(ctypes.Structure):
                _fields_=[("cb",wintypes.DWORD),("PageFaultCount",wintypes.DWORD)]+[(field,ctypes.c_size_t) for field in
                    ("PeakWorkingSetSize","WorkingSetSize","QuotaPeakPagedPoolUsage","QuotaPagedPoolUsage","QuotaPeakNonPagedPoolUsage","QuotaNonPagedPoolUsage","PagefileUsage","PeakPagefileUsage")]
            current=ctypes.windll.kernel32.GetCurrentProcess;current.restype=wintypes.HANDLE
            read=ctypes.windll.psapi.GetProcessMemoryInfo
            read.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD];read.restype=wintypes.BOOL
            value=Counters();value.cb=ctypes.sizeof(value)
            if not read(current(),ctypes.byref(value),value.cb):return None
            return int(value.PeakWorkingSetSize)
        import resource
        value=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value if sys.platform=="darwin" else value*1024)
    except (ImportError,OSError,AttributeError):
        return None
