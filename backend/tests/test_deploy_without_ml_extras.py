"""Deployment guard: the API must import and serve WITHOUT the heavy ML wheels.

`requirements.txt` deliberately no longer ships faster-whisper / ctranslate2 /
onnxruntime / huggingface_hub / av / sentencepiece / numpy / pandas — they blow
past the deployment CPU+memory envelope, and without a deployment the built APK
has no server to talk to ("No network connection" on the device).

Every use of those wheels is a *lazy* import inside a function, so the app must
still boot and translate (via the free online provider) when they are absent.
This test simulates their absence with an import blocker so a future edit can
never silently re-introduce a top-level dependency on them.
"""

import importlib
import sys

import pytest

BLOCKED = {
    "av",
    "ctranslate2",
    "faster_whisper",
    "huggingface_hub",
    "hf_xet",
    "onnxruntime",
    "flatbuffers",
    "sentencepiece",
    "numpy",
    "pandas",
}


class _Blocker:
    """meta_path finder that makes the heavy wheels look uninstalled."""

    def find_module(self, name, path=None):  # legacy API, harmless
        return None

    def find_spec(self, name, path=None, target=None):
        root = name.split(".")[0]
        if root in BLOCKED:
            raise ModuleNotFoundError(f"No module named {root!r} (blocked by deploy guard)")
        return None


@pytest.fixture()
def without_ml_extras():
    blocker = _Blocker()
    saved = {k: v for k, v in sys.modules.items() if k.split(".")[0] in BLOCKED}
    for key in saved:
        del sys.modules[key]
    sys.meta_path.insert(0, blocker)
    try:
        yield
    finally:
        sys.meta_path.remove(blocker)
        sys.modules.update(saved)


def _fresh(name: str):
    sys.modules.pop(name, None)
    return importlib.import_module(name)


def test_core_modules_import_without_ml_extras(without_ml_extras):
    """No top-level dependency on the removed wheels anywhere on the boot path."""
    for module in (
        "caption_engine",
        "local_text_translation",
        "model_provisioning",
        "translation_service",
        "free_translation_api",
    ):
        assert _fresh(module) is not None, module


def test_routes_import_without_ml_extras(without_ml_extras):
    for module in ("routes.ai", "routes.audio", "routes.chats", "routes.auth"):
        assert _fresh(module) is not None, module


def test_offline_engines_report_unavailable_instead_of_crashing(without_ml_extras):
    """The offline paths must degrade to 'unavailable', never raise ImportError."""
    caption_engine = _fresh("caption_engine")
    # ready() only stats files, so it must work and simply say "not ready".
    assert caption_engine.ready() is False

    # The offline text engine must import and expose its API without the wheels.
    local = _fresh("local_text_translation")
    assert hasattr(local, "translate")


def test_translation_service_still_translates_via_free_provider(without_ml_extras):
    """End-to-end sanity: translate() must return text, not blow up."""
    import asyncio

    translation_service = _fresh("translation_service")
    result = asyncio.run(
        translation_service.translate("user-deploy-guard", "Hello", "en", "es")
    )
    # TranslationResult.translated is the user-visible string; the free online
    # provider (or an honest passthrough) must fill it even with no ML wheels.
    assert isinstance(result.translated, str) and result.translated.strip()
    assert result.provider in {"local-m2m100", "passthrough"}
