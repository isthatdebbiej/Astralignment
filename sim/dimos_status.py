"""Lightweight availability checks; never imports or emulates DimOS."""
from importlib.metadata import PackageNotFoundError, version
import platform

PINNED_DIMOS_VERSION = "0.0.12"


def availability():
    try:
        installed_version = version("dimos")
    except PackageNotFoundError:
        installed_version = None
    supported = platform.system() == "Linux"
    ready = supported and installed_version == PINNED_DIMOS_VERSION
    reason = "Ready for native bridge launch" if ready else (
        "Native bridge targets Ubuntu/Linux; this host is " + platform.system() if not supported else
        "Install the separate pinned DimOS environment" if installed_version is None else
        f"Installed DimOS {installed_version} does not match the pinned {PINNED_DIMOS_VERSION} API"
    )
    return {"installed": installed_version is not None, "version": installed_version,
            "pinned_version": PINNED_DIMOS_VERSION, "supported_platform": supported,
            "ready": ready, "active": False, "reason": reason}
