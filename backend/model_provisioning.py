"""Self-healing provisioning of the free offline models.

The offline translator (M2M100) and speech-to-text (Whisper) weights are ~600 MB
and therefore not committed to the repository, so a fresh container — including
a production deploy — starts without them. Translation must not depend on a
human remembering to run a script, so startup kicks off a best-effort background
download. While it runs, `free_translation_api` keeps translation working, and
if the download is impossible (no disk, no network) nothing breaks: the online
free fallback simply stays in charge.

Never blocks FastAPI startup and never raises into the request path.
"""
import asyncio
import importlib
import logging
import os
import shutil
from pathlib import Path

import local_text_translation
from optional_deps import require_optional

logger = logging.getLogger(__name__)

ROOT = Path(os.getenv("CAPTION_MODEL_ROOT", Path(__file__).parent / "caption_models"))
REQUIRED = (
    "translation/model.bin",
    "translation/config.json",
    "translation/spm.128k.model",
    "translation/shared_vocabulary.txt",
    "speech/model.bin",
    "speech/config.json",
)
# M2M100 int8 + Whisper base need ~600 MB; keep a healthy margin.
MIN_FREE_BYTES = 2_000_000_000


def installed() -> bool:
    return all((ROOT / name).is_file() for name in REQUIRED)


def _provision() -> None:
    # huggingface_hub is only needed for this opt-in download.
    require_optional("huggingface_hub")
    provision_caption_models = importlib.import_module("provision_caption_models")
    provision_caption_models.provision()


async def ensure_background() -> None:
    """Download the weights once, in the background, if they are missing."""
    if installed():
        logger.info("Offline translation models present at %s", ROOT)
        return
    # Opt-IN only: a ~600 MB download at boot competes with the API for CPU,
    # RAM and disk on a small production container (and the runtimes it needs,
    # ctranslate2/faster-whisper, are not in requirements.txt anyway).
    if os.environ.get("AUTO_PROVISION_MODELS", "false").strip().lower() not in {"1", "true", "yes"}:
        logger.info("Model auto-provisioning disabled; using the free online translator")
        return
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(ROOT).free
    except OSError:
        free = 0
    if free < MIN_FREE_BYTES:
        logger.warning(
            "Skipping offline model download (%.1f GB free); free online translation stays active",
            free / 1e9,
        )
        return
    logger.info("Downloading free offline translation/speech models in the background…")
    try:
        await asyncio.to_thread(_provision)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning(
            "Offline model download failed; the free online translator remains in use",
            exc_info=True,
        )
        return
    # `SUPPORTED` is computed at import time from the (previously missing)
    # vocabulary file — refresh it so the local model is used without a restart.
    local_text_translation.refresh_supported()
    logger.info("Offline translation models ready (%d languages)", len(local_text_translation.SUPPORTED))
