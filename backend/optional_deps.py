"""Optional heavy runtimes (offline translation / speech models).

`ctranslate2`, `sentencepiece`, `numpy` and `faster_whisper` power the OPTIONAL
offline translator and call captions. They are ~hundreds of MB, are not part of
the production image (requirements.txt), and the features that use them
already fall back to the free online translator when they are missing.

Importing them through this helper keeps that contract explicit: a missing
runtime raises `OptionalDependencyMissing` (a RuntimeError the callers already
handle) instead of crashing a request path with ModuleNotFoundError, and it can
never break API start-up because nothing here runs at import time.
"""
from __future__ import annotations

import importlib
from types import ModuleType


class OptionalDependencyMissing(RuntimeError):
    """Raised when an optional offline-model runtime is not installed."""


def optional_module(name: str) -> ModuleType | None:
    """Return the module, or None when it is not installed."""
    try:
        return importlib.import_module(name)
    except ImportError:
        return None


def require_optional(*names: str) -> list[ModuleType]:
    """Import every module or raise OptionalDependencyMissing naming the gaps."""
    modules: list[ModuleType] = []
    missing: list[str] = []
    for name in names:
        module = optional_module(name)
        if module is None:
            missing.append(name)
        else:
            modules.append(module)
    if missing:
        raise OptionalDependencyMissing(
            "Optional offline runtime not installed: " + ", ".join(missing)
        )
    return modules
